use rusqlite::params;
use serde_json::Value;
use std::time::Duration;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::sync::{
    CheckStockItemInput, OutboxBatchResult, PaymentMethodDto, SyncStatusDto, VerifyStockResult,
};

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .filter(|s| !s.is_empty())
}

fn set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

struct CriticalItemLocal {
    product_id: i64,
    name: String,
    quantity: f64,
    stock: f64,
    erp_id: Option<String>,
}

/// 🛡️ Verifica disponibilidad y reserva temporal de productos con stock crítico (<= umbral).
/// Previene colisiones cuando 2 cajas intentan vender la última unidad al mismo tiempo.
#[tauri::command]
pub async fn verify_and_reserve_stock(
    db: State<'_, Db>,
    items: Vec<CheckStockItemInput>,
) -> AppResult<VerifyStockResult> {
    // 1. Verificación local inmediata: Si algún producto no tiene existencias suficientes en SQLite local
    let (erp_url, token, offline_policy, critical_items) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_api_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "erp_api_token").unwrap_or_default();
        let threshold = get_setting(&conn, "critical_stock_threshold")
            .and_then(|s| s.parse().ok())
            .unwrap_or(2.0);
        let offline_policy = get_setting(&conn, "offline_stock_policy").unwrap_or_else(|| "permissive".into());

        // Desglosar combos/kits en sus productos hijos físicos y acumular la demanda física total del ticket
        let mut required_by_product: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();
        for it in &items {
            let is_bundle: i64 = conn
                .query_row(
                    "SELECT is_bundle FROM products WHERE id = ?1",
                    params![it.product_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            if is_bundle != 0 {
                let mut stmt = conn.prepare(
                    "SELECT child_product_id, quantity FROM product_components WHERE parent_product_id = ?1",
                )?;
                let comps: Vec<(i64, f64)> = stmt
                    .query_map(params![it.product_id], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .filter_map(|r| r.ok())
                    .collect();

                if comps.is_empty() {
                    return Ok(VerifyStockResult {
                        ok: false,
                        motivo: Some("PRODUCTO_AGOTADO".into()),
                        product_id: Some(it.product_id),
                        product_name: Some("Combo sin insumos configurados".into()),
                        stock_disponible: Some(0.0),
                        offline_warning: None,
                    });
                }

                for (child_id, comp_qty) in comps {
                    *required_by_product.entry(child_id).or_insert(0.0) += comp_qty * it.quantity;
                }
            } else {
                *required_by_product.entry(it.product_id).or_insert(0.0) += it.quantity;
            }
        }

        // Primero verificamos si hay algún producto físico que localmente ya esté agotado o insuficiente
        let mut critical_items = Vec::new();
        for (&prod_id, &req_qty) in &required_by_product {
            let (stock, name, is_service, controls_stock, _allow_neg, erp_id): (f64, String, i64, i64, i64, Option<String>) = conn
                .query_row(
                    "SELECT stock, name, is_service, controls_stock, allow_negative_stock, erp_id FROM products WHERE id = ?1",
                    params![prod_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
                )
                .unwrap_or((999.0, "Producto".into(), 0, 1, 0, None));

            if is_service == 0 && (stock <= 0.0 || stock + 1e-9 < req_qty) {
                return Ok(VerifyStockResult {
                    ok: false,
                    motivo: if stock <= 0.0 {
                        Some("PRODUCTO_AGOTADO".into())
                    } else {
                        Some("STOCK_INSUFICIENTE".into())
                    },
                    product_id: Some(prod_id),
                    product_name: Some(name),
                    stock_disponible: Some(stock),
                    offline_warning: None,
                });
            }

            if is_service == 0 && controls_stock != 0 && stock <= threshold {
                critical_items.push(CriticalItemLocal {
                    product_id: prod_id,
                    name,
                    quantity: req_qty,
                    stock,
                    erp_id,
                });
            }
        }
        (erp_url, token, offline_policy, critical_items)
    };

    // Si ningún ítem tiene stock crítico, aprobamos de inmediato en local sin latencia de red
    if critical_items.is_empty() {
        return Ok(VerifyStockResult {
            ok: true,
            motivo: None,
            product_id: None,
            product_name: None,
            stock_disponible: None,
            offline_warning: None,
        });
    }

    // Si la terminal no está vinculada al ERP, el stock local es suficiente para proceder
    if token.is_empty() {
        return Ok(VerifyStockResult {
            ok: true,
            motivo: None,
            product_id: None,
            product_name: None,
            stock_disponible: None,
            offline_warning: Some(true),
        });
    }

    // 2. Consulta de reserva atómica en tiempo real contra el ERP para stock crítico
    let payload_items: Vec<serde_json::Value> = critical_items
        .iter()
        .map(|it| {
            let p_id_str = it.erp_id.clone().unwrap_or_else(|| it.product_id.to_string());
            serde_json::json!({
                "productId": p_id_str,
                "quantity": it.quantity
            })
        })
        .collect();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2500))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/inventario/verificar-reserva", erp_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "items": payload_items }))
        .send()
        .await;

    match resp {
        Ok(res) if res.status().is_success() => {
            let json: Value = res.json().await.unwrap_or_default();
            let data = &json["data"];
            let ok = data["ok"].as_bool().unwrap_or(false);

            if ok {
                Ok(VerifyStockResult {
                    ok: true,
                    motivo: None,
                    product_id: None,
                    product_name: None,
                    stock_disponible: None,
                    offline_warning: Some(false),
                })
            } else {
                let motivo = data["motivo"].as_str().unwrap_or("STOCK_INSUFICIENTE").to_string();
                let p_nombre = data["productoNombre"].as_str().map(|s| s.to_string());
                let disp = data["stockDisponible"].as_f64();

                // Actualizar el stock local con la realidad del ERP para evitar futuros intentos
                if let Some(p_id_str) = data["productoId"].as_str() {
                    let disp_val = disp.unwrap_or(0.0);
                    let conn = db.conn()?;
                    let _ = conn.execute(
                        "UPDATE products SET stock = ?1, updated_at = datetime('now') WHERE erp_id = ?2 OR id = ?2",
                        params![disp_val, p_id_str],
                    );
                }

                Ok(VerifyStockResult {
                    ok: false,
                    motivo: Some(motivo),
                    product_id: None,
                    product_name: p_nombre,
                    stock_disponible: disp,
                    offline_warning: Some(false),
                })
            }
        }
        _ => {
            // Conexión no disponible: en modo Offline-First, si hay stock local permitimos la venta.
            // Si la política es estrictamente restrictiva por configuración administrativa:
            if offline_policy == "strict" {
                let first_item = &critical_items[0];
                Ok(VerifyStockResult {
                    ok: false,
                    motivo: Some("STOCK_NO_DISPONIBLE".into()),
                    product_id: Some(first_item.product_id),
                    product_name: Some(first_item.name.clone()),
                    stock_disponible: Some(first_item.stock),
                    offline_warning: Some(true),
                })
            } else {
                Ok(VerifyStockResult {
                    ok: true,
                    motivo: None,
                    product_id: None,
                    product_name: None,
                    stock_disponible: None,
                    offline_warning: Some(true),
                })
            }
        }
    }
}

