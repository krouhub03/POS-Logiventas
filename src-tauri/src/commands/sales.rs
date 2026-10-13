use rusqlite::params;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::sale::{
    CreateSaleInput, SaleItemDto, SaleReceipt, TodaySalesSummary,
};

#[tauri::command]
pub fn create_sale(db: State<'_, Db>, input: CreateSaleInput) -> AppResult<SaleReceipt> {
    if input.items.is_empty() {
        return Err(AppError::Validation("La venta debe contener al menos un producto".into()));
    }

    let mut conn = db.conn()?;

    // 1. Obtener prefijo de caja para el folio
    let caja_codigo: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'caja_codigo'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "CAJA-01".into());

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))?;
    let folio = format!("{}-{:06}", caja_codigo, count + 1);

    // 2. Calcular importes con precisión en centavos conforme a AGENTS.md
    let mut subtotal_cents: i64 = 0;
    let mut tax_cents: i64 = 0;
    let mut discount_cents: i64 = 0;
    let mut calculated_items = Vec::new();

    for it in &input.items {
        if it.quantity <= 0.0 {
            return Err(AppError::Validation("La cantidad debe ser mayor a 0".into()));
        }
        if it.unit_price_cents < 0 {
            return Err(AppError::Validation("El precio no puede ser negativo".into()));
        }

        let item_subtotal = (it.quantity * it.unit_price_cents as f64).round() as i64;
        let item_discount = it.discount_cents.unwrap_or(0);
        let tax_bp = it.tax_rate_bp.unwrap_or(0);
        // Redondeo bancario al centavo más cercano: (subtotal * bp + 5000) / 10000
        let item_tax = if tax_bp > 0 {
            (item_subtotal * tax_bp + 5000) / 10000
        } else {
            0
        };
        let item_total = item_subtotal + item_tax - item_discount;

        subtotal_cents += item_subtotal;
        tax_cents += item_tax;
        discount_cents += item_discount;

        calculated_items.push((it, item_subtotal, item_discount, item_tax, item_total));
    }

    let total_cents = subtotal_cents + tax_cents - discount_cents;

    // 3. Validar pagos
    let paid_cents: i64 = input.payments.iter().map(|p| p.amount_cents).sum();
    if paid_cents < total_cents {
        return Err(AppError::Validation(format!(
            "Monto pagado insuficiente. Total: ${:.2}, Pagado: ${:.2}",
            total_cents as f64 / 100.0,
            paid_cents as f64 / 100.0
        )));
    }
    let change_cents = paid_cents - total_cents;

    // 4. Transacción atómica ACID
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO sales (folio, customer_id, user_id, subtotal_cents, discount_cents, tax_cents, total_cents, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'completed')",
        params![
            folio,
            input.customer_id,
            input.user_id,
            subtotal_cents,
            discount_cents,
            tax_cents,
            total_cents
        ],
    )?;

    let sale_id = tx.last_insert_rowid();
    let mut receipt_items = Vec::new();

    for (it, _item_subtotal, item_discount, item_tax, item_total) in calculated_items {
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price_cents, discount_cents, tax_cents, total_cents)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                sale_id,
                it.product_id,
                it.description.trim(),
                it.quantity,
                it.unit_price_cents,
                item_discount,
                item_tax,
                item_total
            ],
        )?;

        let item_row_id = tx.last_insert_rowid();

        // Si es producto físico registrado (no servicio), descontar inventario y registrar movimiento
        if let Some(pid) = it.product_id {
            let is_service: bool = tx
                .query_row(
                    "SELECT is_service FROM products WHERE id = ?1",
                    params![pid],
                    |r| r.get::<_, i64>(0),
                )
                .map(|val| val != 0)
                .unwrap_or(false);

            if !is_service {
                tx.execute(
                    "UPDATE products SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2",
                    params![it.quantity, pid],
                )?;

                tx.execute(
                    "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id)
                     VALUES (?1, 'sale', ?2, ?3, ?4)",
                    params![pid, -it.quantity, folio, input.user_id],
                )?;
            }
        }

        receipt_items.push(SaleItemDto {
            id: item_row_id,
            product_id: it.product_id,
            description: it.description.clone(),
            quantity: it.quantity,
            unit_price_cents: it.unit_price_cents,
            discount_cents: item_discount,
            tax_cents: item_tax,
            total_cents: item_total,
        });
    }

    // Registrar pagos
    for p in &input.payments {
        tx.execute(
            "INSERT INTO payments (sale_id, method, amount_cents, reference)
             VALUES (?1, ?2, ?3, ?4)",
            params![sale_id, p.method, p.amount_cents, p.reference],
        )?;
    }

    let created_at: String = tx.query_row(
        "SELECT created_at FROM sales WHERE id = ?1",
        params![sale_id],
        |r| r.get(0),
    )?;

    tx.commit()?;

    Ok(SaleReceipt {
        id: sale_id,
        folio,
        subtotal_cents,
        discount_cents,
        tax_cents,
        total_cents,
        paid_cents,
        change_cents,
        items_count: receipt_items.len(),
        items: receipt_items,
        created_at,
    })
}

