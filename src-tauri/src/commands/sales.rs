use rusqlite::{params, Connection};
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::sale::{
    CreateSaleInput, CreateSaleReturnInput, SaleItemDto, SalePaymentDto, SaleReceipt,
    SaleReturnDto, SaleReturnItemDto, SaleSummaryItem, TodaySalesSummary,
};

pub fn format_payment_method_label(method: &str, custom_name: Option<String>) -> String {
    if let Some(name) = custom_name {
        if !name.trim().is_empty() {
            return name;
        }
    }
    match method.to_lowercase().as_str() {
        "cash" | "efectivo" => "Efectivo".to_string(),
        "card" | "tarjeta" => "Tarjeta".to_string(),
        "transfer" | "transferencia" => "Transferencia".to_string(),
        "credit" | "credito" | "crédito" => "Crédito Cliente".to_string(),
        "credit_balance" => "Cruce Cartera".to_string(),
        other => other.to_uppercase(),
    }
}

pub fn build_sale_receipt(conn: &Connection, sale_id: i64) -> AppResult<SaleReceipt> {
    let sale_row = conn.query_row(
        "SELECT s.id, s.folio, s.customer_id, c.name, c.tax_id, u.full_name,
                s.subtotal_cents, s.discount_cents, s.tax_cents, s.total_cents,
                COALESCE(s.reprint_count, 0), s.last_reprinted_at,
                COALESCE(s.return_status, 'none'), COALESCE(s.returned_cents, 0),
                s.created_at
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.id = ?1",
        params![sale_id],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, i64>(8)?,
                r.get::<_, i64>(9)?,
                r.get::<_, i64>(10)?,
                r.get::<_, Option<String>>(11)?,
                r.get::<_, String>(12)?,
                r.get::<_, i64>(13)?,
                r.get::<_, String>(14)?,
            ))
        },
    )?;

    let (
        id,
        folio,
        customer_id,
        customer_name,
        customer_tax_id,
        cashier_name,
        subtotal_cents,
        discount_cents,
        tax_cents,
        total_cents,
        reprint_count,
        last_reprinted_at,
        return_status,
        returned_cents,
        created_at,
    ) = sale_row;

    // Pagos asociados
    let mut pay_stmt = conn.prepare(
        "SELECT p.id, p.method, pm.name, p.amount_cents, p.reference
         FROM payments p
         LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id OR pm.code = p.method
         WHERE p.sale_id = ?1
         ORDER BY p.id ASC",
    )?;
    let payments: Vec<SalePaymentDto> = pay_stmt
        .query_map(params![id], |r| {
            let method: String = r.get(1)?;
            let pm_name: Option<String> = r.get(2)?;
            Ok(SalePaymentDto {
                id: r.get(0)?,
                method_name: format_payment_method_label(&method, pm_name),
                method,
                amount_cents: r.get(3)?,
                reference: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let paid_cents: i64 = if payments.is_empty() {
        total_cents
    } else {
        payments.iter().map(|p| p.amount_cents).sum()
    };

    // Ítems de la venta
    let mut item_stmt = conn.prepare(
        "SELECT si.id, si.product_id, p.sku, p.barcode, p.unit,
                si.description, si.quantity, COALESCE(si.returned_quantity, 0.0),
                si.unit_price_cents, si.discount_cents, si.tax_cents, si.total_cents,
                COALESCE(p.is_service, 0), COALESCE(p.is_bundle, 0)
         FROM sale_items si
         LEFT JOIN products p ON p.id = si.product_id
         WHERE si.sale_id = ?1
         ORDER BY si.id ASC",
    )?;

    let items: Vec<SaleItemDto> = item_stmt
        .query_map(params![id], |r| {
            Ok(SaleItemDto {
                id: r.get(0)?,
                product_id: r.get(1)?,
                sku: r.get(2)?,
                barcode: r.get(3)?,
                unit: r.get(4)?,
                description: r.get(5)?,
                quantity: r.get(6)?,
                returned_quantity: r.get(7)?,
                unit_price_cents: r.get(8)?,
                discount_cents: r.get(9)?,
                tax_cents: r.get(10)?,
                total_cents: r.get(11)?,
                is_service: r.get::<_, i64>(12)? != 0,
                is_bundle: r.get::<_, i64>(13)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Devoluciones asociadas a esta venta
    let mut ret_stmt = conn.prepare(
        "SELECT sr.id, sr.folio, sr.sale_id, sr.sale_folio, sr.customer_id,
                c.name, u.full_name, sr.return_type, sr.reason, sr.refund_method,
                sr.subtotal_cents, sr.discount_cents, sr.tax_cents, sr.total_cents,
                sr.notes, sr.created_at
         FROM sale_returns sr
         LEFT JOIN customers c ON c.id = sr.customer_id
         LEFT JOIN users u ON u.id = sr.user_id
         WHERE sr.sale_id = ?1
         ORDER BY sr.id DESC",
    )?;

    let return_headers = ret_stmt
        .query_map(params![id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
                r.get::<_, i64>(10)?,
                r.get::<_, i64>(11)?,
                r.get::<_, i64>(12)?,
                r.get::<_, i64>(13)?,
                r.get::<_, Option<String>>(14)?,
                r.get::<_, String>(15)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut returns = Vec::new();
    for (
        ret_id,
        ret_folio,
        ret_sale_id,
        ret_sale_folio,
        ret_customer_id,
        ret_customer_name,
        ret_cashier_name,
        ret_type,
        ret_reason,
        ret_refund_method,
        ret_sub,
        ret_disc,
        ret_tax,
        ret_tot,
        ret_notes,
        ret_created,
    ) in return_headers
    {
        let mut r_item_stmt = conn.prepare(
            "SELECT id, sale_item_id, product_id, description, quantity,
                    unit_price_cents, discount_cents, tax_cents, total_cents, inventory_disposition
             FROM sale_return_items
             WHERE return_id = ?1
             ORDER BY id ASC",
        )?;
        let ret_items = r_item_stmt
            .query_map(params![ret_id], |r| {
                Ok(SaleReturnItemDto {
                    id: r.get(0)?,
                    sale_item_id: r.get(1)?,
                    product_id: r.get(2)?,
                    description: r.get(3)?,
                    quantity: r.get(4)?,
                    unit_price_cents: r.get(5)?,
                    discount_cents: r.get(6)?,
                    tax_cents: r.get(7)?,
                    total_cents: r.get(8)?,
                    inventory_disposition: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        returns.push(SaleReturnDto {
            id: ret_id,
            folio: ret_folio,
            sale_id: ret_sale_id,
            sale_folio: ret_sale_folio,
            customer_id: ret_customer_id,
            customer_name: ret_customer_name,
            cashier_name: ret_cashier_name,
            return_type: ret_type,
            reason: ret_reason,
            refund_method: ret_refund_method,
            subtotal_cents: ret_sub,
            discount_cents: ret_disc,
            tax_cents: ret_tax,
            total_cents: ret_tot,
            notes: ret_notes,
            created_at: ret_created,
            items: ret_items,
        });
    }

    let items_count = items.len();

    Ok(SaleReceipt {
        id,
        folio,
        customer_id,
        customer_name,
        customer_tax_id,
        cashier_name,
        subtotal_cents,
        discount_cents,
        tax_cents,
        total_cents,
        paid_cents,
        change_cents: (paid_cents - total_cents).max(0),
        reprint_count,
        last_reprinted_at,
        return_status,
        returned_cents,
        items_count,
        items,
        payments,
        returns,
        created_at,
    })
}

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
        let tax_fixed = it.tax_fixed_cents.unwrap_or(0);
        // Redondeo bancario al centavo más cercano: (subtotal * bp + 5000) / 10000 + (tax_fixed * qty)
        let percent_tax = if tax_bp > 0 {
            (item_subtotal * tax_bp + 5000) / 10000
        } else {
            0
        };
        let fixed_tax = (tax_fixed as f64 * it.quantity).round() as i64;
        let item_tax = percent_tax + fixed_tax;
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

    // Validación estricta NIIF: el cambio solo puede originarse a partir de pagos en efectivo
    if change_cents > 0 {
        let cash_paid_cents: i64 = input.payments.iter()
            .filter(|p| {
                let m = p.method.to_lowercase();
                m.contains("cash") || m.contains("efectivo")
            })
            .map(|p| p.amount_cents)
            .sum();

        if cash_paid_cents < change_cents {
            return Err(AppError::Validation(
                "El cambio (vuelto) solo puede originarse a partir de pagos en efectivo.".to_string(),
            ));
        }
    }

    // 4. Transacción atómica ACID
    let tx = conn.transaction()?;

    let active_shift_id: Option<i64> = tx
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();

    tx.execute(
        "INSERT INTO sales (folio, customer_id, user_id, cash_session_id, subtotal_cents, discount_cents, tax_cents, total_cents, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'completed')",
        params![
            folio,
            input.customer_id,
            input.user_id,
            active_shift_id,
            subtotal_cents,
            discount_cents,
            tax_cents,
            total_cents
        ],
    )?;

    let sale_id = tx.last_insert_rowid();

    // Pre-validación transversal de inventario para Combos/Kits e insumos compartidos en el mismo ticket:
    let mut bundle_children_ids = std::collections::HashSet::<i64>::new();
    let mut total_physical_demand = std::collections::HashMap::<i64, f64>::new();

    for (it, _, _, _, _) in &calculated_items {
        if let Some(pid) = it.product_id {
            let is_bundle: i64 = tx
                .query_row("SELECT is_bundle FROM products WHERE id = ?1", params![pid], |r| r.get(0))
                .unwrap_or(0);
            if is_bundle == 1 {
                let mut comp_stmt = tx.prepare(
                    "SELECT child_product_id, quantity FROM product_components WHERE parent_product_id = ?1",
                )?;
                let comps = comp_stmt
                    .query_map(params![pid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))?
                    .collect::<Result<Vec<_>, _>>()?;
                if comps.is_empty() {
                    return Err(AppError::Validation(format!(
                        "El combo '{}' no tiene productos componentes configurados.",
                        it.description
                    )));
                }
                for (cid, cqty) in comps {
                    bundle_children_ids.insert(cid);
                    *total_physical_demand.entry(cid).or_insert(0.0) += it.quantity * cqty;
                }
            }
        }
    }

    if !bundle_children_ids.is_empty() {
        for (it, _, _, _, _) in &calculated_items {
            if let Some(pid) = it.product_id {
                if bundle_children_ids.contains(&pid) {
                    *total_physical_demand.entry(pid).or_insert(0.0) += it.quantity;
                }
            }
        }

        for cid in &bundle_children_ids {
            let demanded = *total_physical_demand.get(cid).unwrap_or(&0.0);
            let (child_name, child_controls_stock, child_is_service, child_stock): (String, i64, i64, f64) = tx
                .query_row(
                    "SELECT name, controls_stock, is_service, stock FROM products WHERE id = ?1",
                    params![cid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap_or_else(|_| ("Componente".to_string(), 1, 0, 0.0));

            if child_controls_stock == 1 && child_is_service == 0 && child_stock + 1e-9 < demanded {
                return Err(AppError::Validation(format!(
                    "Stock físico insuficiente para el producto '{}' (Disponible en almacén: {}, Requerido en el ticket entre combos y unidades sueltas: {}). No se permite vender combos sin existencias ni duplicar productos ya comprometidos.",
                    child_name, child_stock, demanded
                )));
            }
        }
    }

    for (it, _item_subtotal, item_discount, item_tax, item_total) in calculated_items {
        let (mut unit_cost_cents, is_bundle_item): (i64, i64) = if let Some(pid) = it.product_id {
            tx.query_row(
                "SELECT cost_cents, is_bundle FROM products WHERE id = ?1",
                params![pid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap_or((0, 0))
        } else {
            (0, 0)
        };

        if is_bundle_item == 1 {
            if let Some(pid) = it.product_id {
                let mut cost_stmt = tx.prepare(
                    "SELECT p.cost_cents, pc.quantity \
                     FROM product_components pc \
                     JOIN products p ON p.id = pc.child_product_id \
                     WHERE pc.parent_product_id = ?1",
                )?;
                let comp_costs = cost_stmt
                    .query_map(params![pid], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))?
                    .collect::<Result<Vec<_>, _>>()?;
                let calculated_bundle_cost: i64 = comp_costs
                    .iter()
                    .map(|(cc, q)| (*cc as f64 * *q).round() as i64)
                    .sum();
                if calculated_bundle_cost > 0 {
                    unit_cost_cents = calculated_bundle_cost;
                    let _ = tx.execute(
                        "UPDATE products SET cost_cents = ?1 WHERE id = ?2",
                        params![unit_cost_cents, pid],
                    );
                }
                if it.unit_price_cents < unit_cost_cents {
                    return Err(AppError::Validation(format!(
                        "El precio de venta del combo '{}' (${:.2}) nunca puede ser menor al costo total de sus productos (${:.2})",
                        it.description,
                        it.unit_price_cents as f64 / 100.0,
                        unit_cost_cents as f64 / 100.0
                    )));
                }
            }
        }

        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price_cents, discount_cents, tax_cents, total_cents, unit_cost_cents)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                sale_id,
                it.product_id,
                it.description.trim(),
                it.quantity,
                it.unit_price_cents,
                item_discount,
                item_tax,
                item_total,
                unit_cost_cents
            ],
        )?;

        if let Some(pid) = it.product_id {
            let (is_service, current_stock, is_bundle): (i64, f64, i64) = tx
                .query_row(
                    "SELECT is_service, stock, is_bundle FROM products WHERE id = ?1",
                    params![pid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap_or((0, 0.0, 0));

            if is_bundle == 1 {
                let mut comp_stmt = tx.prepare(
                    "SELECT pc.child_product_id, pc.quantity, p.name, p.is_service, p.stock \
                     FROM product_components pc \
                     JOIN products p ON p.id = pc.child_product_id \
                     WHERE pc.parent_product_id = ?1",
                )?;
                let components = comp_stmt.query_map(params![pid], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, f64>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, f64>(4)?,
                    ))
                })?.collect::<Result<Vec<_>, _>>()?;
                drop(comp_stmt);

                for (child_id, comp_qty, child_name, child_is_service, child_stock) in components {
                    let total_child_qty = it.quantity * comp_qty;
                    if child_is_service == 0 {
                        if child_stock <= 0.0 || child_stock + 1e-9 < total_child_qty {
                            return Err(AppError::Validation(format!(
                                "Stock local insuficiente para el componente '{}' del combo '{}'. Disponible: {}, Solicitado: {}",
                                child_name, it.description, child_stock, total_child_qty
                            )));
                        }
                        tx.execute(
                            "UPDATE products SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2",
                            params![total_child_qty, child_id],
                        )?;
                        tx.execute(
                            "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id) \
                             VALUES (?1, 'sale', ?2, ?3, ?4)",
                            params![child_id, -total_child_qty, format!("{folio} (Combo)"), input.user_id],
                        )?;
                    }
                }
            } else if is_service == 0 {
                if current_stock <= 0.0 || current_stock + 1e-9 < it.quantity {
                    return Err(AppError::Validation(format!(
                        "No se permite vender productos sin inventario. Stock insuficiente para '{}'. Disponible: {}, Solicitado: {}",
                        it.description, current_stock, it.quantity
                    )));
                }

                tx.execute(
                    "UPDATE products SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2",
                    params![it.quantity, pid],
                )?;

                tx.execute(
                    "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id) \
                     VALUES (?1, 'sale', ?2, ?3, ?4)",
                    params![pid, -it.quantity, folio, input.user_id],
                )?;
            }
        }
    }

    // Validar y registrar pagos a crédito sobre cartera de cliente
    let credit_amount_cents: i64 = input
        .payments
        .iter()
        .filter(|p| {
            let m = p.method.to_lowercase();
            m == "credit" || m == "credito" || m.contains("crédito") || m.contains("credito")
        })
        .map(|p| p.amount_cents)
        .sum();

    if credit_amount_cents > 0 {
        let customer_id = input.customer_id.ok_or_else(|| {
            AppError::Validation("Para realizar una venta a crédito se debe seleccionar un cliente registrado".into())
        })?;

        let (customer_name, credit_limit, current_balance, is_blocked): (String, i64, i64, i64) = tx
            .query_row(
                "SELECT name, credit_limit_cents, current_balance_cents, is_credit_blocked FROM customers WHERE id = ?1",
                params![customer_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .map_err(|_| AppError::Validation(format!("Cliente con ID {} no encontrado", customer_id)))?;

        if is_blocked == 1 {
            return Err(AppError::Validation(format!(
                "El cliente '{}' se encuentra bloqueado para compras a crédito",
                customer_name
            )));
        }

        let nuevo_saldo = current_balance + credit_amount_cents;
        if credit_limit > 0 && nuevo_saldo > credit_limit {
            let cupo_disponible = (credit_limit - current_balance).max(0);
            return Err(AppError::Validation(format!(
                "El cliente '{}' excede su cupo de crédito. Cupo total: {}, Saldo deudor: {}, Cupo disponible: {}, Solicitado: {}",
                customer_name, credit_limit, current_balance, cupo_disponible, credit_amount_cents
            )));
        }

        tx.execute(
            "UPDATE customers SET current_balance_cents = current_balance_cents + ?1 WHERE id = ?2",
            params![credit_amount_cents, customer_id],
        )?;
    }

    // Registrar pagos
    for p in &input.payments {
        let pm_id: Option<String> = tx.query_row(
            "SELECT id FROM payment_methods WHERE code = ?1 OR erp_code = ?1 LIMIT 1",
            params![p.method],
            |r| r.get(0),
        ).ok();

        tx.execute(
            "INSERT INTO payments (sale_id, payment_method_id, method, amount_cents, reference)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![sale_id, pm_id, p.method, p.amount_cents, p.reference],
        )?;
    }

    let created_at: String = tx.query_row(
        "SELECT created_at FROM sales WHERE id = ?1",
        params![sale_id],
        |r| r.get(0),
    )?;

    // 5. Inserción en outbox (sync_queue) dentro de la misma transacción ACID
    let payload_items: Vec<serde_json::Value> = input.items.iter().map(|it| {
        let (erp_id, sku, barcode, cost_cents): (Option<String>, Option<String>, Option<String>, i64) = if let Some(pid) = it.product_id {
            tx.query_row(
                "SELECT erp_id, sku, barcode, cost_cents FROM products WHERE id = ?1",
                params![pid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            ).unwrap_or((None, None, None, 0))
        } else {
            (None, None, None, 0)
        };

        let resolved_sku = sku.or_else(|| it.sku.clone());
        let resolved_barcode = barcode.or_else(|| it.barcode.clone());
        let candidate_id = erp_id.clone().or_else(|| it.product_id.map(|id| id.to_string()));

        serde_json::json!({
            "erpProductId": erp_id,
            "localProductId": it.product_id,
            "productId": candidate_id,
            "sku": resolved_sku,
            "barcode": resolved_barcode,
            "description": it.description,
            "quantity": it.quantity,
            "unitPriceCents": it.unit_price_cents,
            "unitCostCents": cost_cents,
            "taxRateBp": it.tax_rate_bp.unwrap_or(0),
            "discountCents": it.discount_cents.unwrap_or(0),
            "totalCents": ((it.quantity * it.unit_price_cents as f64).round() as i64)
        })
    }).collect();

    let customer_info: Option<(String, Option<String>)> = if let Some(cid) = input.customer_id {
        tx.query_row(
            "SELECT name, tax_id FROM customers WHERE id = ?1",
            params![cid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).ok()
    } else {
        None
    };

    let (customer_name, customer_tax_id) = match customer_info {
        Some((name, tax_id)) => (Some(name), tax_id),
        None => (None, None),
    };

    let cashier_info: Option<(Option<String>, String)> = if let Some(uid) = input.user_id {
        tx.query_row(
            "SELECT erp_user_id, full_name FROM users WHERE id = ?1",
            params![uid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).ok()
    } else {
        None
    };

    let (cajero_erp_id, cajero_nombre) = match cashier_info {
        Some((erp_id, name)) => (erp_id, Some(name)),
        None => (None, None),
    };

    let sale_payload = serde_json::json!({
        "id": sale_id,
        "folio": &folio,
        "userId": input.user_id,
        "erpUserId": cajero_erp_id,
        "cajeroNombre": cajero_nombre,
        "customerId": input.customer_id,
        "customerName": customer_name,
        "customerTaxId": customer_tax_id,
        "subtotalCents": subtotal_cents,
        "discountCents": discount_cents,
        "taxCents": tax_cents,
        "totalCents": total_cents,
        "paidCents": paid_cents,
        "changeCents": change_cents,
        "status": "completed",
        "createdAt": &created_at,
        "items": payload_items,
        "payments": input.payments.iter().map(|p| {
            let (cuenta_puc_id, puc_code, erp_code): (Option<String>, Option<String>, Option<String>) = tx.query_row(
                "SELECT puc_account_id, puc_code, erp_code FROM payment_methods WHERE code = ?1 OR erp_code = ?1 LIMIT 1",
                params![p.method],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            ).unwrap_or((None, None, None));

            serde_json::json!({
                "method": p.method,
                "amountCents": p.amount_cents,
                "reference": p.reference,
                "cuentaPucId": cuenta_puc_id,
                "pucCode": puc_code,
                "erpCode": erp_code
            })
        }).collect::<Vec<_>>()
    });

    tx.execute(
        "INSERT INTO sync_queue (entity_type, entity_id, payload, status) VALUES ('sale', ?1, ?2, 'pending')",
        params![sale_id, sale_payload.to_string()],
    )?;

    tx.commit()?;

    build_sale_receipt(&conn, sale_id)
}

#[tauri::command]
pub fn get_last_sale(db: State<'_, Db>) -> AppResult<Option<SaleReceipt>> {
    let conn = db.conn()?;

    let last_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM sales WHERE status = 'completed' ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();

    match last_id {
        Some(id) => Ok(Some(build_sale_receipt(&conn, id)?)),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn get_sale_detail(db: State<'_, Db>, sale_id: i64) -> AppResult<SaleReceipt> {
    let conn = db.conn()?;
    build_sale_receipt(&conn, sale_id)
}

#[tauri::command]
pub fn register_sale_reprint(db: State<'_, Db>, sale_id: i64) -> AppResult<SaleReceipt> {
    let conn = db.conn()?;
    conn.execute(
        "UPDATE sales
         SET reprint_count = COALESCE(reprint_count, 0) + 1,
             last_reprinted_at = datetime('now')
         WHERE id = ?1",
        params![sale_id],
    )?;
    build_sale_receipt(&conn, sale_id)
}

#[tauri::command]
pub fn list_recent_sales(
    db: State<'_, Db>,
    query: Option<String>,
    status_filter: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<SaleSummaryItem>> {
    let conn = db.conn()?;
    let max_rows = limit.unwrap_or(80).clamp(1, 300);
    let q = query.unwrap_or_default().trim().to_lowercase();
    let status_f = status_filter.unwrap_or_else(|| "all".into()).to_lowercase();

    let mut stmt = conn.prepare(
        "SELECT s.id, s.folio, s.customer_id, c.name, c.tax_id, u.full_name,
                s.subtotal_cents, s.discount_cents, s.tax_cents, s.total_cents,
                COALESCE(s.reprint_count, 0), COALESCE(s.return_status, 'none'),
                COALESCE(s.returned_cents, 0), s.created_at,
                (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as items_count,
                COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.sale_id = s.id), s.total_cents) as paid_cents,
                COALESCE((SELECT GROUP_CONCAT(DISTINCT p.method) FROM payments p WHERE p.sale_id = s.id), 'cash') as payment_methods_raw
         FROM sales s
         LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.status = 'completed'
           AND (?1 = '' OR LOWER(s.folio) LIKE '%' || ?1 || '%'
                OR LOWER(COALESCE(c.name, '')) LIKE '%' || ?1 || '%'
                OR LOWER(COALESCE(c.tax_id, '')) LIKE '%' || ?1 || '%'
                OR EXISTS (
                    SELECT 1 FROM sale_items si
                    LEFT JOIN products pr ON pr.id = si.product_id
                    WHERE si.sale_id = s.id
                      AND (LOWER(si.description) LIKE '%' || ?1 || '%'
                           OR LOWER(COALESCE(pr.barcode, '')) LIKE '%' || ?1 || '%'
                           OR LOWER(COALESCE(pr.sku, '')) LIKE '%' || ?1 || '%')
                ))
           AND (?2 = 'all' OR COALESCE(s.return_status, 'none') = ?2)
         ORDER BY s.id DESC
         LIMIT ?3",
    )?;

    let rows = stmt.query_map(params![q, status_f, max_rows], |r| {
        let total_cents: i64 = r.get(9)?;
        let paid_cents: i64 = r.get(15)?;
        let raw_methods: String = r.get(16)?;
        let summary = raw_methods
            .split(',')
            .map(|m| format_payment_method_label(m.trim(), None))
            .collect::<Vec<_>>()
            .join(" + ");

        Ok(SaleSummaryItem {
            id: r.get(0)?,
            folio: r.get(1)?,
            customer_id: r.get(2)?,
            customer_name: r.get(3)?,
            customer_tax_id: r.get(4)?,
            cashier_name: r.get(5)?,
            subtotal_cents: r.get(6)?,
            discount_cents: r.get(7)?,
            tax_cents: r.get(8)?,
            total_cents,
            paid_cents,
            change_cents: (paid_cents - total_cents).max(0),
            reprint_count: r.get(10)?,
            return_status: r.get(11)?,
            returned_cents: r.get(12)?,
            created_at: r.get(13)?,
            items_count: r.get(14)?,
            payment_summary: summary,
        })
    })?;

    let mut list = Vec::new();
    for row in rows {
        list.push(row?);
    }
    Ok(list)
}

#[tauri::command]
pub fn create_sale_return(
    db: State<'_, Db>,
    input: CreateSaleReturnInput,
) -> AppResult<SaleReturnDto> {
    if input.items.is_empty() {
        return Err(AppError::Validation(
            "Seleccione al menos un producto y cantidad para procesar la devolución".into(),
        ));
    }
    let reason = input.reason.trim();
    if reason.is_empty() {
        return Err(AppError::Validation(
            "El motivo de la devolución es obligatorio por auditoría contable".into(),
        ));
    }

    let refund_method = match input.refund_method.trim().to_lowercase().as_str() {
        "cash" | "efectivo" => "cash",
        "credit_balance" | "cartera" | "credito" => "credit_balance",
        "transfer" | "transferencia" => "transfer",
        _ => "other",
    };

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    // 1. Verificar venta original
    let (sale_id, sale_folio, customer_id, sale_return_status): (i64, String, Option<i64>, String) = tx
        .query_row(
            "SELECT id, folio, customer_id, COALESCE(return_status, 'none')
             FROM sales WHERE id = ?1 AND status = 'completed'",
            params![input.sale_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| AppError::Validation("La venta original no existe o no está completada".into()))?;

    if sale_return_status == "full" {
        return Err(AppError::Validation(
            "Este ticket ya fue devuelto en su totalidad.".into(),
        ));
    }

    // 2. Verificar turno activo si el reembolso es en efectivo
    let active_shift_id: Option<i64> = tx
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();

    if refund_method == "cash" && active_shift_id.is_none() {
        return Err(AppError::Validation(
            "Para reembolsar efectivo desde la gaveta debe haber un turno de caja abierto.".into(),
        ));
    }

    if refund_method == "credit_balance" && customer_id.is_none() {
        return Err(AppError::Validation(
            "El cruce de cartera solo aplica para ventas con un cliente asignado.".into(),
        ));
    }

    // 3. Generar consecutivo local de Nota Crédito POS
    let caja_codigo: String = tx
        .query_row(
            "SELECT value FROM settings WHERE key = 'caja_codigo'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "CAJA-01".into());

    let return_count: i64 = tx.query_row("SELECT COUNT(*) FROM sale_returns", [], |r| r.get(0))?;
    let return_folio = format!("NC-{}-{:05}", caja_codigo, return_count + 1);

    // 4. Validar cada línea y calcular importes exactos en centavos enteros
    let mut return_subtotal_cents: i64 = 0;
    let mut return_discount_cents: i64 = 0;
    let mut return_tax_cents: i64 = 0;
    let mut return_total_cents: i64 = 0;

    struct ValidatedReturnLine {
        sale_item_id: i64,
        product_id: Option<i64>,
        description: String,
        req_qty: f64,
        unit_price_cents: i64,
        unit_cost_cents: i64,
        line_discount_cents: i64,
        line_tax_cents: i64,
        line_total_cents: i64,
        disposition: String,
    }

    let mut validated_lines = Vec::new();

    for req_item in &input.items {
        if req_item.quantity <= 0.0 {
            continue;
        }

        let (
            si_id,
            product_id,
            description,
            orig_qty,
            already_returned,
            unit_price_cents,
            orig_discount_cents,
            orig_tax_cents,
            orig_total_cents,
            unit_cost_cents,
        ): (i64, Option<i64>, String, f64, f64, i64, i64, i64, i64, i64) = tx
            .query_row(
                "SELECT id, product_id, description, quantity, COALESCE(returned_quantity, 0.0),
                        unit_price_cents, discount_cents, tax_cents, total_cents, COALESCE(unit_cost_cents, 0)
                 FROM sale_items
                 WHERE id = ?1 AND sale_id = ?2",
                params![req_item.sale_item_id, sale_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                    ))
                },
            )
            .map_err(|_| {
                AppError::Validation(format!(
                    "La línea de venta #{} no pertenece al ticket {}",
                    req_item.sale_item_id, sale_folio
                ))
            })?;

        let available_qty = (orig_qty - already_returned).max(0.0);
        if req_item.quantity > available_qty + 1e-6 {
            return Err(AppError::Validation(format!(
                "La cantidad a devolver de '{}' ({}) supera la cantidad disponible para devolución ({}).",
                description, req_item.quantity, available_qty
            )));
        }

        let is_full_line = (req_item.quantity - orig_qty).abs() < 1e-6 && already_returned < 1e-6;
        let (line_sub, line_disc, line_tax, line_tot) = if is_full_line {
            let sub = (orig_qty * unit_price_cents as f64).round() as i64;
            (sub, orig_discount_cents, orig_tax_cents, orig_total_cents)
        } else {
            let ratio = req_item.quantity / orig_qty;
            let sub = (req_item.quantity * unit_price_cents as f64).round() as i64;
            let disc = (orig_discount_cents as f64 * ratio).round() as i64;
            let tax = (orig_tax_cents as f64 * ratio).round() as i64;
            let tot = sub + tax - disc;
            (sub, disc, tax, tot)
        };

        let raw_disp = req_item
            .inventory_disposition
            .as_deref()
            .unwrap_or("restock")
            .to_lowercase();
        let disposition = match raw_disp.as_str() {
            "merma" | "averia" | "damaged" => "merma".to_string(),
            "no_stock" | "service" => "no_stock".to_string(),
            _ => "restock".to_string(),
        };

        return_subtotal_cents += line_sub;
        return_discount_cents += line_disc;
        return_tax_cents += line_tax;
        return_total_cents += line_tot;

        validated_lines.push(ValidatedReturnLine {
            sale_item_id: si_id,
            product_id,
            description,
            req_qty: req_item.quantity,
            unit_price_cents,
            unit_cost_cents,
            line_discount_cents: line_disc,
            line_tax_cents: line_tax,
            line_total_cents: line_tot,
            disposition,
        });
    }

    if validated_lines.is_empty() {
        return Err(AppError::Validation(
            "Las cantidades a devolver deben ser mayores a cero".into(),
        ));
    }

    // 5. Actualizar cantidades devueltas en sale_items y ejecutar movimientos de inventario
    for line in &validated_lines {
        tx.execute(
            "UPDATE sale_items
             SET returned_quantity = COALESCE(returned_quantity, 0.0) + ?1
             WHERE id = ?2",
            params![line.req_qty, line.sale_item_id],
        )?;

        if let Some(pid) = line.product_id {
            let (is_service, controls_stock, is_bundle): (i64, i64, i64) = tx
                .query_row(
                    "SELECT COALESCE(is_service, 0), COALESCE(controls_stock, 1), COALESCE(is_bundle, 0)
                     FROM products WHERE id = ?1",
                    params![pid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap_or((0, 1, 0));

            if is_service == 0 {
                if line.disposition == "restock" {
                    if is_bundle == 1 {
                        // Reintegrar proporcionalmente cada componente físico del combo
                        let mut comp_stmt = tx.prepare(
                            "SELECT pc.child_product_id, pc.quantity, p.is_service, p.controls_stock
                             FROM product_components pc
                             JOIN products p ON p.id = pc.child_product_id
                             WHERE pc.parent_product_id = ?1",
                        )?;
                        let comps = comp_stmt
                            .query_map(params![pid], |r| {
                                Ok((
                                    r.get::<_, i64>(0)?,
                                    r.get::<_, f64>(1)?,
                                    r.get::<_, i64>(2)?,
                                    r.get::<_, i64>(3)?,
                                ))
                            })?
                            .collect::<Result<Vec<_>, _>>()?;
                        drop(comp_stmt);

                        for (child_id, comp_qty, child_service, child_controls) in comps {
                            if child_service == 0 && child_controls == 1 {
                                let restore_qty = line.req_qty * comp_qty;
                                tx.execute(
                                    "UPDATE products SET stock = stock + ?1, updated_at = datetime('now') WHERE id = ?2",
                                    params![restore_qty, child_id],
                                )?;
                                tx.execute(
                                    "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id)
                                     VALUES (?1, 'return', ?2, ?3, ?4)",
                                    params![
                                        child_id,
                                        restore_qty,
                                        format!("{} (Devolución Combo {})", return_folio, sale_folio),
                                        input.user_id
                                    ],
                                )?;
                            }
                        }
                    } else if controls_stock == 1 {
                        tx.execute(
                            "UPDATE products SET stock = stock + ?1, updated_at = datetime('now') WHERE id = ?2",
                            params![line.req_qty, pid],
                        )?;
                        tx.execute(
                            "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id)
                             VALUES (?1, 'return', ?2, ?3, ?4)",
                            params![
                                pid,
                                line.req_qty,
                                format!("{} (Devolución {})", return_folio, sale_folio),
                                input.user_id
                            ],
                        )?;
                    }
                } else if line.disposition == "merma" {
                    // Registrar trazabilidad en movimientos sin contaminar el stock vendible
                    tx.execute(
                        "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id)
                         VALUES (?1, 'return', 0, ?2, ?3)",
                        params![
                            pid,
                            format!("{} [MERMA/AVERÍA x{}] ({})", return_folio, line.req_qty, sale_folio),
                            input.user_id
                        ],
                    )?;
                }
            }
        }
    }

    // 6. Determinar si la venta quedó devuelta parcial o totalmente
    let remaining_items: i64 = tx.query_row(
        "SELECT COUNT(*) FROM sale_items
         WHERE sale_id = ?1 AND (quantity - COALESCE(returned_quantity, 0.0)) > 1e-6",
        params![sale_id],
        |r| r.get(0),
    )?;

    let return_type = if remaining_items == 0 { "full" } else { "partial" };
    let new_sale_return_status = if remaining_items == 0 { "full" } else { "partial" };

    tx.execute(
        "UPDATE sales
         SET return_status = ?1,
             returned_cents = COALESCE(returned_cents, 0) + ?2
         WHERE id = ?3",
        params![new_sale_return_status, return_total_cents, sale_id],
    )?;

    // 7. Si el método de compensación es cruce de cartera, descontar deuda del cliente
    if refund_method == "credit_balance" {
        if let Some(cid) = customer_id {
            tx.execute(
                "UPDATE customers
                 SET current_balance_cents = MAX(0, current_balance_cents - ?1)
                 WHERE id = ?2",
                params![return_total_cents, cid],
            )?;
        }
    }

    // 8. Insertar cabecera y detalle de la devolución local
    tx.execute(
        "INSERT INTO sale_returns (
            folio, sale_id, sale_folio, customer_id, user_id, cash_session_id,
            return_type, reason, refund_method, subtotal_cents, discount_cents,
            tax_cents, total_cents, notes
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            return_folio,
            sale_id,
            sale_folio,
            customer_id,
            input.user_id,
            active_shift_id,
            return_type,
            reason,
            refund_method,
            return_subtotal_cents,
            return_discount_cents,
            return_tax_cents,
            return_total_cents,
            input.notes
        ],
    )?;

    let return_id = tx.last_insert_rowid();
    let mut return_item_dtos = Vec::new();
    let mut outbox_items = Vec::new();

    for line in &validated_lines {
        let final_disp = if let Some(pid) = line.product_id {
            let is_srv: i64 = tx
                .query_row("SELECT COALESCE(is_service, 0) FROM products WHERE id = ?1", params![pid], |r| r.get(0))
                .unwrap_or(0);
            if is_srv != 0 {
                "no_stock".to_string()
            } else {
                line.disposition.clone()
            }
        } else {
            "no_stock".to_string()
        };

        tx.execute(
            "INSERT INTO sale_return_items (
                return_id, sale_item_id, product_id, description, quantity,
                unit_price_cents, unit_cost_cents, discount_cents, tax_cents,
                total_cents, inventory_disposition
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                return_id,
                line.sale_item_id,
                line.product_id,
                line.description,
                line.req_qty,
                line.unit_price_cents,
                line.unit_cost_cents,
                line.line_discount_cents,
                line.line_tax_cents,
                line.line_total_cents,
                final_disp
            ],
        )?;

        let r_item_id = tx.last_insert_rowid();
        return_item_dtos.push(SaleReturnItemDto {
            id: r_item_id,
            sale_item_id: line.sale_item_id,
            product_id: line.product_id,
            description: line.description.clone(),
            quantity: line.req_qty,
            unit_price_cents: line.unit_price_cents,
            discount_cents: line.line_discount_cents,
            tax_cents: line.line_tax_cents,
            total_cents: line.line_total_cents,
            inventory_disposition: final_disp.clone(),
        });

        let (erp_id, sku, barcode, tax_rate_bp): (Option<String>, Option<String>, Option<String>, i64) =
            if let Some(pid) = line.product_id {
                tx.query_row(
                    "SELECT erp_id, sku, barcode, COALESCE(tax_rate_bp, 0) FROM products WHERE id = ?1",
                    params![pid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap_or((None, None, None, 0))
            } else {
                (None, None, None, 0)
            };

        outbox_items.push(serde_json::json!({
            "erpProductId": erp_id,
            "localProductId": line.product_id,
            "sku": sku,
            "barcode": barcode,
            "description": line.description,
            "quantity": line.req_qty,
            "unitPriceCents": line.unit_price_cents,
            "unitCostCents": line.unit_cost_cents,
            "discountCents": line.line_discount_cents,
            "taxCents": line.line_tax_cents,
            "totalCents": line.line_total_cents,
            "taxRateBp": tax_rate_bp,
            "inventoryDisposition": final_disp
        }));
    }

    let created_at: String = tx.query_row(
        "SELECT created_at FROM sale_returns WHERE id = ?1",
        params![return_id],
        |r| r.get(0),
    )?;

    let (customer_name, customer_tax_id): (Option<String>, Option<String>) = if let Some(cid) = customer_id {
        tx.query_row(
            "SELECT name, tax_id FROM customers WHERE id = ?1",
            params![cid],
            |r| Ok((Some(r.get(0)?), r.get(1)?)),
        )
        .unwrap_or((None, None))
    } else {
        (None, None)
    };

    let (erp_user_id, cashier_name): (Option<String>, Option<String>) = if let Some(uid) = input.user_id {
        tx.query_row(
            "SELECT erp_user_id, full_name FROM users WHERE id = ?1",
            params![uid],
            |r| Ok((r.get(0)?, Some(r.get(1)?))),
        )
        .unwrap_or((None, None))
    } else {
        (None, None)
    };

    // 9. Encolar en sync_queue para sincronizar con el ERP (NotaContable NIIF v6.2 + Kardex)
    let return_payload = serde_json::json!({
        "id": return_id,
        "folio": &return_folio,
        "saleId": sale_id,
        "saleFolio": &sale_folio,
        "returnType": return_type,
        "reason": reason,
        "refundMethod": refund_method,
        "customerId": customer_id,
        "customerName": &customer_name,
        "customerTaxId": &customer_tax_id,
        "userId": input.user_id,
        "erpUserId": &erp_user_id,
        "cashierName": &cashier_name,
        "subtotalCents": return_subtotal_cents,
        "discountCents": return_discount_cents,
        "taxCents": return_tax_cents,
        "totalCents": return_total_cents,
        "notes": &input.notes,
        "createdAt": &created_at,
        "items": outbox_items
    });

    tx.execute(
        "INSERT INTO sync_queue (entity_type, entity_id, payload, status)
         VALUES ('sale_return', ?1, ?2, 'pending')",
        params![return_id, return_payload.to_string()],
    )?;

    tx.commit()?;

    Ok(SaleReturnDto {
        id: return_id,
        folio: return_folio,
        sale_id,
        sale_folio,
        customer_id,
        customer_name,
        cashier_name,
        return_type: return_type.to_string(),
        reason: reason.to_string(),
        refund_method: refund_method.to_string(),
        subtotal_cents: return_subtotal_cents,
        discount_cents: return_discount_cents,
        tax_cents: return_tax_cents,
        total_cents: return_total_cents,
        notes: input.notes,
        created_at,
        items: return_item_dtos,
    })
}

#[tauri::command]
pub fn get_today_summary(db: State<'_, Db>) -> AppResult<TodaySalesSummary> {
    let conn = db.conn()?;

    let (total_sales_count, total_cents): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(total_cents - COALESCE(returned_cents, 0)), 0)
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

    let cash_returns_cents: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0)
             FROM sale_returns
             WHERE refund_method = 'cash' AND date(created_at) = date('now')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

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
        cash_cents: (cash_cents - cash_returns_cents).max(0),
        card_cents,
        transfer_cents,
    })
}