/// 🔓 Libera cualquier reserva de stock si el cajero cancela el cobro o vacía el ticket.
#[tauri::command]
pub async fn release_stock_reservation(
    db: State<'_, Db>,
    product_id: Option<i64>,
) -> AppResult<()> {
    let (erp_url, token, erp_product_id) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        let erp_product_id: Option<String> = product_id.and_then(|pid| {
            conn.query_row(
                "SELECT erp_id FROM products WHERE id = ?1",
                params![pid],
                |r| r.get(0),
            )
            .ok()
        });
        (erp_url, token, erp_product_id)
    };

    if token.is_empty() {
        return Ok(());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/inventario/liberar-reserva", erp_url.trim_end_matches('/'));
    let _ = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "productId": erp_product_id }))
        .send()
        .await;

    Ok(())
}

/// 📥 Sincroniza el catálogo completo de productos y existencias desde el ERP hacia SQLite.
pub async fn sync_catalog_internal(db: &Db) -> AppResult<usize> {
    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").ok_or_else(|| {
            AppError::Auth("Terminal no vinculada con el ERP".into())
        })?;
        (erp_url, token)
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    // 0. Despachar Outbox primero para que el ERP consolide ventas antes de retornarnos el stock
    let _ = dispatch_outbox_internal(db).await;

    // 1. Extraer productos creados o modificados localmente en el POS para subir al ERP
    let unsynced_products: Vec<serde_json::Value> = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, sku, barcode, name, unit, is_service, price_cents, cost_cents, tax_rate_bp, stock, min_stock, tags, is_bundle \
             FROM products WHERE active = 1 AND (erp_id IS NULL OR needs_erp_upload = 1)",
        )?;
        let rows: Vec<(i64, String, Option<String>, String, String, i64, i64, i64, i64, f64, f64, String, i64)> = stmt
            .query_map([], |r| {
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
                    r.get(10)?,
                    r.get::<_, Option<String>>(11)?.unwrap_or_default(),
                    r.get::<_, i64>(12).unwrap_or(0),
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let mut list = Vec::new();
        for (id, sku, barcode, name, unit, is_service, price_cents, cost_cents, tax_rate_bp, stock, min_stock, tags, is_bundle) in rows {
            let mut components_json = Vec::new();
            if is_bundle == 1 {
                if let Ok(mut c_stmt) = conn.prepare(
                    "SELECT p.sku, pc.quantity FROM product_components pc JOIN products p ON p.id = pc.child_product_id WHERE pc.parent_product_id = ?1 ORDER BY pc.order_index ASC",
                ) {
                    if let Ok(c_rows) = c_stmt.query_map(params![id], |cr| {
                        Ok(serde_json::json!({
                            "sku": cr.get::<_, String>(0)?,
                            "quantity": cr.get::<_, f64>(1)?,
                        }))
                    }) {
                        components_json = c_rows.filter_map(|cr| cr.ok()).collect();
                    }
                }
            }

            list.push(serde_json::json!({
                "sku": sku,
                "barcode": barcode,
                "name": name,
                "unit": unit,
                "is_service": is_service,
                "is_bundle": is_bundle,
                "price_cents": price_cents,
                "cost_cents": cost_cents,
                "tax_rate_bp": tax_rate_bp,
                "stock": stock,
                "min_stock": min_stock,
                "tags": tags,
                "components": components_json,
            }));
        }
        list
    };

    // 2. Subir productos locales modificados o nuevos hacia el ERP
    if !unsynced_products.is_empty() {
        let post_url = format!("{}/api/pos/v1/sync/productos", erp_url.trim_end_matches('/'));
        if let Ok(res) = client
            .post(&post_url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "products": unsynced_products }))
            .send()
            .await
        {
            if res.status().is_success() {
                if let Ok(json) = res.json::<Value>().await {
                    if let Some(arr) = json["data"]["productos"].as_array() {
                        let conn = db.conn()?;
                        for item in arr {
                            let sku = item["sku"].as_str().unwrap_or_default();
                            let erp_id = item["erpId"].as_str().unwrap_or_default();
                            if !sku.is_empty() && !erp_id.is_empty() {
                                let _ = conn.execute(
                                    "UPDATE products SET erp_id = ?1, needs_erp_upload = 0 WHERE sku = ?2",
                                    params![erp_id, sku],
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Descargar catálogo completo desde el ERP
    let url = format!("{}/api/pos/v1/sync/productos", erp_url.trim_end_matches('/'));
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!("Error del ERP al sincronizar catálogo: {err_text}")));
    }

    let json: Value = res.json().await?;

    if let Some(bodega_nombre) = json["data"]["bodega"]["nombre"].as_str() {
        if let Ok(conn) = db.conn() {
            let _ = set_setting(&conn, "bodega_nombre", bodega_nombre);
            if let Some(bodega_id) = json["data"]["bodega"]["id"].as_str() {
                let _ = set_setting(&conn, "bodega_id", bodega_id);
            }
        }
    }

    let products_array = json["data"]["products"]
        .as_array()
        .ok_or_else(|| AppError::Validation("Formato inválido de productos recibido del ERP".into()))?;

    let total_synced = {
        let mut conn = db.conn()?;
        let tx = conn.transaction()?;
        let mut total_synced = 0;

        let mut sorted_products = products_array.clone();
    sorted_products.sort_by_key(|p| if p["active"].as_i64().unwrap_or(1) == 1 { 0 } else { 1 });

    let mut used_barcodes = std::collections::HashSet::<String>::new();

    for p in &sorted_products {
        let erp_id = p["id"].as_str().unwrap_or_default();
        let sku = p["sku"].as_str().unwrap_or_default();
        let raw_barcode = p["barcode"].as_str().map(str::trim).filter(|s| !s.is_empty());
        let name = p["name"].as_str().unwrap_or("Sin Nombre");
        let unit = p["unit"].as_str().unwrap_or("pza");
        let is_service = p["is_service"].as_i64().unwrap_or(0);
        let controls_stock = if is_service == 1 { 0 } else { 1 };
        let allow_negative_stock: i64 = 0;
        let is_bundle = p["is_bundle"].as_i64().unwrap_or(0);
        let tags = p["tags"].as_str().unwrap_or("");
        let tax_fixed_cents = p["tax_fixed_cents"].as_i64().unwrap_or(0);
        let price_cents = p["price_cents"].as_i64().unwrap_or(0);
        let cost_cents = p["cost_cents"].as_i64().unwrap_or(0);
        let tax_rate_bp = p["tax_rate_bp"].as_i64().unwrap_or(0);
        let stock = p["stock"].as_f64().unwrap_or(0.0);
        let min_stock = p["min_stock"].as_f64().unwrap_or(0.0);
        let active = p["active"].as_i64().unwrap_or(1);

        if sku.is_empty() {
            continue;
        }

        // Buscar si ya existe localmente por erp_id o sku
        let local_match: Option<i64> = if !erp_id.is_empty() {
            tx.query_row(
                "SELECT id FROM products WHERE erp_id = ?1",
                params![erp_id],
                |r| r.get(0),
            )
            .ok()
        } else {
            None
        }
        .or_else(|| {
            tx.query_row(
                "SELECT id FROM products WHERE sku = ?1",
                params![sku],
                |r| r.get(0),
            )
            .ok()
        });

        // Resolución segura de código de barras para evitar violación de UNIQUE constraint
        let mut resolved_barcode: Option<String> = None;
        if let Some(bc) = raw_barcode {
            if used_barcodes.contains(bc) {
                // Ya asignado a otro producto prioritario en este lote
                resolved_barcode = None;
            } else {
                // Verificar si otro producto en SQLite tiene este código de barras
                let other_row: Option<(i64, i64)> = tx
                    .query_row(
                        "SELECT id, active FROM products WHERE barcode = ?1",
                        params![bc],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .ok();

                match other_row {
                    Some((other_id, other_active)) => {
                        if Some(other_id) == local_match {
                            // Es el mismo producto
                            resolved_barcode = Some(bc.to_string());
                            used_barcodes.insert(bc.to_string());
                        } else if other_active == 0 {
                            // El otro producto está inactivo: liberamos su código de barras
                            let _ = tx.execute(
                                "UPDATE products SET barcode = NULL WHERE id = ?1",
                                params![other_id],
                            );
                            if active == 1 {
                                resolved_barcode = Some(bc.to_string());
                                used_barcodes.insert(bc.to_string());
                            } else {
                                resolved_barcode = None;
                            }
                        } else {
                            // El otro producto está activo: si este es inactivo o colisiona, se asigna None
                            resolved_barcode = None;
                        }
                    }
                    None => {
                        resolved_barcode = Some(bc.to_string());
                        used_barcodes.insert(bc.to_string());
                    }
                }
            }
        }

        // Calcular ventas locales pendientes en cola que aún no se reflejan en el ERP (directas + como componente de combos)
        let pending_sold: f64 = if let Some(local_id) = local_match {
            let direct_sold: f64 = tx.query_row(
                "SELECT COALESCE(SUM(si.quantity), 0) \
                 FROM sale_items si \
                 JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
                 WHERE si.product_id = ?1 AND sq.status != 'synced'",
                params![local_id],
                |r| r.get(0),
            ).unwrap_or(0.0);

            let combo_sold: f64 = tx.query_row(
                "SELECT COALESCE(SUM(si.quantity * pc.quantity), 0) \
                 FROM sale_items si \
                 JOIN product_components pc ON pc.parent_product_id = si.product_id \
                 JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
                 WHERE pc.child_product_id = ?1 AND sq.status != 'synced'",
                params![local_id],
                |r| r.get(0),
            ).unwrap_or(0.0);

            direct_sold + combo_sold
        } else {
            0.0
        };

        let effective_stock = if controls_stock == 0 { 0.0 } else { (stock - pending_sold).max(0.0) };

        let category_str = p["category"].as_str().unwrap_or("General").trim();
        let category_id: Option<i64> = if !category_str.is_empty() {
            let _ = tx.execute(
                "INSERT INTO categories (name, active) VALUES (?1, 1) ON CONFLICT(name) DO NOTHING",
                params![category_str],
            );
            tx.query_row(
                "SELECT id FROM categories WHERE name = ?1",
                params![category_str],
                |r| r.get(0),
            ).ok()
        } else {
            None
        };

        let erp_image_url = p["image_url"].as_str().map(str::trim).filter(|s| !s.is_empty());
        let erp_image_hash = p["image_hash"].as_str().map(str::trim).filter(|s| !s.is_empty());

        let (current_img_hash, current_local_path, current_sync_status): (Option<String>, Option<String>, Option<String>) = if let Some(lid) = local_match {
            tx.query_row(
                "SELECT image_hash, image_local_path, image_sync_status FROM products WHERE id = ?1",
                params![lid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or((None, None, None))
        } else {
            (None, None, None)
        };

        let (final_img_url, final_local_path, final_img_hash, final_sync_status) = if current_sync_status.as_deref() == Some("pending_upload") {
            (None, current_local_path, current_img_hash, current_sync_status)
        } else if let Some(url) = erp_image_url {
            let file_exists = current_local_path.as_ref().map(|path| std::path::Path::new(path).exists()).unwrap_or(false);
            if erp_image_hash.is_some() && erp_image_hash == current_img_hash.as_deref() && file_exists {
                (Some(url.to_string()), current_local_path, current_img_hash, Some("synced".to_string()))
            } else {
                (Some(url.to_string()), current_local_path, erp_image_hash.map(String::from), Some("pending_download".to_string()))
            }
        } else {
            (None, None, None, Some("none".to_string()))
        };

        if let Some(local_id) = local_match {
            tx.execute(
                "UPDATE products SET
                    erp_id = ?1,
                    sku = ?2,
                    barcode = ?3,
                    name = ?4,
                    unit = ?5,
                    is_service = ?6,
                    price_cents = ?7,
                    cost_cents = ?8,
                    tax_rate_bp = ?9,
                    stock = ?10,
                    min_stock = ?11,
                    active = ?12,
                    needs_erp_upload = 0,
                    controls_stock = ?13,
                    allow_negative_stock = ?14,
                    is_bundle = ?15,
                    tags = ?16,
                    tax_fixed_cents = ?17,
                    category_id = ?18,
                    image_url = ?19,
                    image_local_path = ?20,
                    image_hash = ?21,
                    image_sync_status = ?22,
                    updated_at = datetime('now')
                 WHERE id = ?23",
                params![
                    erp_id,
                    sku,
                    resolved_barcode,
                    name,
                    unit,
                    is_service,
                    price_cents,
                    cost_cents,
                    tax_rate_bp,
                    effective_stock,
                    min_stock,
                    active,
                    controls_stock,
                    allow_negative_stock,
                    is_bundle,
                    tags,
                    tax_fixed_cents,
                    category_id,
                    final_img_url,
                    final_local_path,
                    final_img_hash,
                    final_sync_status,
                    local_id
                ],
            )?;
        } else {
            tx.execute(
                "INSERT INTO products (
                    erp_id, sku, barcode, name, unit, is_service,
                    price_cents, cost_cents, tax_rate_bp, stock, min_stock, active, needs_erp_upload,
                    controls_stock, allow_negative_stock, is_bundle, tags, tax_fixed_cents, category_id,
                    image_url, image_local_path, image_hash, image_sync_status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
                params![
                    erp_id,
                    sku,
                    resolved_barcode,
                    name,
                    unit,
                    is_service,
                    price_cents,
                    cost_cents,
                    tax_rate_bp,
                    effective_stock,
                    min_stock,
                    active,
                    controls_stock,
                    allow_negative_stock,
                    is_bundle,
                    tags,
                    tax_fixed_cents,
                    category_id,
                    final_img_url,
                    final_local_path,
                    final_img_hash,
                    final_sync_status,
                ],
            )?;
        }

        total_synced += 1;
    }

    // Sincronizar componentes de combos/kits (product_components) una vez que todos los productos existen en SQLite
    for p in &sorted_products {
        if p["is_bundle"].as_i64().unwrap_or(0) != 1 {
            continue;
        }
        let Some(comps_arr) = p["bundle_components"].as_array() else {
            continue;
        };
        if comps_arr.is_empty() {
            continue;
        }
        let erp_id = p["id"].as_str().unwrap_or_default();
        let sku = p["sku"].as_str().unwrap_or_default();

        let parent_local_id: Option<i64> = if !erp_id.is_empty() {
            tx.query_row("SELECT id FROM products WHERE erp_id = ?1", params![erp_id], |r| r.get(0)).ok()
        } else {
            None
        }
        .or_else(|| {
            tx.query_row("SELECT id FROM products WHERE sku = ?1", params![sku], |r| r.get(0)).ok()
        });

        let Some(parent_id) = parent_local_id else {
            continue;
        };

        let _ = tx.execute("DELETE FROM product_components WHERE parent_product_id = ?1", params![parent_id]);

        let mut total_bundle_cost_cents: i64 = 0;
        for (idx, comp) in comps_arr.iter().enumerate() {
            let child_erp_id = comp["child_product_id"].as_str().unwrap_or_default();
            let child_sku = comp["child_sku"].as_str().unwrap_or_default();
            let qty = comp["quantity"].as_f64().unwrap_or(0.0);
            if qty <= 0.0 {
                continue;
            }

            let child_row: Option<(i64, i64)> = if !child_erp_id.is_empty() {
                tx.query_row(
                    "SELECT id, cost_cents FROM products WHERE erp_id = ?1",
                    params![child_erp_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok()
            } else {
                None
            }
            .or_else(|| {
                tx.query_row(
                    "SELECT id, cost_cents FROM products WHERE sku = ?1",
                    params![child_sku],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok()
            });

            if let Some((child_local_id, child_cost_cents)) = child_row {
                if child_local_id != parent_id {
                    let _ = tx.execute(
                        "INSERT INTO product_components (parent_product_id, child_product_id, quantity, order_index) \
                         VALUES (?1, ?2, ?3, ?4)",
                        params![parent_id, child_local_id, qty, idx as i64],
                    );
                    total_bundle_cost_cents += (child_cost_cents as f64 * qty).round() as i64;
                }
            }
        }

        if total_bundle_cost_cents > 0 {
            let _ = tx.execute(
                "UPDATE products SET cost_cents = ?1, allow_negative_stock = 0 WHERE id = ?2",
                params![total_bundle_cost_cents, parent_id],
            );
        }
    }

    // Desactivar en SQLite cualquier producto que ya no esté activo o haya sido eliminado en el ERP
    let erp_active_ids: std::collections::HashSet<String> = products_array
        .iter()
        .filter(|p| p["active"].as_i64().unwrap_or(1) == 1)
        .filter_map(|p| p["id"].as_str().map(|s| s.to_string()))
        .collect();

    {
        let mut stmt = tx.prepare("SELECT id, erp_id FROM products WHERE erp_id IS NOT NULL AND active = 1")?;
        let local_products: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        for (local_id, erp_id) in local_products {
            if !erp_active_ids.contains(&erp_id) {
                let _ = tx.execute(
                    "UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?1",
                    params![local_id],
                );
            }
        }
    }

        tx.execute(
            "INSERT INTO settings (key, value) VALUES ('last_sync_timestamp', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = datetime('now')",
            [],
        )?;

        tx.commit()?;
        Ok::<usize, AppError>(total_synced)
    }?;

    // Sincronizar también los medios de pago vinculados con sus cuentas PUC
    let _ = sync_payment_methods_internal(db).await;

    Ok(total_synced)
}

#[tauri::command]
pub async fn sync_catalog_from_erp(db: State<'_, Db>) -> AppResult<usize> {
    sync_catalog_internal(&db).await
}

/// 💳 Sincroniza medios de pago y sus cuentas PUC desde el ERP hacia SQLite local.
pub async fn sync_payment_methods_internal(db: &Db) -> AppResult<usize> {
    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if token.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/medios-pago", erp_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await;

    let res = match resp {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(0),
    };

    let json: Value = res.json().await.unwrap_or_default();
    let payment_methods = match json["data"]["payment_methods"].as_array() {
        Some(arr) => arr,
        None => return Ok(0),
    };

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    let mut synced_count = 0;
    for pm in payment_methods {
        let id = pm["id"].as_str().unwrap_or_default();
        let code = pm["code"].as_str().unwrap_or_default();
        let erp_code = pm["erp_code"].as_str().unwrap_or_default();
        let name = pm["name"].as_str().unwrap_or_default();
        let pm_type = pm["type"].as_str().unwrap_or_default();
        let puc_code = pm["puc_code"].as_str();
        let puc_account_id = pm["puc_account_id"].as_str();
        let puc_account_name = pm["puc_account_name"].as_str();
        let active = pm["active"].as_i64().unwrap_or(1);

        if !code.is_empty() {
            tx.execute(
                "INSERT INTO payment_methods (id, code, erp_code, name, type, puc_code, puc_account_id, puc_account_name, active, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
                 ON CONFLICT(code) DO UPDATE SET
                    id = excluded.id,
                    erp_code = excluded.erp_code,
                    name = excluded.name,
                    type = excluded.type,
                    puc_code = excluded.puc_code,
                    puc_account_id = excluded.puc_account_id,
                    puc_account_name = excluded.puc_account_name,
                    active = excluded.active,
                    updated_at = datetime('now')",
                params![
                    id,
                    code,
                    erp_code,
                    name,
                    pm_type,
                    puc_code,
                    puc_account_id,
                    puc_account_name,
                    active
                ],
            )?;
            synced_count += 1;
        }
    }

    // Desactivar en SQLite cualquier medio de pago que ya no esté activo o haya sido eliminado en el ERP
    let erp_active_ids: std::collections::HashSet<String> = payment_methods
        .iter()
        .filter(|pm| pm["active"].as_i64().unwrap_or(1) == 1)
        .filter_map(|pm| pm["id"].as_str().map(|s| s.to_string()))
        .collect();

    {
        let mut stmt = tx.prepare("SELECT id FROM payment_methods WHERE active = 1")?;
        let local_ids: Vec<String> = stmt
            .query_map([], |r| r.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        for local_id in local_ids {
            if !erp_active_ids.contains(&local_id) {
                let _ = tx.execute(
                    "UPDATE payment_methods SET active = 0, updated_at = datetime('now') WHERE id = ?1",
                    params![local_id],
                );
            }
        }
    }

    tx.commit()?;
    Ok(synced_count)
}

#[tauri::command]
pub async fn sync_payment_methods(db: State<'_, Db>) -> AppResult<usize> {
    sync_payment_methods_internal(&db).await
}

#[tauri::command]
pub async fn get_payment_methods(db: State<'_, Db>) -> AppResult<Vec<PaymentMethodDto>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, code, erp_code, name, type, puc_code, puc_account_id, puc_account_name, active, terminal_enabled
         FROM payment_methods
         ORDER BY name ASC",
    )?;

    let rows = stmt.query_map([], |r| {
        Ok(PaymentMethodDto {
            id: r.get(0)?,
            code: r.get(1)?,
            erp_code: r.get(2)?,
            name: r.get(3)?,
            r#type: r.get(4)?,
            puc_code: r.get(5)?,
            puc_account_id: r.get(6)?,
            puc_account_name: r.get(7)?,
            active: r.get(8)?,
            terminal_enabled: r.get(9)?,
        })
    })?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r?);
    }
    Ok(list)
}

#[tauri::command]
pub async fn toggle_payment_method_terminal_status(
    db: State<'_, Db>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    let conn = db.conn()?;
    let val: i64 = if enabled { 1 } else { 0 };
    conn.execute(
        "UPDATE payment_methods SET terminal_enabled = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![val, id],
    )?;
    Ok(())
}

/// 📤 Despacha las ventas pendientes en la cola outbox (sync_queue) hacia el ERP.
pub async fn dispatch_outbox_internal(db: &Db) -> AppResult<OutboxBatchResult> {
    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if token.is_empty() {
        return Ok(OutboxBatchResult { dispatched: 0, synced: 0, failed: 0 });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let mut total_dispatched = 0;
    let mut total_synced = 0;
    let mut total_failed = 0;

    // ── 1. Despacho de Ventas ('sale') ─────────────────────────────────────
    let (pending_sales, ventas_json) = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, payload FROM sync_queue WHERE entity_type = 'sale' AND status = 'pending' ORDER BY id ASC LIMIT 30"
        )?;

        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;

        let mut pending = Vec::new();
        let mut json_list = Vec::new();

        for r in rows {
            let (id, payload_str) = r?;
            if let Ok(parsed) = serde_json::from_str::<Value>(&payload_str) {
                let folio = parsed["folio"].as_str().unwrap_or_default().to_string();
                pending.push((id, folio));
                json_list.push(parsed);
            }
        }

        (pending, json_list)
    };

    if !pending_sales.is_empty() {
        total_dispatched += pending_sales.len();
        let url = format!("{}/api/pos/v1/sync/ventas", erp_url.trim_end_matches('/'));
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "ventas": ventas_json }))
            .send()
            .await;

        match resp {
            Ok(res) => {
                let is_success = res.status().is_success();
                let res_text = res.text().await.unwrap_or_default();
                let conn = db.conn()?;
                if is_success {
                    let json: Value = serde_json::from_str(&res_text).unwrap_or_default();
                    let resultados_map: std::collections::HashMap<String, (String, Option<String>)> = json["data"]["resultados"]
                        .as_array()
                        .map(|arr| {
                            arr.iter().filter_map(|item| {
                                let folio = item["folio"].as_str()?.to_string();
                                let status = item["status"].as_str().unwrap_or("failed").to_string();
                                let err = item["error"].as_str().map(|s| s.to_string());
                                Some((folio, (status, err)))
                            }).collect()
                        })
                        .unwrap_or_default();

                    for (id, folio) in &pending_sales {
                        let (status, err) = resultados_map.get(folio)
                            .cloned()
                            .unwrap_or_else(|| ("failed".to_string(), Some("Sin respuesta del ERP para este ticket".to_string())));

                        if status == "synced" || status == "skipped" {
                            let _ = conn.execute(
                                "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                                params![id],
                            );
                            total_synced += 1;
                        } else {
                            let _ = conn.execute(
                                "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                                params![err.unwrap_or_else(|| "Fallo al procesar venta en ERP".to_string()), id],
                            );
                            total_failed += 1;
                        }
                    }
                } else {
                    for (id, _) in &pending_sales {
                        let _ = conn.execute(
                            "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                            params![res_text, id],
                        );
                    }
                    total_failed += pending_sales.len();
                }
            }
            Err(e) => {
                let conn = db.conn()?;
                let err_str = e.to_string();
                for (id, _) in &pending_sales {
                    let _ = conn.execute(
                        "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                        params![err_str, id],
                    );
                }
                total_failed += pending_sales.len();
            }
        }
    }

    // ── 2. Despacho de Abonos de Cartera ('customer_payment') ───────────────
    let (pending_payments, abonos_json) = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, payload FROM sync_queue WHERE entity_type = 'customer_payment' AND status = 'pending' ORDER BY id ASC LIMIT 30"
        )?;

        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;

        let mut pending = Vec::new();
        let mut json_list = Vec::new();

        for r in rows {
            let (id, payload_str) = r?;
            if let Ok(parsed) = serde_json::from_str::<Value>(&payload_str) {
                let folio = parsed["folio"].as_str().unwrap_or_default().to_string();
                pending.push((id, folio));
                json_list.push(parsed);
            }
        }

        (pending, json_list)
    };

    if !pending_payments.is_empty() {
        total_dispatched += pending_payments.len();
        let url = format!("{}/api/pos/v1/sync/abonos", erp_url.trim_end_matches('/'));
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "abonos": abonos_json }))
            .send()
            .await;

        match resp {
            Ok(res) => {
                let is_success = res.status().is_success();
                let res_text = res.text().await.unwrap_or_default();
                let conn = db.conn()?;
                if is_success {
                    let json: Value = serde_json::from_str(&res_text).unwrap_or_default();
                    let resultados_map: std::collections::HashMap<String, (String, Option<String>)> = json["data"]["resultados"]
                        .as_array()
                        .map(|arr| {
                            arr.iter().filter_map(|item| {
                                let folio = item["folio"].as_str()?.to_string();
                                let status = item["status"].as_str().unwrap_or("failed").to_string();
                                let err = item["error"].as_str().map(|s| s.to_string());
                                Some((folio, (status, err)))
                            }).collect()
                        })
                        .unwrap_or_default();

                    for (id, folio) in &pending_payments {
                        let (status, err) = resultados_map.get(folio)
                            .cloned()
                            .unwrap_or_else(|| ("failed".to_string(), Some("Sin respuesta del ERP para este recibo de abono".to_string())));

                        if status == "synced" || status == "skipped" {
                            let _ = conn.execute(
                                "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                                params![id],
                            );
                            total_synced += 1;
                        } else {
                            let _ = conn.execute(
                                "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                                params![err.unwrap_or_else(|| "Fallo al procesar abono en ERP".to_string()), id],
                            );
                            total_failed += 1;
                        }
                    }
                } else {
                    for (id, _) in &pending_payments {
                        let _ = conn.execute(
                            "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                            params![res_text, id],
                        );
                    }
                    total_failed += pending_payments.len();
                }
            }
            Err(e) => {
                let conn = db.conn()?;
                let err_str = e.to_string();
                for (id, _) in &pending_payments {
                    let _ = conn.execute(
                        "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                        params![err_str, id],
                    );
                }
                total_failed += pending_payments.len();
            }
        }
    }

    Ok(OutboxBatchResult {
        dispatched: total_dispatched,
        synced: total_synced,
        failed: total_failed,
    })
}

