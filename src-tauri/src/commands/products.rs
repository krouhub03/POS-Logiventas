use rusqlite::{Row, params};
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::product::{
    InventoryMovementDto, NewProduct, Product, StockAdjustmentInput, UpdateProductInput,
};

const PRODUCT_COLUMNS: &str = "id, sku, barcode, name, category_id, unit, price_cents, cost_cents, \
     tax_rate_bp, stock, min_stock, is_service, active";

fn map_product(r: &Row<'_>) -> rusqlite::Result<Product> {
    let is_service_int: i64 = r.get(11)?;
    let active_int: i64 = r.get(12)?;
    Ok(Product {
        id: r.get(0)?,
        sku: r.get(1)?,
        barcode: r.get(2)?,
        name: r.get(3)?,
        category_id: r.get(4)?,
        unit: r.get(5)?,
        price_cents: r.get(6)?,
        cost_cents: r.get(7)?,
        tax_rate_bp: r.get(8)?,
        stock: r.get(9)?,
        min_stock: r.get(10)?,
        is_service: is_service_int != 0,
        active: active_int != 0,
    })
}

/// Lista productos activos. `search` filtra por nombre, SKU o código de barras.
#[tauri::command]
pub fn list_products(db: State<'_, Db>, search: Option<String>) -> AppResult<Vec<Product>> {
    let conn = db.conn()?;
    let pattern = format!("%{}%", search.unwrap_or_default().trim());
    let sql = format!(
        "SELECT {PRODUCT_COLUMNS} FROM products \
         WHERE active = 1 AND (name LIKE ?1 OR sku LIKE ?1 OR barcode LIKE ?1) \
         ORDER BY name LIMIT 300"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![pattern], map_product)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Busca un producto por código de barras exacto (flujo de escáner).
#[tauri::command]
pub fn find_product_by_barcode(db: State<'_, Db>, barcode: String) -> AppResult<Option<Product>> {
    let conn = db.conn()?;
    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM products WHERE active = 1 AND barcode = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![barcode.trim()], map_product)?;
    Ok(rows.next().transpose()?)
}

/// Obtiene un producto por ID.
#[tauri::command]
pub fn get_product(db: State<'_, Db>, id: i64) -> AppResult<Product> {
    let conn = db.conn()?;
    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM products WHERE id = ?1");
    conn.query_row(&sql, params![id], map_product)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::Validation(format!("Producto con ID {} no encontrado", id))
            }
            other => AppError::Database(other),
        })
}

/// Crea un nuevo producto o servicio.
#[tauri::command]
pub fn create_product(db: State<'_, Db>, input: NewProduct) -> AppResult<Product> {
    if input.sku.trim().is_empty() || input.name.trim().is_empty() {
        return Err(AppError::Validation("SKU y nombre son obligatorios".into()));
    }
    if input.price_cents < 0 {
        return Err(AppError::Validation("El precio no puede ser negativo".into()));
    }

    let is_service = input.is_service.unwrap_or(false);
    let unit = input
        .unit
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(if is_service { "serv" } else { "pza" });

    let stock = if is_service { 0.0 } else { input.stock.unwrap_or(0.0) };
    let min_stock = if is_service { 0.0 } else { input.min_stock.unwrap_or(0.0) };

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    tx.execute(
        "INSERT INTO products (sku, barcode, name, category_id, unit, price_cents, cost_cents, \
         tax_rate_bp, stock, min_stock, is_service, active) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)",
        params![
            input.sku.trim(),
            input.barcode.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            input.name.trim(),
            input.category_id,
            unit,
            input.price_cents,
            input.cost_cents.unwrap_or(0),
            input.tax_rate_bp.unwrap_or(0),
            stock,
            min_stock,
            if is_service { 1 } else { 0 },
        ],
    )?;

    let id = tx.last_insert_rowid();

    // Si tiene stock inicial y no es servicio, registrar movimiento inicial
    if !is_service && stock > 0.0 {
        tx.execute(
            "INSERT INTO inventory_movements (product_id, kind, quantity, reference) \
             VALUES (?1, 'adjustment', ?2, 'Inventario inicial')",
            params![id, stock],
        )?;
    }

    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM products WHERE id = ?1");
    let product = tx.query_row(&sql, params![id], map_product)?;
    tx.commit()?;

    Ok(product)
}