#[tauri::command]
pub fn get_last_sale(db: State<'_, Db>) -> AppResult<Option<SaleReceipt>> {
    let conn = db.conn()?;

    let mut stmt = conn.prepare(
        "SELECT id, folio, subtotal_cents, discount_cents, tax_cents, total_cents, created_at
         FROM sales WHERE status = 'completed' ORDER BY id DESC LIMIT 1",
    )?;

    let last_sale = stmt.query_row([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, String>(6)?,
        ))
    });

    match last_sale {
        Ok((id, folio, subtotal_cents, discount_cents, tax_cents, total_cents, created_at)) => {
            let paid_cents: i64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE sale_id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .unwrap_or(total_cents);

            let mut item_stmt = conn.prepare(
                "SELECT id, product_id, description, quantity, unit_price_cents, discount_cents, tax_cents, total_cents
                 FROM sale_items WHERE sale_id = ?1",
            )?;

            let rows = item_stmt.query_map(params![id], |r| {
                Ok(SaleItemDto {
                    id: r.get(0)?,
                    product_id: r.get(1)?,
                    description: r.get(2)?,
                    quantity: r.get(3)?,
                    unit_price_cents: r.get(4)?,
                    discount_cents: r.get(5)?,
                    tax_cents: r.get(6)?,
                    total_cents: r.get(7)?,
                })
            })?;

            let items = rows.collect::<Result<Vec<_>, _>>()?;
            let items_count = items.len();

            Ok(Some(SaleReceipt {
                id,
                folio,
                subtotal_cents,
                discount_cents,
                tax_cents,
                total_cents,
                paid_cents,
                change_cents: paid_cents - total_cents,
                items_count,
                items,
                created_at,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

#[tauri::command]
pub fn get_today_summary(db: State<'_, Db>) -> AppResult<TodaySalesSummary> {
    let conn = db.conn()?;

    let (total_sales_count, total_cents): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total_cents), 0)
         FROM sales
         WHERE status = 'completed' AND date(created_at) = date('now')",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let cash_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(p.amount_cents), 0)
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         WHERE s.status = 'completed' AND p.method = 'cash' AND date(s.created_at) = date('now')",
        [],
        |r| r.get(0),
    )?;

    let card_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(p.amount_cents), 0)
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         WHERE s.status = 'completed' AND p.method = 'card' AND date(s.created_at) = date('now')",
        [],
        |r| r.get(0),
    )?;

    let transfer_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(p.amount_cents), 0)
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         WHERE s.status = 'completed' AND p.method = 'transfer' AND date(s.created_at) = date('now')",
        [],
        |r| r.get(0),
    )?;

    Ok(TodaySalesSummary {
        total_sales_count,
        total_cents,
        cash_cents,
        card_cents,
        transfer_cents,
    })
}
