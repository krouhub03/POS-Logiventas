use rusqlite::{Row, params};
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::product::{NewProduct, Product};

const PRODUCT_COLUMNS: &str = "id, sku, barcode, name, category_id, unit, price_cents, cost_cents, \
     tax_rate_bp, stock, min_stock, active";

fn map_product(r: &Row<'_>) -> rusqlite::Result<Product> {
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
        active: r.get(11)?,
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
         ORDER BY name LIMIT 200"
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

#[tauri::command]
pub fn create_product(db: State<'_, Db>, input: NewProduct) -> AppResult<Product> {
    if input.sku.trim().is_empty() || input.name.trim().is_empty() {
        return Err(AppError::Validation("SKU y nombre son obligatorios".into()));
    }
    if input.price_cents < 0 {
        return Err(AppError::Validation("El precio no puede ser negativo".into()));
    }

    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO products (sku, barcode, name, category_id, unit, price_cents, cost_cents, \
         tax_rate_bp, stock, min_stock) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            input.sku.trim(),
            input.barcode.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            input.name.trim(),
            input.category_id,
            input.unit.as_deref().unwrap_or("pza"),
            input.price_cents,
            input.cost_cents.unwrap_or(0),
            input.tax_rate_bp.unwrap_or(0),
            input.stock.unwrap_or(0.0),
            input.min_stock.unwrap_or(0.0),
        ],
    )?;

    let id = conn.last_insert_rowid();
    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM products WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], map_product)?)
}