#[tauri::command]
pub async fn dispatch_sync_outbox(db: State<'_, Db>) -> AppResult<OutboxBatchResult> {
    dispatch_outbox_internal(&db).await
}

/// 📡 Consulta deltas de inventario al ERP y actualiza el stock local en SQLite.
pub async fn pull_inventory_deltas_internal(db: &Db) -> AppResult<usize> {
    let (erp_url, token, last_sync) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        let last_sync = get_setting(&conn, "last_sync_timestamp").unwrap_or_default();
        (erp_url, token, last_sync)
    };

    if token.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(3000))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/inventario/deltas", erp_url.trim_end_matches('/'));
    let mut req = client.get(&url).header("Authorization", format!("Bearer {token}"));
    if !last_sync.is_empty() {
        req = req.query(&[("since", &last_sync)]);
    }

    let res = req.send().await;
    let res = match res {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(0),
    };

    let json: Value = res.json().await.unwrap_or_default();
    let deltas = match json["data"]["deltas"].as_array() {
        Some(d) => d,
        None => return Ok(0),
    };

    let conn = db.conn()?;
    let mut count = 0;
    for d in deltas {
        let p_id = d["productoId"].as_str().unwrap_or_default();
        let stock_actual = d["stockActual"].as_f64().unwrap_or(0.0);

        if !p_id.is_empty() {
            let local_info: Option<(i64, i64, i64)> = conn
                .query_row(
                    "SELECT id, is_service, is_bundle FROM products WHERE erp_id = ?1",
                    params![p_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();

            if let Some((local_id, is_service, is_bundle)) = local_info {
                if is_service == 1 || is_bundle == 1 {
                    continue;
                }

                let pending_sold_direct: f64 = conn
                    .query_row(
                        "SELECT COALESCE(SUM(si.quantity), 0) \
                         FROM sale_items si \
                         JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
                         WHERE si.product_id = ?1 AND sq.status != 'synced'",
                        params![local_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0.0);

                let pending_sold_bundle: f64 = conn
                    .query_row(
                        "SELECT COALESCE(SUM(si.quantity * pc.quantity), 0) \
                         FROM sale_items si \
                         JOIN product_components pc ON pc.parent_product_id = si.product_id \
                         JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
                         WHERE pc.child_product_id = ?1 AND sq.status != 'synced'",
                        params![local_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0.0);

                let pending_sold = pending_sold_direct + pending_sold_bundle;
                let effective_stock = (stock_actual - pending_sold).max(0.0);

                let affected = conn.execute(
                    "UPDATE products SET stock = ?1, updated_at = datetime('now') WHERE id = ?2",
                    params![effective_stock, local_id],
                );
                if let Ok(n) = affected {
                    if n > 0 {
                        count += 1;
                    }
                }
            }
        }
    }

    if let Some(ts) = json["data"]["timestamp"].as_str() {
        let _ = set_setting(&conn, "last_sync_timestamp", ts);
    }

    Ok(count)
}

#[tauri::command]
pub async fn pull_inventory_deltas(db: State<'_, Db>) -> AppResult<usize> {
    pull_inventory_deltas_internal(&db).await
}

/// ℹ️ Obtiene el estado actual de sincronización, conectividad y tamaño de la cola outbox.
pub async fn get_sync_status_internal(db: &Db) -> AppResult<SyncStatusDto> {
    let (is_paired, erp_url, token, pending_count, last_sync_at, offline_policy, critical_threshold) = {
        let conn = db.conn()?;
        let pairing_status = get_setting(&conn, "pairing_status").unwrap_or_else(|| "unpaired".into());
        let is_paired = pairing_status == "linked";
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();

        let pending_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let last_sync_at = get_setting(&conn, "last_sync_timestamp");
        let offline_policy = get_setting(&conn, "offline_stock_policy").unwrap_or_else(|| "strict".into());
        let critical_threshold: f64 = get_setting(&conn, "critical_stock_threshold")
            .and_then(|s| s.parse().ok())
            .unwrap_or(2.0);

        (is_paired, erp_url, token, pending_count, last_sync_at, offline_policy, critical_threshold)
    };

    let mut is_online = false;
    if is_paired && !token.is_empty() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()?;
        let check_url = format!("{}/api/pos/v1/terminal/estado", erp_url.trim_end_matches('/'));
        if let Ok(res) = client
            .get(&check_url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
        {
            is_online = res.status().is_success();
        }
    }

    Ok(SyncStatusDto {
        is_paired,
        is_online,
        pending_count,
        last_sync_at,
        offline_policy,
        critical_threshold,
    })
}

#[tauri::command]
pub async fn get_sync_status(db: State<'_, Db>) -> AppResult<SyncStatusDto> {
    get_sync_status_internal(&db).await
}

/// 🚀 Daemon continuo de sincronización en segundo plano.
/// Corre permanentemente en un hilo asíncrono gestionado por Tauri.
pub fn start_sync_daemon(app: tauri::AppHandle, db: Db) {
    tauri::async_runtime::spawn(async move {
        // Pausa inicial para permitir arranque completo del entorno gráfico
        tokio::time::sleep(Duration::from_secs(3)).await;

        let mut loop_count: u64 = 0;
        let mut interval = tokio::time::interval(Duration::from_secs(5));

        loop {
            interval.tick().await;
            loop_count += 1;

            // 1. Despachar Outbox si hay ventas o movimientos pendientes
            let _ = dispatch_outbox_internal(&db).await;

            // 2. Traer deltas de existencias desde el ERP cada 5 segundos
            let _ = pull_inventory_deltas_internal(&db).await;

            // 3. Sincronizar catálogo completo y precios cada 60 segundos (cada 12 ciclos de 5s)
            if loop_count % 12 == 0 {
                let _ = sync_catalog_internal(&db).await;
            }

            // 4. Sincronización asíncrona de imágenes (baja prioridad, cada 15 segundos)
            if loop_count % 3 == 0 {
                let _ = crate::commands::images::upload_pending_images_internal(&app, &db).await;
                let _ = crate::commands::images::download_pending_images_internal(&app, &db).await;
            }

            // 5. Emitir evento a la UI de React para actualizar indicadores en tiempo real
            if let Ok(status) = get_sync_status_internal(&db).await {
                use tauri::Emitter;
                let _ = app.emit("sync-status-changed", &status);
            }
        }
    });
}