/// Actualiza un producto o servicio existente.
#[tauri::command]
pub fn update_product(db: State<'_, Db>, input: UpdateProductInput) -> AppResult<Product> {
    if input.id <= 0 {
        return Err(AppError::Validation("ID de producto inválido".into()));
    }
    if input.sku.trim().is_empty() || input.name.trim().is_empty() {
        return Err(AppError::Validation("SKU y nombre son obligatorios".into()));
    }
    if input.price_cents < 0 {
        return Err(AppError::Validation("El precio no puede ser negativo".into()));
    }

    let is_service = input.is_service.unwrap_or(false);
    let unit = input
        .unit
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(if is_service { "serv" } else { "pza" });

    let stock = if is_service { 0.0 } else { input.stock.unwrap_or(0.0) };
    let min_stock = if is_service { 0.0 } else { input.min_stock.unwrap_or(0.0) };
    let active_int = if input.active.unwrap_or(true) { 1 } else { 0 };

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE products SET \
         sku = ?1, barcode = ?2, name = ?3, category_id = ?4, unit = ?5, \
         price_cents = ?6, cost_cents = ?7, tax_rate_bp = ?8, stock = ?9, \
         min_stock = ?10, is_service = ?11, active = ?12, updated_at = datetime('now') \
         WHERE id = ?13",
        params![
            input.sku.trim(),
            input.barcode.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            input.name.trim(),
            input.category_id,
            unit,
            input.price_cents,
            input.cost_cents.unwrap_or(0),
            input.tax_rate_bp.unwrap_or(0),
            stock,
            min_stock,
            if is_service { 1 } else { 0 },
            active_int,
            input.id,
        ],
    )?;

    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM products WHERE id = ?1");
    let product = tx.query_row(&sql, params![input.id], map_product)?;
    tx.commit()?;

    Ok(product)
}

/// Eliminación segura (Soft Delete) para preservar integridad con ventas históricas.
#[tauri::command]
pub fn delete_product(db: State<'_, Db>, id: i64) -> AppResult<()> {
    if id <= 0 {
        return Err(AppError::Validation("ID de producto inválido".into()));
    }
    let conn = db.conn()?;
    let affected = conn.execute(
        "UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;

    if affected == 0 {
        return Err(AppError::Validation(format!("Producto con ID {} no existe", id)));
    }
    Ok(())
}

/// Ajuste manual o corrección de existencias de un producto físico (F4: Inventario).
#[tauri::command]
pub fn adjust_stock(db: State<'_, Db>, input: StockAdjustmentInput) -> AppResult<Product> {
    if input.product_id <= 0 {
        return Err(AppError::Validation("ID de producto inválido".into()));
    }
    if input.new_stock < 0.0 {
        return Err(AppError::Validation("La existencia no puede ser negativa".into()));
    }

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    // Verificar si existe y si es servicio
    let (current_stock, is_service_int): (f64, i64) = tx
        .query_row(
            "SELECT stock, is_service FROM products WHERE id = ?1 AND active = 1",
            params![input.product_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::Validation("Producto no encontrado o inactivo".into())
            }
            other => AppError::Database(other),
        })?;

    if is_service_int != 0 {
        return Err(AppError::Validation(
            "No se puede ajustar inventario de un servicio (los servicios no manejan existencias físicas)".into(),
        ));
    }

    let diff = input.new_stock - current_stock;
    if diff.abs() > f64::EPSILON {
        // Actualizar stock del producto
        tx.execute(
            "UPDATE products SET stock = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![input.new_stock, input.product_id],
        )?;

        // Registrar en historial de movimientos
        let reason = if input.reason.trim().is_empty() {
            "Ajuste manual de inventario".to_string()
        } else {
            input.reason.trim().to_string()
        };

        tx.execute(
            "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id) \
             VALUES (?1, 'adjustment', ?2, ?3, ?4)",
            params![input.product_id, diff, reason, input.user_id],
        )?;
    }

    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM products WHERE id = ?1");
    let product = tx.query_row(&sql, params![input.product_id], map_product)?;
    tx.commit()?;

    Ok(product)
}

/// Lista el historial de movimientos de inventario (Kardex).
#[tauri::command]
pub fn list_inventory_movements(
    db: State<'_, Db>,
    product_id: Option<i64>,
    limit: Option<i64>,
) -> AppResult<Vec<InventoryMovementDto>> {
    let conn = db.conn()?;
    let max_rows = limit.unwrap_or(100).clamp(1, 500);

    let (sql, params_vec): (String, Vec<rusqlite::types::Value>) = if let Some(pid) = product_id {
        (
            "SELECT m.id, m.product_id, p.name, m.kind, m.quantity, m.reference, m.user_id, m.created_at \
             FROM inventory_movements m \
             LEFT JOIN products p ON p.id = m.product_id \
             WHERE m.product_id = ?1 \
             ORDER BY m.id DESC LIMIT ?2".to_string(),
            vec![pid.into(), max_rows.into()],
        )
    } else {
        (
            "SELECT m.id, m.product_id, p.name, m.kind, m.quantity, m.reference, m.user_id, m.created_at \
             FROM inventory_movements m \
             LEFT JOIN products p ON p.id = m.product_id \
             ORDER BY m.id DESC LIMIT ?1".to_string(),
            vec![max_rows.into()],
        )
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |r| {
        Ok(InventoryMovementDto {
            id: r.get(0)?,
            product_id: r.get(1)?,
            product_name: r.get(2)?,
            kind: r.get(3)?,
            quantity: r.get(4)?,
            reference: r.get(5)?,
            user_id: r.get(6)?,
            created_at: r.get(7)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
