use rusqlite::{Row, params};
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::product::{
    InventoryMovementDto, NewProduct, Product, ProductComponentDto, ProductTag, SaveProductComponentItem,
    StockAdjustmentInput, UpdateProductInput,
};

const PRODUCT_COLUMNS: &str = "p.id, p.sku, p.barcode, p.name, p.category_id, p.unit, p.price_cents, p.cost_cents, \
     p.tax_rate_bp, p.stock, p.min_stock, p.is_service, p.active, p.controls_stock, p.allow_negative_stock, p.is_bundle, p.tags, p.tax_fixed_cents, c.name, \
     p.image_url, p.image_local_path, p.image_hash, p.image_sync_status";
const PRODUCT_FROM: &str = "products p LEFT JOIN categories c ON c.id = p.category_id";

/// Calcula dinámicamente el stock disponible de un combo basado en sus componentes hijos.
pub fn calculate_bundle_stock(conn: &rusqlite::Connection, parent_id: i64) -> rusqlite::Result<Option<f64>> {
    let mut stmt = conn.prepare(
        "SELECT MIN(CAST(p_child.stock / pc.quantity AS REAL))
         FROM product_components pc
         JOIN products p_child ON p_child.id = pc.child_product_id
         WHERE pc.parent_product_id = ?1 AND p_child.active = 1",
    )?;
    let val: Option<f64> = stmt.query_row(params![parent_id], |r| r.get(0)).ok().flatten();
    Ok(val.map(|v| v.floor().max(0.0)))
}

/// Consulta los componentes de un combo junto con su precio y costo unitario actual.
pub fn query_product_components(conn: &rusqlite::Connection, parent_id: i64) -> rusqlite::Result<Vec<ProductComponentDto>> {
    let mut stmt = conn.prepare(
        "SELECT pc.id, pc.parent_product_id, pc.child_product_id, p.name, p.sku, p.barcode, \
                p.stock, p.unit, p.price_cents, p.cost_cents, pc.quantity, pc.order_index \
         FROM product_components pc \
         JOIN products p ON p.id = pc.child_product_id \
         WHERE pc.parent_product_id = ?1 \
         ORDER BY pc.order_index ASC, pc.id ASC",
    )?;

    let rows = stmt.query_map(params![parent_id], |r| {
        Ok(ProductComponentDto {
            id: r.get(0)?,
            parent_product_id: r.get(1)?,
            child_product_id: r.get(2)?,
            child_name: r.get(3)?,
            child_sku: r.get(4)?,
            child_barcode: r.get(5)?,
            child_stock: r.get(6)?,
            child_unit: r.get(7)?,
            child_price_cents: r.get(8)?,
            child_cost_cents: r.get(9)?,
            quantity: r.get(10)?,
            order_index: r.get(11)?,
        })
    })?;

    rows.collect()
}

/// Enriquecer un producto compuesto con su lista de componentes, stock armable y costo calculado.
pub fn enrich_bundle_product(conn: &rusqlite::Connection, p: &mut Product) {
    if !p.is_bundle {
        return;
    }
    p.allow_negative_stock = false;
    if let Ok(comps) = query_product_components(conn, p.id) {
        if comps.is_empty() {
            p.stock = 0.0;
        } else {
            let mut min_stock = f64::INFINITY;
            let mut total_cost_cents: i64 = 0;
            for c in &comps {
                if c.quantity > 0.0 {
                    let possible = (c.child_stock / c.quantity).floor();
                    if possible < min_stock {
                        min_stock = possible;
                    }
                }
                total_cost_cents += (c.child_cost_cents as f64 * c.quantity).round() as i64;
            }
            p.stock = if min_stock.is_finite() { min_stock.max(0.0) } else { 0.0 };
            if total_cost_cents > 0 {
                p.cost_cents = total_cost_cents;
            }
        }
        p.components = Some(comps);
    }
}

