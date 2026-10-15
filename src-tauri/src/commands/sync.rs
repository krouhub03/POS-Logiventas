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

        // Primero verificamos si hay algún producto que localmente ya esté agotado o insuficiente
        for it in &items {
            let (stock, name, is_service): (f64, String, i64) = conn
                .query_row(
                    "SELECT stock, name, is_service FROM products WHERE id = ?1",
                    params![it.product_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap_or((999.0, "Producto".into(), 0));

            if is_service == 0 && stock < it.quantity {
                return Ok(VerifyStockResult {
                    ok: false,
                    motivo: if stock <= 0.0 {
                        Some("PRODUCTO_AGOTADO".into())
                    } else {
                        Some("STOCK_INSUFICIENTE".into())
                    },
                    product_id: Some(it.product_id),
                    product_name: Some(name),
                    stock_disponible: Some(stock),
                    offline_warning: None,
                });
            }
        }

        // Identificar productos con stock crítico (ej: stock <= threshold) para soft-lock en ERP
        let mut critical_items = Vec::new();
        for it in &items {
            let (stock, name, is_service, erp_id): (f64, String, i64, Option<String>) = conn
                .query_row(
                    "SELECT stock, name, is_service, erp_id FROM products WHERE id = ?1",
                    params![it.product_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap_or((999.0, "Producto".into(), 0, None));

            if is_service == 0 && stock <= threshold {
                critical_items.push(CriticalItemLocal {
                    product_id: it.product_id,
                    name,
                    quantity: it.quantity,
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
            "SELECT sku, barcode, name, unit, is_service, price_cents, cost_cents, tax_rate_bp, stock, min_stock, tags \
             FROM products WHERE active = 1 AND (erp_id IS NULL OR needs_erp_upload = 1)",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(serde_json::json!({
                "sku": r.get::<_, String>(0)?,
                "barcode": r.get::<_, Option<String>>(1)?,
                "name": r.get::<_, String>(2)?,
                "unit": r.get::<_, String>(3)?,
                "is_service": r.get::<_, i64>(4)?,
                "price_cents": r.get::<_, i64>(5)?,
                "cost_cents": r.get::<_, i64>(6)?,
                "tax_rate_bp": r.get::<_, i64>(7)?,
                "stock": r.get::<_, f64>(8)?,
                "min_stock": r.get::<_, f64>(9)?,
                "tags": r.get::<_, Option<String>>(10)?.unwrap_or_default(),
            }))
        })?;
        rows.filter_map(|r| r.ok()).collect()
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
        let controls_stock = p["controls_stock"].as_i64().unwrap_or(if is_service == 1 { 0 } else { 1 });
        let allow_negative_stock = p["allow_negative_stock"].as_i64().unwrap_or(1);
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

        // Calcular ventas locales pendientes en cola que aún no se reflejan en el ERP
        let pending_sold: f64 = if let Some(local_id) = local_match {
            tx.query_row(
                "SELECT COALESCE(SUM(si.quantity), 0) \
                 FROM sale_items si \
                 JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
                 WHERE si.product_id = ?1 AND sq.status != 'synced'",
                params![local_id],
                |r| r.get(0),
            ).unwrap_or(0.0)
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
                    updated_at = datetime('now')
                 WHERE id = ?19",
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
                    local_id
                ],
            )?;
        } else {
            tx.execute(
                "INSERT INTO products (
                    erp_id, sku, barcode, name, unit, is_service,
                    price_cents, cost_cents, tax_rate_bp, stock, min_stock, active, needs_erp_upload,
                    controls_stock, allow_negative_stock, is_bundle, tags, tax_fixed_cents, category_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?14, ?15, ?16, ?17, ?18)",
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
                    category_id
                ],
            )?;
        }

        total_synced += 1;
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
    let (erp_url, token, pending_records, ventas_json) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();

        let mut stmt = conn.prepare(
            "SELECT id, payload FROM sync_queue WHERE status = 'pending' ORDER BY id ASC LIMIT 30"
        )?;

        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;

        let mut pending_records = Vec::new();
        let mut ventas_json = Vec::new();

        for r in rows {
            let (id, payload_str) = r?;
            if let Ok(parsed) = serde_json::from_str::<Value>(&payload_str) {
                let folio = parsed["folio"].as_str().unwrap_or_default().to_string();
                pending_records.push((id, folio));
                ventas_json.push(parsed);
            }
        }

        (erp_url, token, pending_records, ventas_json)
    };

    if token.is_empty() || pending_records.is_empty() {
        return Ok(OutboxBatchResult { dispatched: 0, synced: 0, failed: 0 });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/ventas", erp_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "ventas": ventas_json }))
        .send()
        .await;

    let res = match resp {
        Ok(r) => r,
        Err(e) => {
            let conn = db.conn()?;
            let err_str = e.to_string();
            for (id, _) in &pending_records {
                let _ = conn.execute(
                    "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                    params![err_str, id],
                );
            }
            return Ok(OutboxBatchResult {
                dispatched: pending_records.len(),
                synced: 0,
                failed: pending_records.len(),
            });
        }
    };

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

        let mut synced_count = 0;
        let mut failed_count = 0;

        for (id, folio) in &pending_records {
            let (status, err) = resultados_map.get(folio)
                .cloned()
                .unwrap_or_else(|| ("failed".to_string(), Some("Sin respuesta del ERP para este ticket".to_string())));

            if status == "synced" || status == "skipped" {
                let _ = conn.execute(
                    "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                    params![id],
                );
                synced_count += 1;
            } else {
                let _ = conn.execute(
                    "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                    params![err.unwrap_or_else(|| "Fallo al procesar venta en ERP".to_string()), id],
                );
                failed_count += 1;
            }
        }

        Ok(OutboxBatchResult {
            dispatched: pending_records.len(),
            synced: synced_count,
            failed: failed_count,
        })
    } else {
        for (id, _) in &pending_records {
            let _ = conn.execute(
                "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                params![res_text, id],
            );
        }
        Ok(OutboxBatchResult {
            dispatched: pending_records.len(),
            synced: 0,
            failed: pending_records.len(),
        })
    }
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
            let local_info: Option<(i64, i64)> = conn
                .query_row(
                    "SELECT id, is_service FROM products WHERE erp_id = ?1",
                    params![p_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();

            if let Some((local_id, is_service)) = local_info {
                if is_service == 1 {
                    continue;
                }

                let pending_sold: f64 = conn
                    .query_row(
                        "SELECT COALESCE(SUM(si.quantity), 0) \
                         FROM sale_items si \
                         JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
                         WHERE si.product_id = ?1 AND sq.status != 'synced'",
                        params![local_id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0.0);

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

            // 4. Emitir evento a la UI de React para actualizar indicadores en tiempo real
            if let Ok(status) = get_sync_status_internal(&db).await {
                use tauri::Emitter;
                let _ = app.emit("sync-status-changed", &status);
            }
        }
    });
}