fn map_product(r: &Row<'_>) -> rusqlite::Result<Product> {
    let is_service_int: i64 = r.get(11)?;
    let active_int: i64 = r.get(12)?;
    let is_bundle_int: i64 = r.get(15).unwrap_or(0);
    let tags: Option<String> = r.get(16).ok();
    let tax_fixed_cents: i64 = r.get(17).unwrap_or(0);
    let category_name: Option<String> = r.get(18).ok();
    let image_url: Option<String> = r.get(19).ok();
    let image_local_path: Option<String> = r.get(20).ok();
    let image_hash: Option<String> = r.get(21).ok();
    let image_sync_status: Option<String> = r.get(22).ok();

    Ok(Product {
        id: r.get(0)?,
        sku: r.get(1)?,
        barcode: r.get(2)?,
        name: r.get(3)?,
        category_id: r.get(4)?,
        category_name,
        unit: r.get(5)?,
        price_cents: r.get(6)?,
        cost_cents: r.get(7)?,
        tax_rate_bp: r.get(8)?,
        stock: r.get(9)?,
        min_stock: r.get(10)?,
        is_service: is_service_int != 0,
        controls_stock: is_service_int == 0,
        allow_negative_stock: false,
        is_bundle: is_bundle_int != 0,
        tags,
        tax_fixed_cents,
        image_url,
        image_local_path,
        image_hash,
        image_sync_status,
        active: active_int != 0,
        components: None,
    })
}

/// Lista los nombres de categorías registradas (orden alfabético).
#[tauri::command]
pub fn list_categories(db: State<'_, Db>) -> AppResult<Vec<String>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare("SELECT name FROM categories WHERE active = 1 ORDER BY name ASC")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut list = Vec::new();
    for name in rows.flatten() {
        if !name.trim().is_empty() && !list.contains(&name) {
            list.push(name);
        }
    }
    Ok(list)
}

/// Lista productos activos. `search` filtra por nombre, SKU, código de barras o tags (#frio, etc.).
#[tauri::command]
pub fn list_products(db: State<'_, Db>, search: Option<String>) -> AppResult<Vec<Product>> {
    let conn = db.conn()?;
    let pattern = format!("%{}%", search.unwrap_or_default().trim());
    let sql = format!(
        "SELECT {PRODUCT_COLUMNS} FROM {PRODUCT_FROM} \
         WHERE p.active = 1 AND (p.name LIKE ?1 OR p.sku LIKE ?1 OR p.barcode LIKE ?1 OR p.tags LIKE ?1) \
         ORDER BY p.name LIMIT 300"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut products = stmt.query_map(params![pattern], map_product)?.collect::<Result<Vec<_>, _>>()?;

    for p in &mut products {
        enrich_bundle_product(&conn, p);
    }

    Ok(products)
}

/// Busca un producto por código de barras exacto (flujo de escáner).
#[tauri::command]
pub fn find_product_by_barcode(db: State<'_, Db>, barcode: String) -> AppResult<Option<Product>> {
    let conn = db.conn()?;
    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM {PRODUCT_FROM} WHERE p.active = 1 AND p.barcode = ?1");
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query_map(params![barcode.trim()], map_product)?;
    let mut product = rows.next().transpose()?;
    if let Some(ref mut p) = product {
        enrich_bundle_product(&conn, p);
    }
    Ok(product)
}

/// Obtiene un producto por ID.
#[tauri::command]
pub fn get_product(db: State<'_, Db>, id: i64) -> AppResult<Product> {
    let conn = db.conn()?;
    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM {PRODUCT_FROM} WHERE p.id = ?1");
    let mut product = conn.query_row(&sql, params![id], map_product)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::Validation(format!("Producto con ID {} no encontrado", id))
            }
            other => AppError::Database(other),
        })?;

    enrich_bundle_product(&conn, &mut product);

    Ok(product)
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
    let is_bundle = input.is_bundle.unwrap_or(false);
    let cost_cents = input.cost_cents.unwrap_or(0);

    if is_bundle && input.price_cents < cost_cents {
        return Err(AppError::Validation(format!(
            "El precio de venta del combo (${:.2}) nunca puede ser menor al costo total de sus productos (${:.2})",
            input.price_cents as f64 / 100.0,
            cost_cents as f64 / 100.0
        )));
    }

    let unit = input
        .unit
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(if is_service { "serv" } else { "pza" });

    let stock = if is_service || is_bundle { 0.0 } else { input.stock.unwrap_or(0.0) };
    if !is_service && !is_bundle && stock <= 0.0 {
        return Err(AppError::Validation(
            "No se permite registrar productos físicos sin inventario. La existencia inicial debe ser mayor a 0.".into(),
        ));
    }
    let min_stock = if is_service || is_bundle { 0.0 } else { input.min_stock.unwrap_or(0.0) };

    let controls_stock = !is_service;
    let allow_negative_stock = false;
    let tags_val = input.tags.as_deref().unwrap_or("").trim().to_string();
    let tax_fixed_cents = input.tax_fixed_cents.unwrap_or(0);

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    let barcode_clean = input.barcode.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(bc) = barcode_clean {
        let _ = tx.execute(
            "UPDATE products SET barcode = NULL WHERE barcode = ?1 AND active = 0",
            params![bc],
        );
    }

    let image_sync_status = if input.image_local_path.is_some() { "pending_upload" } else { "none" };

    tx.execute(
        "INSERT INTO products (sku, barcode, name, category_id, unit, price_cents, cost_cents, \
         tax_rate_bp, stock, min_stock, is_service, active, needs_erp_upload, \
         controls_stock, allow_negative_stock, is_bundle, tags, tax_fixed_cents, \
         image_url, image_local_path, image_hash, image_sync_status) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, 1, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            input.sku.trim(),
            barcode_clean,
            input.name.trim(),
            input.category_id,
            unit,
            input.price_cents,
            cost_cents,
            input.tax_rate_bp.unwrap_or(0),
            stock,
            min_stock,
            if is_service { 1 } else { 0 },
            if controls_stock { 1 } else { 0 },
            if allow_negative_stock { 1 } else { 0 },
            if is_bundle { 1 } else { 0 },
            tags_val,
            tax_fixed_cents,
            input.image_url,
            input.image_local_path,
            input.image_hash,
            image_sync_status,
        ],
    )?;

    let id = tx.last_insert_rowid();

    // Si tiene stock inicial y es producto físico simple, registrar movimiento inicial
    if controls_stock && !is_bundle && stock > 0.0 {
        tx.execute(
            "INSERT INTO inventory_movements (product_id, kind, quantity, reference) \
             VALUES (?1, 'adjustment', ?2, 'Inventario inicial')",
            params![id, stock],
        )?;
    }

    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM {PRODUCT_FROM} WHERE p.id = ?1");
    let mut product = tx.query_row(&sql, params![id], map_product)?;
    enrich_bundle_product(&tx, &mut product);
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
    let is_bundle = input.is_bundle.unwrap_or(false);
    let cost_cents = input.cost_cents.unwrap_or(0);

    if is_bundle && input.price_cents < cost_cents {
        return Err(AppError::Validation(format!(
            "El precio de venta del combo (${:.2}) nunca puede ser menor al costo total de sus productos (${:.2})",
            input.price_cents as f64 / 100.0,
            cost_cents as f64 / 100.0
        )));
    }

    let unit = input
        .unit
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(if is_service { "serv" } else { "pza" });

    let controls_stock = !is_service;
    let allow_negative_stock = false;
    let tags_val = input.tags.as_deref().unwrap_or("").trim().to_string();
    let tax_fixed_cents = input.tax_fixed_cents.unwrap_or(0);

    let stock = if !controls_stock || is_bundle { 0.0 } else { input.stock.unwrap_or(0.0) };
    if !is_service && !is_bundle && stock <= 0.0 {
        return Err(AppError::Validation(
            "No se permite guardar un producto físico sin inventario (existencia <= 0).".into(),
        ));
    }
    let min_stock = if !controls_stock || is_bundle { 0.0 } else { input.min_stock.unwrap_or(0.0) };
    let active_int = if input.active.unwrap_or(true) { 1 } else { 0 };

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    // Si se marca como combo, verificar que no sea ya insumo hijo de otro combo
    if is_bundle {
        let used_as_child: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM product_components WHERE child_product_id = ?1",
                params![input.id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if used_as_child > 0 {
            return Err(AppError::Validation(
                "Este producto ya forma parte de otro combo como insumo. No puede convertirse en combo.".into(),
            ));
        }
    }

    let barcode_clean = input.barcode.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(bc) = barcode_clean {
        let _ = tx.execute(
            "UPDATE products SET barcode = NULL WHERE barcode = ?1 AND active = 0 AND id != ?2",
            params![bc, input.id],
        );
    }

    tx.execute(
        "UPDATE products SET \
         sku = ?1, barcode = ?2, name = ?3, category_id = ?4, unit = ?5, \
         price_cents = ?6, cost_cents = ?7, tax_rate_bp = ?8, stock = ?9, \
         min_stock = ?10, is_service = ?11, active = ?12, needs_erp_upload = 1, \
         controls_stock = ?13, allow_negative_stock = ?14, is_bundle = ?15, tags = ?16, tax_fixed_cents = ?17, \
         updated_at = datetime('now') \
         WHERE id = ?18",
        params![
            input.sku.trim(),
            barcode_clean,
            input.name.trim(),
            input.category_id,
            unit,
            input.price_cents,
            cost_cents,
            input.tax_rate_bp.unwrap_or(0),
            stock,
            min_stock,
            if is_service { 1 } else { 0 },
            active_int,
            if controls_stock { 1 } else { 0 },
            if allow_negative_stock { 1 } else { 0 },
            if is_bundle { 1 } else { 0 },
            tags_val,
            tax_fixed_cents,
            input.id,
        ],
    )?;

    if let Some(ref local_path) = input.image_local_path {
        tx.execute(
            "UPDATE products SET image_local_path = ?1, image_hash = ?2, image_sync_status = 'pending_upload' WHERE id = ?3",
            params![local_path, input.image_hash, input.id],
        )?;
    }

    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM {PRODUCT_FROM} WHERE p.id = ?1");
    let mut product = tx.query_row(&sql, params![input.id], map_product)?;
    enrich_bundle_product(&tx, &mut product);
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

    // Verificar si existe y si es servicio o combo
    let (current_stock, is_service_int, is_bundle_int): (f64, i64, i64) = tx
        .query_row(
            "SELECT stock, is_service, is_bundle FROM products WHERE id = ?1 AND active = 1",
            params![input.product_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
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

    if is_bundle_int != 0 {
        return Err(AppError::Validation(
            "No se puede ajustar manualmente el stock de un combo o kit. Ajuste las existencias de sus productos componentes.".into(),
        ));
    }

    let diff = input.new_stock - current_stock;
    if diff.abs() > f64::EPSILON {
        // Actualizar stock del producto y marcar para sync con ERP
        tx.execute(
            "UPDATE products SET stock = ?1, needs_erp_upload = 1, updated_at = datetime('now') WHERE id = ?2",
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

    let sql = format!("SELECT {PRODUCT_COLUMNS} FROM {PRODUCT_FROM} WHERE p.id = ?1");
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

/// Lista todas las etiquetas maestras activas.
#[tauri::command]
pub fn list_product_tags(db: State<'_, Db>) -> AppResult<Vec<ProductTag>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, color_hex, active FROM product_tags WHERE active = 1 ORDER BY name ASC"
    )?;
    let rows = stmt.query_map([], |r| {
        let active_int: i64 = r.get(3)?;
        Ok(ProductTag {
            id: r.get(0)?,
            name: r.get(1)?,
            color_hex: r.get(2)?,
            active: active_int != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Crea una nueva etiqueta maestra.
#[tauri::command]
pub fn create_product_tag(db: State<'_, Db>, name: String, color_hex: String) -> AppResult<ProductTag> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err(AppError::Validation("El nombre de la etiqueta no puede estar vacío".into()));
    }
    let clean_color = if color_hex.trim().is_empty() {
        "#6366f1".to_string()
    } else {
        color_hex.trim().to_string()
    };

    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO product_tags (name, color_hex, active) VALUES (?1, ?2, 1) \
         ON CONFLICT(name) DO UPDATE SET color_hex = ?2, active = 1",
        params![clean_name, clean_color],
    )?;
    let id = conn.last_insert_rowid();

    Ok(ProductTag {
        id,
        name: clean_name.to_string(),
        color_hex: clean_color,
        active: true,
    })
}

/// Actualiza el nombre o color de una etiqueta maestra.
#[tauri::command]
pub fn update_product_tag(db: State<'_, Db>, id: i64, name: String, color_hex: String) -> AppResult<ProductTag> {
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err(AppError::Validation("El nombre de la etiqueta no puede estar vacío".into()));
    }
    let clean_color = if color_hex.trim().is_empty() {
        "#6366f1".to_string()
    } else {
        color_hex.trim().to_string()
    };

    let conn = db.conn()?;
    let affected = conn.execute(
        "UPDATE product_tags SET name = ?1, color_hex = ?2 WHERE id = ?3",
        params![clean_name, clean_color, id],
    )?;
    if affected == 0 {
        return Err(AppError::Validation(format!("Etiqueta con ID {} no encontrada", id)));
    }

    Ok(ProductTag {
        id,
        name: clean_name.to_string(),
        color_hex: clean_color,
        active: true,
    })
}

/// Elimina (borra) una etiqueta maestra.
#[tauri::command]
pub fn delete_product_tag(db: State<'_, Db>, id: i64) -> AppResult<()> {
    let conn = db.conn()?;
    conn.execute(
        "DELETE FROM product_tags WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Obtiene la lista de componentes de un producto compuesto (combo/kit).
#[tauri::command]
pub fn get_product_components(db: State<'_, Db>, parent_id: i64) -> AppResult<Vec<ProductComponentDto>> {
    let conn = db.conn()?;
    Ok(query_product_components(&conn, parent_id)?)
}

/// Guarda o reemplaza los componentes de un producto compuesto (combo/kit).
#[tauri::command]
pub fn save_product_components(
    db: State<'_, Db>,
    parent_id: i64,
    components: Vec<SaveProductComponentItem>,
) -> AppResult<()> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    let (is_bundle, parent_price_cents, parent_name): (i64, i64, String) = tx
        .query_row(
            "SELECT is_bundle, price_cents, name FROM products WHERE id = ?1",
            params![parent_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| AppError::Validation(format!("Producto padre con ID {} no encontrado", parent_id)))?;

    if is_bundle == 1 && components.is_empty() {
        return Err(AppError::Validation(
            "Un combo o kit debe tener al menos un producto componente".into(),
        ));
    }

    // Consolidar/validar componentes únicos y calcular el costo total de los productos hijos
    let mut unique_components: Vec<(i64, f64, i64)> = Vec::new();
    let mut total_bundle_cost_cents: i64 = 0;

    for (idx, comp) in components.iter().enumerate() {
        if comp.child_product_id == parent_id {
            return Err(AppError::Validation("Un producto no puede ser componente de sí mismo".into()));
        }
        if comp.quantity <= 0.0 {
            return Err(AppError::Validation("La cantidad del componente debe ser mayor a cero".into()));
        }
        if unique_components.iter().any(|(cid, _, _)| *cid == comp.child_product_id) {
            return Err(AppError::Validation(
                "No se puede agregar el mismo producto más de una vez al combo; edite su cantidad directamente.".into(),
            ));
        }

        let (child_name, child_cost_cents, child_is_bundle, child_stock, child_is_service): (String, i64, i64, f64, i64) = tx
            .query_row(
                "SELECT name, cost_cents, is_bundle, stock, is_service FROM products WHERE id = ?1 AND active = 1",
                params![comp.child_product_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|_| AppError::Validation(format!("El producto componente (ID {}) no existe o está inactivo", comp.child_product_id)))?;

        if child_is_bundle != 0 {
            return Err(AppError::Validation(format!(
                "El producto '{}' ya es un combo. Agregue únicamente productos simples como componentes.",
                child_name
            )));
        }

        if child_is_service == 0 && (child_stock <= 0.0 || child_stock + 1e-9 < comp.quantity) {
            return Err(AppError::Validation(format!(
                "No se puede registrar el producto '{}' en el combo porque no tiene inventario suficiente (Disponible: {}, Requerido: {})",
                child_name, child_stock, comp.quantity
            )));
        }

        total_bundle_cost_cents += (child_cost_cents as f64 * comp.quantity).round() as i64;
        let order = comp.order_index.unwrap_or(idx as i64);
        unique_components.push((comp.child_product_id, comp.quantity, order));
    }

    if !unique_components.is_empty() && parent_price_cents < total_bundle_cost_cents {
        return Err(AppError::Validation(format!(
            "El precio de venta del combo '{}' (${:.2}) nunca puede ser menor al costo total de sus productos (${:.2})",
            parent_name,
            parent_price_cents as f64 / 100.0,
            total_bundle_cost_cents as f64 / 100.0
        )));
    }

    let should_be_bundle = if !unique_components.is_empty() { 1 } else { is_bundle };
    tx.execute(
        "UPDATE products SET is_bundle = ?1, cost_cents = ?2, allow_negative_stock = 0, needs_erp_upload = 1, updated_at = datetime('now') WHERE id = ?3",
        params![should_be_bundle, total_bundle_cost_cents, parent_id],
    )?;

    tx.execute("DELETE FROM product_components WHERE parent_product_id = ?1", params![parent_id])?;

    let mut insert_stmt = tx.prepare(
        "INSERT INTO product_components (parent_product_id, child_product_id, quantity, order_index) \
         VALUES (?1, ?2, ?3, ?4)",
    )?;

    for (child_product_id, quantity, order) in unique_components {
        insert_stmt.execute(params![parent_id, child_product_id, quantity, order])?;
    }

    drop(insert_stmt);
    tx.commit()?;
    Ok(())
}


