use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, State};

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
    sku: String,
    barcode: Option<String>,
    name: String,
    quantity: f64,
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
    let (erp_url, token, critical_items) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url")
            .or_else(|| get_setting(&conn, "erp_api_url"))
            .unwrap_or_else(|| "https://metahabi.com".into());
        let token = get_setting(&conn, "terminal_token")
            .or_else(|| get_setting(&conn, "erp_api_token"))
            .unwrap_or_default();
        let threshold = get_setting(&conn, "critical_stock_threshold")
            .and_then(|s| s.parse().ok())
            .unwrap_or(2.0);

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

        let pending_deltas_map = compute_all_pending_stock_deltas(&conn);

        // Primero verificamos si hay algún producto físico que localmente ya esté agotado o insuficiente
        let mut critical_items = Vec::new();
        for (&prod_id, &req_qty) in &required_by_product {
            let (stock, name, is_service, controls_stock, _allow_neg, erp_id, sku, barcode, needs_erp_upload): (
                f64,
                String,
                i64,
                i64,
                i64,
                Option<String>,
                String,
                Option<String>,
                i64,
            ) = conn
                .query_row(
                    "SELECT stock, name, is_service, controls_stock, allow_negative_stock, erp_id, sku, barcode, COALESCE(needs_erp_upload, 0) FROM products WHERE id = ?1",
                    params![prod_id],
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
                        ))
                    },
                )
                .unwrap_or((999.0, "Producto".into(), 0, 1, 0, None, String::new(), None, 0));

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

            let pending_delta = pending_deltas_map.get(&prod_id).copied().unwrap_or(0.0);
            let is_synced_with_erp = erp_id.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false)
                && needs_erp_upload == 0
                && pending_delta.abs() < 1e-9;

            // Solo consultar reserva multi-caja en el ERP si el producto ya está sincronizado y sin cambios locales pendientes
            if is_service == 0 && controls_stock != 0 && stock <= threshold && is_synced_with_erp {
                critical_items.push(CriticalItemLocal {
                    product_id: prod_id,
                    sku,
                    barcode,
                    name,
                    quantity: req_qty,
                    erp_id,
                });
            }
        }
        (erp_url, token, critical_items)
    };

    // Si ningún ítem requiere consulta de reserva remota, aprobamos de inmediato en local sin latencia de red
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

    // 2. Consulta de reserva atómica en tiempo real contra el ERP para evitar colisiones entre cajas
    let payload_items: Vec<serde_json::Value> = critical_items
        .iter()
        .map(|it| {
            let p_id_str = it.erp_id.clone().unwrap_or_else(|| it.product_id.to_string());
            serde_json::json!({
                "productId": p_id_str,
                "erpProductId": it.erp_id,
                "sku": it.sku,
                "barcode": it.barcode,
                "quantity": it.quantity
            })
        })
        .collect();

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
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
                let p_id_str = data["productoId"].as_str().unwrap_or_default();

                let matched_item = critical_items
                    .iter()
                    .find(|it| {
                        it.erp_id.as_deref() == Some(p_id_str)
                            || it.product_id.to_string() == p_id_str
                            || (!p_id_str.is_empty() && it.sku == p_id_str)
                    })
                    .or_else(|| critical_items.first());

                let resolved_local_id = matched_item.map(|it| it.product_id);
                let resolved_name = p_nombre.or_else(|| matched_item.map(|it| it.name.clone()));

                // Únicamente bloquear si otra caja física tiene reservada activamente la última unidad en este instante.
                // Si el ERP aún no tiene el stock local sincronizado (PRODUCTO_NO_EXISTE, SIN_BODEGA o desfase pendiente),
                // encolamos el producto para subida y permitimos la venta bajo política Offline-First sin pisar el stock local.
                if motivo == "RESERVADO_OTRA_CAJA" {
                    Ok(VerifyStockResult {
                        ok: false,
                        motivo: Some(motivo),
                        product_id: resolved_local_id,
                        product_name: resolved_name,
                        stock_disponible: disp,
                        offline_warning: Some(false),
                    })
                } else {
                    if let Some(local_id) = resolved_local_id {
                        if let Ok(conn) = db.conn() {
                            let _ = conn.execute(
                                "UPDATE products SET needs_erp_upload = 1 WHERE id = ?1",
                                params![local_id],
                            );
                        }
                    }
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
        _ => {
            // Conexión no disponible o error de red: bajo arquitectura Offline-First,
            // habiendo validado que existe stock local suficiente en SQLite, siempre permitimos la venta.
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

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
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
#[allow(dead_code)]
pub async fn sync_catalog_internal(db: &Db) -> AppResult<usize> {
    sync_catalog_internal_mode(db, false).await
}

pub async fn sync_catalog_internal_mode(db: &Db, force_full: bool) -> AppResult<usize> {
    let (erp_url, token, last_catalog_sync_at) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").ok_or_else(|| {
            AppError::Auth("Terminal no vinculada con el ERP".into())
        })?;
        let last_catalog_sync_at = get_setting(&conn, "last_catalog_sync_at").unwrap_or_default();
        (erp_url, token, last_catalog_sync_at)
    };

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
        .timeout(Duration::from_secs(90))
        .build()?;

    // 0. Despachar Outbox primero para que el ERP consolide ventas antes de retornarnos el stock
    let _ = dispatch_outbox_internal(db).await;

    // Sincronizar catálogo de bodegas
    let _ = sync_warehouses_internal(db).await;

    // 1. Extraer productos creados o modificados localmente en el POS para subir al ERP
    struct UnsyncedProductRow {
        id: i64,
        erp_id: Option<String>,
        sku: String,
        barcode: Option<String>,
        name: String,
        unit: String,
        is_service: i64,
        price_cents: i64,
        cost_cents: i64,
        tax_rate_bp: i64,
        stock: f64,
        min_stock: f64,
        tags: String,
        is_bundle: i64,
        category_name: String,
        active: i64,
        updated_at: Option<String>,
    }

    let unsynced_products: Vec<serde_json::Value> = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT p.id, p.erp_id, p.sku, p.barcode, p.name, p.unit, p.is_service, p.price_cents, p.cost_cents, \
                    p.tax_rate_bp, p.stock, p.min_stock, p.tags, p.is_bundle, COALESCE(c.name, 'General'), p.active, p.updated_at \
             FROM products p \
             LEFT JOIN categories c ON c.id = p.category_id \
             WHERE p.needs_erp_upload = 1",
        )?;
        let rows: Vec<UnsyncedProductRow> = stmt
            .query_map([], |r| {
                Ok(UnsyncedProductRow {
                    id: r.get(0)?,
                    erp_id: r.get(1)?,
                    sku: r.get(2)?,
                    barcode: r.get(3)?,
                    name: r.get(4)?,
                    unit: r.get(5)?,
                    is_service: r.get(6)?,
                    price_cents: r.get(7)?,
                    cost_cents: r.get(8)?,
                    tax_rate_bp: r.get(9)?,
                    stock: r.get(10)?,
                    min_stock: r.get(11)?,
                    tags: r.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    is_bundle: r.get::<_, i64>(13).unwrap_or(0),
                    category_name: r.get::<_, String>(14).unwrap_or_else(|_| "General".to_string()),
                    active: r.get::<_, i64>(15).unwrap_or(1),
                    updated_at: r.get(16)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        let mut list = Vec::new();
        for row in rows {
            let mut components_json = Vec::new();
            if row.is_bundle == 1 {
                if let Ok(mut c_stmt) = conn.prepare(
                    "SELECT p.sku, pc.quantity FROM product_components pc JOIN products p ON p.id = pc.child_product_id WHERE pc.parent_product_id = ?1 ORDER BY pc.order_index ASC",
                ) {
                    if let Ok(c_rows) = c_stmt.query_map(params![row.id], |cr| {
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
                "erpId": row.erp_id,
                "sku": row.sku,
                "barcode": row.barcode,
                "name": row.name,
                "category": row.category_name,
                "unit": row.unit,
                "is_service": row.is_service,
                "is_bundle": row.is_bundle,
                "price_cents": row.price_cents,
                "cost_cents": row.cost_cents,
                "tax_rate_bp": row.tax_rate_bp,
                "stock": row.stock,
                "min_stock": row.min_stock,
                "tags": row.tags,
                "active": row.active,
                "updatedAt": row.updated_at,
                "components": components_json,
            }));
        }
        list
    };

    // 2. Subir productos locales modificados o nuevos hacia el ERP en lotes seguros de 50
    let mut uploaded_stocks_by_sku: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for item in &unsynced_products {
        if let (Some(s), Some(st)) = (item["sku"].as_str(), item["stock"].as_f64()) {
            uploaded_stocks_by_sku.insert(s.to_string(), st);
        }
    }

    let mut upload_error: Option<String> = None;
    if !unsynced_products.is_empty() {
        let post_url = format!("{}/api/pos/v1/sync/productos", erp_url.trim_end_matches('/'));
        for chunk in unsynced_products.chunks(50) {
            match client
                .post(&post_url)
                .header("Authorization", format!("Bearer {token}"))
                .json(&serde_json::json!({ "products": chunk }))
                .send()
                .await
            {
                Ok(res) => {
                    if res.status().is_success() {
                        if let Ok(json) = res.json::<Value>().await {
                            if let Some(arr) = json["data"]["productos"].as_array() {
                                let conn = db.conn()?;
                                for item in arr {
                                    let sku = item["sku"].as_str().unwrap_or_default();
                                    let status = item["status"].as_str().unwrap_or("ok");
                                    if status == "rechazado" {
                                        let msg = item["mensaje"].as_str().unwrap_or("Producto rechazado por el ERP");
                                        upload_error = Some(format!("SKU {sku}: {msg}"));
                                        continue;
                                    }
                                    let erp_id = item["erpId"].as_str().unwrap_or_default();
                                    if !erp_id.is_empty() || !sku.is_empty() {
                                        if status == "conflicto_erp_mas_reciente" {
                                            if let Some(erp_price) = item["price_cents"].as_i64() {
                                                let _ = conn.execute(
                                                    "UPDATE products SET erp_id = ?1, price_cents = ?2, needs_erp_upload = 0 WHERE erp_id = ?1 OR sku = ?3",
                                                    params![erp_id, erp_price, sku],
                                                );
                                                continue;
                                            }
                                        }
                                        let _ = conn.execute(
                                            "UPDATE products SET erp_id = ?1, needs_erp_upload = 0 WHERE erp_id = ?1 OR sku = ?2",
                                            params![erp_id, sku],
                                        );
                                    }
                                }
                            }
                        }
                    } else {
                        let status_code = res.status();
                        let err_body = res.text().await.unwrap_or_default();
                        upload_error = Some(format!("Error HTTP {status_code} al subir productos al ERP: {err_body}"));
                    }
                }
                Err(e) => {
                    upload_error = Some(format!("Error de red al subir productos al ERP: {e}"));
                }
            }
        }
    }

    // 2.1 Subir imágenes pendientes de productos modificados o creados hacia el ERP
    let _ = crate::commands::images::upload_pending_images_db(db).await;

    // 3. Descargar catálogo (incremental si ya tenemos last_catalog_sync_at y no es forzado)
    let url = format!("{}/api/pos/v1/sync/productos", erp_url.trim_end_matches('/'));
    let mut get_req = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"));
    if !force_full && !last_catalog_sync_at.is_empty() {
        get_req = get_req.query(&[("since", &last_catalog_sync_at)]);
    }
    let res = get_req.send().await?;

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

    let is_incremental = json["data"]["incremental"].as_bool().unwrap_or(false);
    let server_timestamp = json["data"]["timestamp"].as_str().map(|s| s.to_string());

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
        let pending_deltas_map = compute_all_pending_stock_deltas(&tx);

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

            // Buscar si ya existe localmente por erp_id o sku (usando caché de prepared statements)
            let local_match: Option<i64> = if !erp_id.is_empty() {
                tx.prepare_cached("SELECT id FROM products WHERE erp_id = ?1")?
                    .query_row(params![erp_id], |r| r.get(0))
                    .ok()
            } else {
                None
            }
            .or_else(|| {
                tx.prepare_cached("SELECT id FROM products WHERE sku = ?1")
                    .ok()?
                    .query_row(params![sku], |r| r.get(0))
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
                        .prepare_cached("SELECT id, active FROM products WHERE barcode = ?1")?
                        .query_row(params![bc], |r| Ok((r.get(0)?, r.get(1)?)))
                        .ok();

                    match other_row {
                        Some((other_id, other_active)) => {
                            if Some(other_id) == local_match {
                                // Es el mismo producto
                                resolved_barcode = Some(bc.to_string());
                                used_barcodes.insert(bc.to_string());
                            } else if other_active == 0 {
                                // El otro producto está inactivo: liberamos su código de barras
                                let _ = tx.prepare_cached("UPDATE products SET barcode = NULL WHERE id = ?1")?
                                    .execute(params![other_id]);
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

            // Delta neto pre-calculado en memoria O(1) para evitar N*M consultas SQL secuenciales
            let pending_net_delta: f64 = if let Some(local_id) = local_match {
                pending_deltas_map.get(&local_id).copied().unwrap_or(0.0)
            } else {
                0.0
            };

        let effective_stock = if controls_stock == 0 {
            0.0
        } else {
            (stock + pending_net_delta).max(0.0)
        };

        let category_str = p["category"].as_str().unwrap_or("General").trim();
        let erp_category_id: Option<i64> = if !category_str.is_empty() && !category_str.eq_ignore_ascii_case("General") {
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

        // Si el ERP devuelve "General" pero el producto local ya tenía un Departamento específico (ej. importado de Eleventa), preservar el local
        let category_id: Option<i64> = if erp_category_id.is_some() {
            erp_category_id
        } else if let Some(lid) = local_match {
            tx.query_row("SELECT category_id FROM products WHERE id = ?1", params![lid], |r| r.get::<_, Option<i64>>(0))
                .ok()
                .flatten()
        } else {
            None
        };

        let erp_image_url = p["image_url"].as_str().map(str::trim).filter(|s| !s.is_empty());
        let erp_image_hash = p["image_hash"].as_str().map(str::trim).filter(|s| !s.is_empty());

        let (
            current_img_hash,
            current_local_path,
            current_sync_status,
            local_needs_upload,
            local_stock,
            local_price_cents,
            local_cost_cents,
        ): (Option<String>, Option<String>, Option<String>, i64, f64, i64, i64) = if let Some(lid) = local_match {
            tx.query_row(
                "SELECT image_hash, image_local_path, image_sync_status, COALESCE(needs_erp_upload, 0), COALESCE(stock, 0), COALESCE(price_cents, 0), COALESCE(cost_cents, 0) FROM products WHERE id = ?1",
                params![lid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .unwrap_or((None, None, None, 0, 0.0, price_cents, cost_cents))
        } else {
            (None, None, None, 0, 0.0, price_cents, cost_cents)
        };

        // Si el producto aún tiene cambios locales pendientes de subir al ERP (needs_erp_upload == 1),
        // preservamos por fila su precio, costo y stock locales para jamás revertir ediciones del cajero
        // ante un fallo temporal de red, sin bloquear la descarga del resto del catálogo.
        let (final_stock, final_needs_upload) = if local_needs_upload == 1 {
            (local_stock, 1_i64)
        } else if let Some(&just_uploaded_stock) = uploaded_stocks_by_sku.get(sku) {
            if just_uploaded_stock > 0.0 && effective_stock <= 0.0 && is_service == 0 && is_bundle == 0 {
                ((just_uploaded_stock + pending_net_delta).max(0.0), 1_i64)
            } else {
                (effective_stock, 0_i64)
            }
        } else {
            (effective_stock, 0_i64)
        };

        let final_price_cents = if local_needs_upload == 1 { local_price_cents } else { price_cents };
        let final_cost_cents = if local_needs_upload == 1 { local_cost_cents } else { cost_cents };

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
            let upd_res = tx.prepare_cached(
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
                    needs_erp_upload = ?13,
                    controls_stock = ?14,
                    allow_negative_stock = ?15,
                    is_bundle = ?16,
                    tags = ?17,
                    tax_fixed_cents = ?18,
                    category_id = ?19,
                    image_url = ?20,
                    image_local_path = ?21,
                    image_hash = ?22,
                    image_sync_status = ?23,
                    updated_at = CASE WHEN ?13 = 1 THEN updated_at ELSE datetime('now') END
                 WHERE id = ?24",
            )?
            .execute(params![
                erp_id,
                sku,
                resolved_barcode,
                name,
                unit,
                is_service,
                final_price_cents,
                final_cost_cents,
                tax_rate_bp,
                final_stock,
                min_stock,
                active,
                final_needs_upload,
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
            ]);
            if let Err(e) = upd_res {
                eprintln!("[sync_catalog] Error actualizando producto SKU {sku} (id={local_id}): {e}");
                continue;
            }
        } else {
            let ins_res = tx.prepare_cached(
                "INSERT INTO products (
                    erp_id, sku, barcode, name, unit, is_service,
                    price_cents, cost_cents, tax_rate_bp, stock, min_stock, active, needs_erp_upload,
                    controls_stock, allow_negative_stock, is_bundle, tags, tax_fixed_cents, category_id,
                    image_url, image_local_path, image_hash, image_sync_status
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            )?
            .execute(params![
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
            ]);
            if let Err(e) = ins_res {
                eprintln!("[sync_catalog] Error insertando producto SKU {sku}: {e}");
                continue;
            }
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
    // (solo en sincronización completa, nunca en incremental)
    if !is_incremental {
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
    }

        if let Some(ref ts) = server_timestamp {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES ('last_catalog_sync_at', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1",
                params![ts],
            )?;
            tx.execute(
                "INSERT INTO settings (key, value) VALUES ('last_sync_timestamp', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1",
                params![ts],
            )?;
        } else {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES ('last_catalog_sync_at', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
                [],
            )?;
            tx.execute(
                "INSERT INTO settings (key, value) VALUES ('last_sync_timestamp', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
                [],
            )?;
        }

        tx.commit()?;
        Ok::<usize, AppError>(total_synced)
    }?;

    // Sincronizar también los medios de pago, bodegas y clientes vinculados
    let _ = sync_payment_methods_internal(db).await;
    let _ = sync_warehouses_internal(db).await;
    let _ = sync_customers_internal(db).await;

    if let Some(err_msg) = upload_error {
        return Err(AppError::Validation(err_msg));
    }

    Ok(total_synced)
}

#[tauri::command]
pub async fn sync_catalog_from_erp(app: AppHandle, db: State<'_, Db>) -> AppResult<usize> {
    let count = sync_catalog_internal_mode(&db, true).await?;
    let _ = crate::commands::images::download_pending_images_internal(&app, &db).await;
    Ok(count)
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

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
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

/// 🏢 Sincroniza las bodegas activas de la empresa desde el ERP.
pub async fn sync_warehouses_internal(db: &Db) -> AppResult<usize> {
    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if token.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
        .timeout(Duration::from_secs(10))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/bodegas", erp_url.trim_end_matches('/'));
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
    let warehouses = match json["data"]["warehouses"].as_array() {
        Some(arr) => arr,
        None => return Ok(0),
    };

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    let mut count = 0;
    for w in warehouses {
        let id = w["id"].as_str().unwrap_or_default();
        let code = w["code"].as_str().unwrap_or_default();
        let name = w["name"].as_str().unwrap_or_default();
        let is_default = if w["isDefault"].as_bool().unwrap_or(false) { 1 } else { 0 };
        let active = if w["active"].as_bool().unwrap_or(true) { 1 } else { 0 };

        if !id.is_empty() && !code.is_empty() {
            // Verificar si ya existe una bodega por código o por id
            let existing: Option<(String, String)> = tx
                .query_row(
                    "SELECT id, name FROM warehouses WHERE code = ?1 OR id = ?2 LIMIT 1",
                    params![code, id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;

            match existing {
                Some((old_id, _)) if old_id != id => {
                    // Migrar movimientos locales vinculados al id provisional previo (ej. 'bod-default')
                    let _ = tx.execute(
                        "UPDATE inventory_movements SET warehouse_id = ?1 WHERE warehouse_id = ?2",
                        params![id, old_id],
                    );
                    tx.execute(
                        "UPDATE warehouses 
                         SET id = ?1, code = ?2, name = ?3, is_default = ?4, active = ?5, updated_at = datetime('now') 
                         WHERE id = ?6",
                        params![id, code, name, is_default, active, old_id],
                    )?;
                }
                Some((matched_id, _)) => {
                    tx.execute(
                        "UPDATE warehouses 
                         SET code = ?1, name = ?2, is_default = ?3, active = ?4, updated_at = datetime('now') 
                         WHERE id = ?5",
                        params![code, name, is_default, active, matched_id],
                    )?;
                }
                None => {
                    tx.execute(
                        "INSERT INTO warehouses (id, code, name, is_default, active, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
                        params![id, code, name, is_default, active],
                    )?;
                }
            }
            count += 1;
        }
    }

    if let Some(default_wh) = json["data"]["defaultWarehouseId"].as_str() {
        if !default_wh.is_empty() {
            let _ = set_setting(&tx, "default_warehouse_id", default_wh);
        }
    }

    // Actualizar también bodega_id y bodega_nombre en settings para que la terminal siempre refleje el nombre más reciente
    let curr_bodega_id = get_setting(&tx, "bodega_id").unwrap_or_default();
    for w in warehouses {
        let wid = w["id"].as_str().unwrap_or_default();
        let wname = w["name"].as_str().unwrap_or_default();
        let is_default = w["isDefault"].as_bool().unwrap_or(false);
        if (!curr_bodega_id.is_empty() && curr_bodega_id == wid) || (curr_bodega_id.is_empty() && is_default) {
            let _ = set_setting(&tx, "bodega_id", wid);
            let _ = set_setting(&tx, "bodega_nombre", wname);
            break;
        }
    }

    if let Some(cajas_arr) = json["data"]["cajas"].as_array() {
        upsert_pos_terminals_from_json(&tx, cajas_arr);
    }

    tx.commit()?;
    Ok(count)
}

fn upsert_pos_terminals_from_json(conn: &rusqlite::Connection, cajas_arr: &[Value]) {
    for c in cajas_arr {
        let id = c["id"].as_str().unwrap_or_default();
        let code = c["code"].as_str().unwrap_or_default();
        let name = c["name"].as_str().unwrap_or_default();
        let wh_id = c["warehouseId"].as_str();
        let is_current = if c["isCurrent"].as_bool().unwrap_or(false) { 1 } else { 0 };
        let active = if c["active"].as_bool().unwrap_or(true) { 1 } else { 0 };

        if !id.is_empty() && !code.is_empty() {
            let _ = conn.execute(
                "INSERT INTO pos_terminals (id, code, name, warehouse_id, is_current, active, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
                 ON CONFLICT(id) DO UPDATE SET
                    code = excluded.code,
                    name = excluded.name,
                    warehouse_id = excluded.warehouse_id,
                    is_current = excluded.is_current,
                    active = excluded.active,
                    updated_at = datetime('now')",
                params![id, code, name, wh_id, is_current, active],
            );
        }
    }
}

#[tauri::command]
pub async fn sync_warehouses(db: State<'_, Db>) -> AppResult<usize> {
    sync_warehouses_internal(&db).await
}

/// 👥 Sincroniza bidireccionalmente los clientes de la empresa (primero sube pendientes locales y luego descarga del ERP).
pub async fn sync_customers_internal(db: &Db) -> AppResult<usize> {
    // 0. Reactivar registros fallidos de clientes/ventas/abonos y auto-encolar clientes locales sin erp_id
    if let Ok(conn) = db.conn() {
        let _ = conn.execute(
            "UPDATE sync_queue SET status = 'pending', attempts = 0 \
             WHERE entity_type IN ('customer', 'sale', 'customer_payment') AND status = 'failed'",
            [],
        );

        let missing_rows: Vec<(i64, String, Option<String>, Option<String>, Option<String>, Option<String>, i64, i32, i32, Option<String>, i32)> = {
            let mut stmt = conn.prepare(
                "SELECT c.id, c.name, c.tax_id, c.email, c.phone, c.address, \
                        COALESCE(c.credit_limit_cents, 0), COALESCE(c.credit_days, 30), \
                        COALESCE(c.is_credit_blocked, 0), c.notes, COALESCE(c.active, 1) \
                 FROM customers c \
                 WHERE c.erp_id IS NULL AND c.active = 1 \
                   AND NOT EXISTS ( \
                     SELECT 1 FROM sync_queue sq \
                     WHERE sq.entity_type = 'customer' AND sq.entity_id = c.id AND sq.status = 'pending' \
                   )",
            )?;
            let rows = stmt.query_map([], |r| {
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
                ))
            })?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for (cid, name, tax_id, email, phone, address, credit_limit_cents, credit_days, is_blocked, notes, active) in missing_rows {
            let payload = serde_json::json!({
                "localId": cid,
                "erpId": serde_json::Value::Null,
                "name": name,
                "taxId": tax_id,
                "email": email,
                "phone": phone,
                "address": address,
                "creditLimitCents": credit_limit_cents,
                "creditDays": credit_days,
                "isCreditBlocked": is_blocked == 1,
                "notes": notes,
                "active": active == 1,
            });
            let _ = conn.execute(
                "INSERT INTO sync_queue (entity_type, entity_id, payload, status) VALUES ('customer', ?1, ?2, 'pending')",
                params![cid, payload.to_string()],
            );
        }
    }

    // 1. Empujar primero cualquier cliente nuevo o modificado y sus ventas/abonos en esta caja
    let _ = dispatch_outbox_internal(db).await;

    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url")
            .or_else(|| get_setting(&conn, "erp_api_url"))
            .unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if token.is_empty() {
        return Ok(0);
    }

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
        .timeout(Duration::from_secs(20))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/clientes", erp_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(AppError::Validation(format!(
            "Error HTTP al sincronizar clientes: {}",
            resp.status()
        )));
    }

    let json: serde_json::Value = resp.json().await?;
    let customers = json["data"]["customers"]
        .as_array()
        .or_else(|| json["customers"].as_array());

    let mut count = 0;
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    // Identificar clientes que aún tengan cambios pendientes de subir para no sobreescribirlos
    let pending_customer_ids: std::collections::HashSet<i64> = {
        let mut stmt = tx.prepare(
            "SELECT entity_id FROM sync_queue WHERE entity_type = 'customer' AND status = 'pending' AND entity_id IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };

    // Pre-calcular deltas de cartera (CxC) pendientes en sync_queue para evitar sobreescritura/doble conteo
    let mut pending_credit_by_customer: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare(
            "SELECT payload FROM sync_queue WHERE entity_type = 'sale' AND status IN ('pending', 'in_flight')",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for payload_str in rows.flatten() {
            if let Ok(parsed) = serde_json::from_str::<Value>(&payload_str) {
                if let Some(cid) = parsed["customerId"].as_i64().filter(|&id| id > 0) {
                    if let Some(payments) = parsed["payments"].as_array() {
                        let credit_sum: i64 = payments
                            .iter()
                            .filter(|p| {
                                let m = p["method"].as_str().unwrap_or_default().to_lowercase();
                                let erp = p["erpCode"].as_str().unwrap_or_default().to_uppercase();
                                m == "credit"
                                    || erp == "CREDITO"
                                    || erp.contains("CREDITO")
                                    || m.contains("credito")
                                    || m.contains("crédito")
                                    || m.contains("fiar")
                                    || m.contains("cartera")
                            })
                            .filter_map(|p| p["amountCents"].as_i64())
                            .sum();
                        if credit_sum > 0 {
                            *pending_credit_by_customer.entry(cid).or_insert(0) += credit_sum;
                        }
                    }
                }
            }
        }
    }

    let mut pending_payment_by_customer: std::collections::HashMap<i64, i64> =
        std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare(
            "SELECT payload FROM sync_queue WHERE entity_type = 'customer_payment' AND status IN ('pending', 'in_flight')",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for payload_str in rows.flatten() {
            if let Ok(parsed) = serde_json::from_str::<Value>(&payload_str) {
                if let Some(cid) = parsed["customerId"].as_i64().filter(|&id| id > 0) {
                    let amt = parsed["amountCents"].as_i64().unwrap_or(0);
                    if amt > 0 {
                        *pending_payment_by_customer.entry(cid).or_insert(0) += amt;
                    }
                }
            }
        }
    }

    if let Some(list) = customers {
        for c in list {
            let erp_id = c["erpId"]
                .as_str()
                .or_else(|| c["id"].as_str())
                .unwrap_or_default()
                .trim();
            let name = c["name"].as_str().unwrap_or_default().trim();

            if erp_id.is_empty() || name.is_empty() {
                continue;
            }

            let tax_id = c["taxId"]
                .as_str()
                .or_else(|| c["tax_id"].as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty() && !s.starts_with("POS-SIN-DOC-"));
            let email = c["email"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let phone = c["phone"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let address = c["address"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let credit_limit_cents = c["creditLimitCents"]
                .as_i64()
                .or_else(|| c["credit_limit_cents"].as_i64())
                .unwrap_or(0);
            let erp_balance_cents = c["currentBalanceCents"]
                .as_i64()
                .or_else(|| c["current_balance_cents"].as_i64())
                .unwrap_or(0)
                .max(0);
            let is_credit_blocked: i32 = if c["isCreditBlocked"]
                .as_bool()
                .or_else(|| c["is_credit_blocked"].as_bool())
                .unwrap_or(false)
            {
                1
            } else {
                0
            };
            let notes = c["notes"].as_str().map(str::trim).filter(|s| !s.is_empty());
            let credit_days = c["creditDays"]
                .as_i64()
                .or_else(|| c["credit_days"].as_i64())
                .unwrap_or(30) as i32;
            let active = c["active"].as_i64().unwrap_or(1) as i32;

            // Buscar coincidencia local por erp_id o por tax_id
            let mut local_id_opt: Option<i64> = tx
                .query_row(
                    "SELECT id FROM customers WHERE erp_id = ?1 LIMIT 1",
                    params![erp_id],
                    |r| r.get(0),
                )
                .ok();

            if local_id_opt.is_none() {
                if let Some(tid) = tax_id {
                    local_id_opt = tx
                        .query_row(
                            "SELECT id FROM customers WHERE tax_id = ?1 LIMIT 1",
                            params![tid],
                            |r| r.get(0),
                        )
                        .ok();
                }
            }

            if local_id_opt.is_none() && tax_id.is_none() {
                local_id_opt = tx
                    .query_row(
                        "SELECT id FROM customers WHERE erp_id IS NULL AND LOWER(name) = LOWER(?1) LIMIT 1",
                        params![name],
                        |r| r.get(0),
                    )
                    .ok();
            }

            let resolved_local_id = if let Some(local_id) = local_id_opt {
                let pending_credit = pending_credit_by_customer.get(&local_id).copied().unwrap_or(0);
                let pending_payment = pending_payment_by_customer.get(&local_id).copied().unwrap_or(0);
                let effective_balance_cents = (erp_balance_cents + pending_credit - pending_payment).max(0);

                if pending_customer_ids.contains(&local_id) {
                    let _ = tx.execute(
                        "UPDATE customers SET erp_id = COALESCE(erp_id, ?1), current_balance_cents = ?2 WHERE id = ?3",
                        params![erp_id, effective_balance_cents, local_id],
                    );
                } else {
                    let local_limit: i64 = tx
                        .query_row(
                            "SELECT COALESCE(credit_limit_cents, 0) FROM customers WHERE id = ?1",
                            params![local_id],
                            |r| r.get(0),
                        )
                        .unwrap_or(0);
                    let final_limit_cents = if credit_limit_cents > 0 {
                        credit_limit_cents
                    } else {
                        local_limit
                    };

                    tx.execute(
                        "UPDATE customers \
                         SET erp_id = ?1, name = ?2, tax_id = COALESCE(?3, tax_id), \
                             email = COALESCE(?4, email), phone = COALESCE(?5, phone), \
                             address = COALESCE(?6, address), credit_limit_cents = ?7, \
                             current_balance_cents = ?8, is_credit_blocked = ?9, \
                             credit_days = ?10, notes = COALESCE(?11, notes), active = ?12 \
                         WHERE id = ?13",
                        params![
                            erp_id,
                            name,
                            tax_id,
                            email,
                            phone,
                            address,
                            final_limit_cents,
                            effective_balance_cents,
                            is_credit_blocked,
                            credit_days,
                            notes,
                            active,
                            local_id,
                        ],
                    )?;

                    // Si la caja tenía un cupo autorizado local mayor a 0 que aún no estaba en el ERP, encolarlo para propagarlo a todas las cajas
                    if local_limit > 0 && credit_limit_cents == 0 {
                        let sync_payload = serde_json::json!({
                            "localId": local_id,
                            "erpId": erp_id,
                            "name": name,
                            "taxId": tax_id,
                            "email": email,
                            "phone": phone,
                            "address": address,
                            "creditLimitCents": local_limit,
                            "creditDays": credit_days,
                            "isCreditBlocked": is_credit_blocked == 1,
                            "notes": notes,
                            "active": active == 1,
                        });
                        let _ = tx.execute(
                            "INSERT INTO sync_queue (entity_type, entity_id, payload, status) VALUES ('customer', ?1, ?2, 'pending')",
                            params![local_id, sync_payload.to_string()],
                        );
                    }
                }
                local_id
            } else {
                tx.execute(
                    "INSERT INTO customers (erp_id, name, tax_id, email, phone, address, credit_limit_cents, current_balance_cents, is_credit_blocked, credit_days, notes, active) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        erp_id,
                        name,
                        tax_id,
                        email,
                        phone,
                        address,
                        credit_limit_cents,
                        erp_balance_cents,
                        is_credit_blocked,
                        credit_days,
                        notes,
                        active,
                    ],
                )?;
                tx.last_insert_rowid()
            };

            if c["creditSales"].is_array() || c["payments"].is_array() {
                let cache_key = format!("customer_remote_movements_{}", resolved_local_id);
                let cache_val = serde_json::json!({
                    "currentBalanceCents": erp_balance_cents,
                    "creditLimitCents": credit_limit_cents,
                    "isCreditBlocked": is_credit_blocked == 1,
                    "creditSales": c["creditSales"],
                    "payments": c["payments"],
                });
                let _ = set_setting(&tx, &cache_key, &cache_val.to_string());
            }

            count += 1;
        }
    }

    tx.commit()?;
    Ok(count)
}

#[tauri::command]
pub async fn sync_customers(db: State<'_, Db>) -> AppResult<usize> {
    sync_customers_internal(&db).await
}

#[tauri::command]
pub async fn query_remote_kardex(
    db: State<'_, Db>,
    filter: crate::models::product::KardexFilterInput,
) -> AppResult<serde_json::Value> {
    let (erp_url, token, erp_product_id, sku) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url")
            .or_else(|| get_setting(&conn, "erp_api_url"))
            .unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").ok_or_else(|| {
            AppError::Auth("Terminal no vinculada con el ERP".into())
        })?;

        let mut erp_prod_id = None;
        let mut prod_sku = None;

        if let Some(pid) = filter.product_id {
            if let Ok(row) = conn.query_row(
                "SELECT erp_id, sku FROM products WHERE id = ?1",
                rusqlite::params![pid],
                |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)),
            ) {
                erp_prod_id = row.0;
                prod_sku = row.1;
            }
        }

        (erp_url, token, erp_prod_id, prod_sku)
    };

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
        .timeout(Duration::from_secs(12))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/kardex", erp_url.trim_end_matches('/'));

    let payload = serde_json::json!({
        "warehouseId": filter.warehouse_id,
        "cajaId": filter.caja_id,
        "productId": filter.product_id,
        "erpProductId": erp_product_id,
        "sku": sku,
        "timePreset": filter.time_preset,
        "fromDate": filter.from_date,
        "toDate": filter.to_date,
        "limit": filter.limit.unwrap_or(200),
        "offset": filter.offset.unwrap_or(0),
    });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Validation(format!("Error de red al consultar Kardex remoto: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Validation(format!(
            "Servidor respondió con código de error {}",
            resp.status()
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Validation(format!("Respuesta inválida del servidor: {e}")))?;

    if let Some(cajas_arr) = json["data"]["cajas"].as_array() {
        if let Ok(conn) = db.conn() {
            upsert_pos_terminals_from_json(&conn, cajas_arr);
        }
    }

    Ok(json["data"].clone())
}

static IS_DISPATCHING_OUTBOX: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

struct OutboxDispatchGuard;

impl Drop for OutboxDispatchGuard {
    fn drop(&mut self) {
        IS_DISPATCHING_OUTBOX.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

/// 📤 Despacha las ventas pendientes en la cola outbox (sync_queue) hacia el ERP.
pub async fn dispatch_outbox_internal(db: &Db) -> AppResult<OutboxBatchResult> {
    if IS_DISPATCHING_OUTBOX
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        return Ok(OutboxBatchResult {
            dispatched: 0,
            synced: 0,
            failed: 0,
        });
    }
    let _guard = OutboxDispatchGuard;

    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if token.is_empty() {
        return Ok(OutboxBatchResult { dispatched: 0, synced: 0, failed: 0 });
    }

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
        .timeout(Duration::from_secs(45))
        .build()?;

    let mut total_dispatched = 0;
    let mut total_synced = 0;
    let mut total_failed = 0;

    // ── 0. Despacho Prioritario de Clientes ('customer') ───────────────────
    let (pending_customers, clientes_json) = {
        let conn = db.conn()?;
        let _ = conn.execute(
            "UPDATE sync_queue SET status = 'pending', attempts = 0 WHERE entity_type = 'customer' AND status = 'failed'",
            [],
        );
        let mut stmt = conn.prepare(
            "SELECT id, COALESCE(entity_id, 0), payload FROM sync_queue WHERE entity_type = 'customer' AND status = 'pending' ORDER BY id ASC LIMIT 30",
        )?;

        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;

        let mut pending = Vec::new();
        let mut json_list = Vec::new();

        for r in rows {
            let (queue_id, entity_id, payload_str) = r?;
            if let Ok(mut parsed) = serde_json::from_str::<Value>(&payload_str) {
                let local_id = parsed["localId"]
                    .as_i64()
                    .filter(|&id| id > 0)
                    .unwrap_or(entity_id);
                parsed["localId"] = serde_json::json!(local_id);

                if parsed["erpId"].is_null() && local_id > 0 {
                    if let Ok(Some(existing_erp_id)) = conn.query_row(
                        "SELECT erp_id FROM customers WHERE id = ?1",
                        params![local_id],
                        |row| row.get::<_, Option<String>>(0),
                    ) {
                        parsed["erpId"] = serde_json::json!(existing_erp_id);
                    }
                }

                pending.push((queue_id, local_id));
                json_list.push(parsed);
            }
        }

        (pending, json_list)
    };

    if !pending_customers.is_empty() {
        total_dispatched += pending_customers.len();
        let url = format!("{}/api/pos/v1/sync/clientes", erp_url.trim_end_matches('/'));
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "clientes": clientes_json }))
            .send()
            .await;

        match resp {
            Ok(res) => {
                let is_success = res.status().is_success();
                let res_text = res.text().await.unwrap_or_default();
                let conn = db.conn()?;

                if is_success {
                    let json: Value = serde_json::from_str(&res_text).unwrap_or_default();
                    let resultados_map: std::collections::HashMap<i64, (String, Option<String>, Option<String>)> =
                        json["data"]["resultados"]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|item| {
                                        let local_id = item["localId"].as_i64()?;
                                        let status = item["status"].as_str().unwrap_or("failed").to_string();
                                        let erp_id = item["erpId"].as_str().map(|s| s.to_string());
                                        let err = item["error"].as_str().map(|s| s.to_string());
                                        Some((local_id, (status, erp_id, err)))
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();

                    for (queue_id, local_id) in &pending_customers {
                        if let Some((status, erp_id_opt, err_opt)) = resultados_map.get(local_id) {
                            if status == "synced" {
                                if let Some(erp_id) = erp_id_opt {
                                    let _ = conn.execute(
                                        "UPDATE customers SET erp_id = ?1 WHERE id = ?2",
                                        params![erp_id, local_id],
                                    );
                                }
                                let _ = conn.execute(
                                    "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                                    params![queue_id],
                                );
                                total_synced += 1;
                            } else {
                                let _ = conn.execute(
                                    "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
                                    params![
                                        err_opt.clone().unwrap_or_else(|| "Error al sincronizar cliente".into()),
                                        queue_id
                                    ],
                                );
                                total_failed += 1;
                            }
                        }
                    }
                } else {
                    for (queue_id, _) in &pending_customers {
                        let _ = conn.execute(
                            "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
                            params![res_text, queue_id],
                        );
                    }
                    total_failed += pending_customers.len();
                }
            }
            Err(e) => {
                let conn = db.conn()?;
                let err_str = e.to_string();
                for (queue_id, _) in &pending_customers {
                    let _ = conn.execute(
                        "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
                        params![err_str, queue_id],
                    );
                }
                total_failed += pending_customers.len();
            }
        }
    }

    // ── 1. Despacho de Ventas ('sale') priorizando ventas de clientes (CxC) ──
    for _batch_iter in 0..3 {
        let (pending_sales, ventas_json, has_customer_sales) = {
            let conn = db.conn()?;
            let _ = conn.execute(
                "UPDATE sync_queue SET status = 'pending', attempts = 0 WHERE entity_type = 'sale' AND status = 'failed'",
                [],
            );
            let mut stmt = conn.prepare(
                "SELECT sq.id, sq.payload, s.customer_id \
                 FROM sync_queue sq \
                 LEFT JOIN sales s ON s.id = sq.entity_id \
                 WHERE sq.entity_type = 'sale' AND sq.status = 'pending' \
                 ORDER BY CASE WHEN s.customer_id IS NOT NULL OR (sq.payload LIKE '%\"customerId\":%' AND sq.payload NOT LIKE '%\"customerId\":null%') THEN 0 ELSE 1 END ASC, \
                          sq.id ASC \
                 LIMIT 20",
            )?;

            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                ))
            })?;

            let mut pending = Vec::new();
            let mut json_list = Vec::new();
            let mut any_cust = false;

            for r in rows {
                let (id, payload_str, sale_cust_id) = r?;
                if let Ok(mut parsed) = serde_json::from_str::<Value>(&payload_str) {
                    let folio = parsed["folio"].as_str().unwrap_or_default().to_string();
                    let resolved_cid = parsed["customerId"]
                        .as_i64()
                        .filter(|&c| c > 0)
                        .or(sale_cust_id);

                    if let Some(cid) = resolved_cid {
                        any_cust = true;
                        parsed["customerId"] = serde_json::json!(cid);
                        if let Ok((cname, ctax, cerp)) = conn.query_row(
                            "SELECT name, tax_id, erp_id FROM customers WHERE id = ?1",
                            params![cid],
                            |row| {
                                Ok((
                                    row.get::<_, String>(0)?,
                                    row.get::<_, Option<String>>(1)?,
                                    row.get::<_, Option<String>>(2)?,
                                ))
                            },
                        ) {
                            if parsed["customerErpId"].is_null() {
                                parsed["customerErpId"] = serde_json::json!(cerp);
                            }
                            if parsed["customerName"].is_null() {
                                parsed["customerName"] = serde_json::json!(cname);
                            }
                            if parsed["customerTaxId"].is_null() {
                                parsed["customerTaxId"] = serde_json::json!(ctax);
                            }
                        }
                    }
                    pending.push((id, folio));
                    json_list.push(parsed);
                }
            }

            (pending, json_list, any_cust)
        };

        if pending_sales.is_empty() {
            break;
        }

        total_dispatched += pending_sales.len();
        let url = format!("{}/api/pos/v1/sync/ventas", erp_url.trim_end_matches('/'));
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "ventas": ventas_json }))
            .send()
            .await;

        let mut batch_ok = false;
        match resp {
            Ok(res) => {
                let is_success = res.status().is_success();
                let res_text = res.text().await.unwrap_or_default();
                let conn = db.conn()?;
                if is_success {
                    batch_ok = true;
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
                        if let Some((status, err)) = resultados_map.get(folio) {
                            if status == "synced" || status == "skipped" {
                                let _ = conn.execute(
                                    "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                                    params![id],
                                );
                                total_synced += 1;
                            } else {
                                let _ = conn.execute(
                                    "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
                                    params![err.clone().unwrap_or_else(|| "Fallo al procesar venta en ERP".to_string()), id],
                                );
                                total_failed += 1;
                            }
                        }
                    }
                } else {
                    for (id, _) in &pending_sales {
                        let _ = conn.execute(
                            "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
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
                        "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
                        params![err_str, id],
                    );
                }
                total_failed += pending_sales.len();
            }
        }

        if !batch_ok || !has_customer_sales {
            break;
        }
    }

    // ── 2. Despacho de Abonos de Cartera ('customer_payment') ───────────────
    let (pending_payments, abonos_json) = {
        let conn = db.conn()?;
        let _ = conn.execute(
            "UPDATE sync_queue SET status = 'pending', attempts = 0 WHERE entity_type = 'customer_payment' AND status = 'failed'",
            [],
        );
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
            if let Ok(mut parsed) = serde_json::from_str::<Value>(&payload_str) {
                let folio = parsed["folio"].as_str().unwrap_or_default().to_string();
                if let Some(cid) = parsed["customerId"].as_i64().filter(|&c| c > 0) {
                    if let Ok((cname, ctax, cerp)) = conn.query_row(
                        "SELECT name, tax_id, erp_id FROM customers WHERE id = ?1",
                        params![cid],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, Option<String>>(1)?,
                                row.get::<_, Option<String>>(2)?,
                            ))
                        },
                    ) {
                        if parsed["customerErpId"].is_null() {
                            parsed["customerErpId"] = serde_json::json!(cerp);
                        }
                        if parsed["customerName"].is_null() {
                            parsed["customerName"] = serde_json::json!(cname);
                        }
                        if parsed["customerTaxId"].is_null() {
                            parsed["customerTaxId"] = serde_json::json!(ctax);
                        }
                    }
                }
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
                        if let Some((status, err)) = resultados_map.get(folio) {
                            if status == "synced" || status == "skipped" {
                                let _ = conn.execute(
                                    "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                                    params![id],
                                );
                                total_synced += 1;
                            } else {
                                let _ = conn.execute(
                                    "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
                                    params![err.clone().unwrap_or_else(|| "Fallo al procesar abono en ERP".to_string()), id],
                                );
                                total_failed += 1;
                            }
                        }
                    }
                } else {
                    for (id, _) in &pending_payments {
                        let _ = conn.execute(
                            "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
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
                        "UPDATE sync_queue SET last_error = ?1 WHERE id = ?2",
                        params![err_str, id],
                    );
                }
                total_failed += pending_payments.len();
            }
        }
    }

    // ── 3. Despacho de Devoluciones / Notas Crédito POS ('sale_return') ────
    let (pending_returns, devoluciones_json) = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, payload FROM sync_queue WHERE entity_type = 'sale_return' AND status = 'pending' ORDER BY id ASC LIMIT 30"
        )?;

        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;

        let mut pending = Vec::new();
        let mut json_list = Vec::new();

        for r in rows {
            let (id, payload_str) = r?;
            if let Ok(mut parsed) = serde_json::from_str::<Value>(&payload_str) {
                let folio = parsed["folio"].as_str().unwrap_or_default().to_string();
                if parsed["customerErpId"].is_null() {
                    if let Some(cid) = parsed["customerId"].as_i64().filter(|&c| c > 0) {
                        if let Ok(Some(erp_id)) = conn.query_row(
                            "SELECT erp_id FROM customers WHERE id = ?1",
                            params![cid],
                            |row| row.get::<_, Option<String>>(0),
                        ) {
                            parsed["customerErpId"] = serde_json::json!(erp_id);
                        }
                    }
                }
                pending.push((id, folio));
                json_list.push(parsed);
            }
        }

        (pending, json_list)
    };

    if !pending_returns.is_empty() {
        total_dispatched += pending_returns.len();
        let url = format!("{}/api/pos/v1/sync/devoluciones", erp_url.trim_end_matches('/'));
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "devoluciones": devoluciones_json }))
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

                    for (id, folio) in &pending_returns {
                        let (status, err) = resultados_map.get(folio)
                            .cloned()
                            .unwrap_or_else(|| ("failed".to_string(), Some("Sin respuesta del ERP para esta devolución".to_string())));

                        if status == "synced" || status == "skipped" {
                            let _ = conn.execute(
                                "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                                params![id],
                            );
                            total_synced += 1;
                        } else {
                            let err_msg = err.unwrap_or_else(|| "Fallo al procesar devolución en ERP".to_string());
                            let is_permanent = err_msg.contains("NO_EXISTE") || err_msg.contains("inválido") || err_msg.contains("no encontrad");
                            let _ = conn.execute(
                                "UPDATE sync_queue
                                 SET attempts = attempts + 1,
                                     last_error = ?1,
                                     status = CASE WHEN ?2 OR attempts + 1 >= 10 THEN 'failed' ELSE status END
                                 WHERE id = ?3",
                                params![err_msg, is_permanent, id],
                            );
                            total_failed += 1;
                        }
                    }
                } else {
                    for (id, _) in &pending_returns {
                        let _ = conn.execute(
                            "UPDATE sync_queue
                             SET attempts = attempts + 1,
                                 last_error = ?1,
                                 status = CASE WHEN attempts + 1 >= 10 THEN 'failed' ELSE status END
                             WHERE id = ?2",
                            params![res_text, id],
                        );
                    }
                    total_failed += pending_returns.len();
                }
            }
            Err(e) => {
                let conn = db.conn()?;
                let err_str = e.to_string();
                for (id, _) in &pending_returns {
                    let _ = conn.execute(
                        "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                        params![err_str, id],
                    );
                }
                total_failed += pending_returns.len();
            }
        }
    }

    // ── 4. Despacho de Cambios de PIN de Usuario ('user_pin') ────
    let pending_pins = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, payload FROM sync_queue WHERE entity_type = 'user_pin' AND status = 'pending' ORDER BY id ASC LIMIT 10"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    if !pending_pins.is_empty() {
        total_dispatched += pending_pins.len();
        let url = format!("{}/api/pos/v1/terminal/usuarios/cambiar-pin", erp_url.trim_end_matches('/'));

        for (id, payload_str) in pending_pins {
            if let Ok(parsed) = serde_json::from_str::<Value>(&payload_str) {
                let resp = client
                    .post(&url)
                    .header("Authorization", format!("Bearer {token}"))
                    .json(&parsed)
                    .send()
                    .await;

                let (is_synced, error_msg) = match resp {
                    Ok(res) => {
                        let is_success = res.status().is_success();
                        if is_success {
                            (true, None)
                        } else {
                            let err_text = res.text().await.unwrap_or_default();
                            (false, Some(err_text))
                        }
                    }
                    Err(e) => (false, Some(e.to_string())),
                };

                let conn = db.conn()?;
                if is_synced {
                    let _ = conn.execute(
                        "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                        params![id],
                    );
                    total_synced += 1;
                } else {
                    let _ = conn.execute(
                        "UPDATE sync_queue
                         SET attempts = attempts + 1,
                             last_error = ?1,
                             status = CASE WHEN attempts + 1 >= 10 THEN 'failed' ELSE status END
                         WHERE id = ?2",
                        params![error_msg.unwrap_or_else(|| "Error al sincronizar PIN".to_string()), id],
                    );
                    total_failed += 1;
                }
            }
        }
    }

    // ── 4b. Despacho de Movimientos de Inventario ('inventory_movement') ────
    let pending_movements = {
        let conn = db.conn()?;
        let _ = conn.execute(
            "UPDATE sync_queue SET status = 'pending' WHERE entity_type = 'inventory_movement' AND status = 'failed' AND attempts < 15 AND last_error LIKE '%no encontrado%'",
            [],
        );
        let mut stmt = conn.prepare(
            "SELECT id, payload FROM sync_queue WHERE entity_type = 'inventory_movement' AND status = 'pending' ORDER BY id ASC LIMIT 50"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    if !pending_movements.is_empty() {
        total_dispatched += pending_movements.len();
        let url = format!("{}/api/pos/v1/sync/inventario/movimientos", erp_url.trim_end_matches('/'));

        let mut items = Vec::new();
        for (_, p_str) in &pending_movements {
            if let Ok(val) = serde_json::from_str::<Value>(p_str) {
                items.push(val);
            }
        }

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({ "movimientos": items }))
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
                                let uuid = item["uuid"].as_str()?.to_string();
                                let status = item["status"].as_str().unwrap_or("failed").to_string();
                                let err = item["error"].as_str().map(|s| s.to_string());
                                Some((uuid, (status, err)))
                            }).collect()
                        })
                        .unwrap_or_default();

                    for (id, p_str) in &pending_movements {
                        let uuid = serde_json::from_str::<Value>(p_str)
                            .ok()
                            .and_then(|v| v["uuid"].as_str().map(|s| s.to_string()))
                            .unwrap_or_default();

                        let (status, err) = resultados_map.get(&uuid)
                            .cloned()
                            .unwrap_or_else(|| ("synced".to_string(), None));

                        if status == "synced" || status == "skipped" {
                            let _ = conn.execute(
                                "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                                params![id],
                            );
                            total_synced += 1;
                        } else {
                            let err_msg = err.unwrap_or_else(|| "Error al procesar movimiento de inventario".to_string());
                            let _ = conn.execute(
                                "UPDATE sync_queue
                                 SET attempts = attempts + 1,
                                     last_error = ?1,
                                     status = CASE WHEN attempts + 1 >= 10 THEN 'failed' ELSE status END
                                 WHERE id = ?2",
                                params![err_msg, id],
                            );
                            total_failed += 1;
                        }
                    }
                } else {
                    for (id, _) in &pending_movements {
                        let _ = conn.execute(
                            "UPDATE sync_queue
                             SET attempts = attempts + 1,
                                 last_error = ?1,
                                 status = CASE WHEN attempts + 1 >= 10 THEN 'failed' ELSE status END
                             WHERE id = ?2",
                            params![res_text, id],
                        );
                    }
                    total_failed += pending_movements.len();
                }
            }
            Err(e) => {
                let conn = db.conn()?;
                let err_str = e.to_string();
                for (id, _) in &pending_movements {
                    let _ = conn.execute(
                        "UPDATE sync_queue SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                        params![err_str, id],
                    );
                }
                total_failed += pending_movements.len();
            }
        }
    }

    // ── 5. Despacho de Cierres de Turno ('cash_session') ────
    let pending_sessions = {
        let conn = db.conn()?;
        // Auto-recuperar cierres de turno que hayan quedado en 'failed' con pocos intentos
        let _ = conn.execute(
            "UPDATE sync_queue SET status = 'pending' WHERE entity_type = 'cash_session' AND status = 'failed' AND attempts < 10",
            [],
        );
        let mut stmt = conn.prepare(
            "SELECT sq.id, sq.payload, cs.opening_cents, cs.opened_at, cs.closed_at
             FROM sync_queue sq
             LEFT JOIN cash_sessions cs ON cs.id = sq.entity_id
             WHERE sq.entity_type = 'cash_session' AND sq.status = 'pending'
             ORDER BY sq.id ASC LIMIT 20"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        list
    };

    if !pending_sessions.is_empty() {
        total_dispatched += pending_sessions.len();
        let url = format!("{}/api/pos/v1/sync/cierre-turno", erp_url.trim_end_matches('/'));

        for (id, payload_str, opening_cents_opt, opened_at_opt, closed_at_opt) in pending_sessions {
            if let Ok(mut parsed) = serde_json::from_str::<Value>(&payload_str) {
                if parsed.get("observaciones").map(|v| v.is_null()).unwrap_or(false) {
                    parsed["observaciones"] = serde_json::json!("");
                }
                if parsed.get("baseInicial").is_none() {
                    if let Some(oc) = opening_cents_opt {
                        parsed["baseInicial"] = serde_json::json!((oc as f64) / 100.0);
                    }
                }
                if parsed.get("fechaApertura").is_none() {
                    if let Some(oa) = opened_at_opt {
                        parsed["fechaApertura"] = serde_json::json!(oa);
                    }
                }
                if parsed.get("fechaCierre").is_none() {
                    if let Some(ca) = closed_at_opt {
                        parsed["fechaCierre"] = serde_json::json!(ca);
                    }
                }

                let resp = client
                    .post(&url)
                    .header("Authorization", format!("Bearer {token}"))
                    .json(&parsed)
                    .send()
                    .await;

                let (is_synced, is_permanent, error_msg) = match resp {
                    Ok(res) => {
                        let status_code = res.status().as_u16();
                        if res.status().is_success() || status_code == 409 {
                            (true, false, None)
                        } else {
                            let err_text = res.text().await.unwrap_or_default();
                            let perm = err_text.contains("ya se encuentra CERRADO") || err_text.contains("ya se encuentra CONTABILIZADO");
                            if perm {
                                (true, false, None)
                            } else {
                                (false, false, Some(err_text))
                            }
                        }
                    }
                    Err(e) => (false, false, Some(e.to_string())),
                };

                let conn = db.conn()?;
                if is_synced {
                    let _ = conn.execute(
                        "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL WHERE id = ?1",
                        params![id],
                    );
                    total_synced += 1;
                } else {
                    let _ = conn.execute(
                        "UPDATE sync_queue
                         SET attempts = attempts + 1,
                             last_error = ?1,
                             status = CASE WHEN ?2 OR attempts + 1 >= 10 THEN 'failed' ELSE status END
                         WHERE id = ?3",
                        params![error_msg.unwrap_or_else(|| "Error al sincronizar cierre de turno".to_string()), is_permanent, id],
                    );
                    total_failed += 1;
                }
            } else {
                let conn = db.conn()?;
                let _ = conn.execute(
                    "UPDATE sync_queue SET status = 'failed', last_error = 'Payload JSON inválido' WHERE id = ?1",
                    params![id],
                );
            }
        }
    }

    // ── 5b. Sincronizar turno abierto actual si aún no está registrado en el ERP ──
    let active_open_shift = {
        let conn = db.conn()?;
        conn.query_row(
            "SELECT cs.id, cs.folio, cs.opening_cents, cs.opened_at, u.erp_user_id
             FROM cash_sessions cs
             LEFT JOIN users u ON u.id = cs.user_id
             WHERE cs.status = 'open'
             ORDER BY cs.opened_at DESC LIMIT 1",
            [],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .ok()
    };

    if let Some((shift_id, folio, opening_cents, opened_at, erp_uid)) = active_open_shift {
        let url = format!("{}/api/pos/v1/sync/turno", erp_url.trim_end_matches('/'));
        let body = serde_json::json!({
            "folioTurno": folio,
            "baseInicial": (opening_cents as f64) / 100.0,
            "erpUserId": erp_uid,
            "fechaApertura": opened_at,
        });
        if let Ok(res) = client
            .post(&url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&body)
            .send()
            .await
        {
            if res.status().is_success() {
                if let Ok(json_res) = res.json::<Value>().await {
                    if let Some(tid) = json_res["data"]["turno"]["id"].as_str() {
                        if let Ok(conn) = db.conn() {
                            let _ = conn.execute(
                                "UPDATE cash_sessions SET erp_turno_id = ?1 WHERE id = ?2",
                                params![tid, shift_id],
                            );
                        }
                    }
                }
            }
        }
    }

    // ── 7. Saneamiento Dead-Letter para registros no críticos estancados (>= 15 intentos) ──
    if let Ok(conn) = db.conn() {
        let _ = conn.execute(
            "UPDATE sync_queue SET status = 'failed' WHERE status = 'pending' AND attempts >= 15 AND entity_type NOT IN ('customer', 'sale', 'customer_payment')",
            [],
        );
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
/// Retorna `(cantidad_actualizada, requiere_sync_catalogo)`.
pub async fn pull_inventory_deltas_with_hint(db: &Db) -> AppResult<(usize, bool)> {
    let (erp_url, token, last_sync) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        let last_sync = get_setting(&conn, "last_sync_timestamp").unwrap_or_default();
        (erp_url, token, last_sync)
    };

    if token.is_empty() {
        return Ok((0, false));
    }

    let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
        .timeout(Duration::from_secs(10))
        .build()?;

    let url = format!("{}/api/pos/v1/sync/inventario/deltas", erp_url.trim_end_matches('/'));
    let mut req = client.get(&url).header("Authorization", format!("Bearer {token}"));
    if !last_sync.is_empty() {
        req = req.query(&[("since", &last_sync)]);
    }

    let res = req.send().await;
    let res = match res {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok((0, false)),
    };

    let json: Value = res.json().await.unwrap_or_default();
    let mut needs_catalog_sync = json["data"]["hasCatalogUpdates"].as_bool().unwrap_or(false);
    let deltas = match json["data"]["deltas"].as_array() {
        Some(d) => d,
        None => return Ok((0, needs_catalog_sync)),
    };

    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let pending_deltas_map = compute_all_pending_stock_deltas(&tx);
    let mut count = 0;
    for d in deltas {
        let p_id = d["productoId"].as_str().unwrap_or_default();
        let stock_actual = d["stockActual"].as_f64().unwrap_or(0.0);

        if !p_id.is_empty() {
            let local_info: Option<(i64, i64, i64, i64)> = tx
                .prepare_cached(
                    "SELECT id, is_service, is_bundle, COALESCE(needs_erp_upload, 0) FROM products WHERE erp_id = ?1",
                )?
                .query_row(
                    params![p_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .ok();

            if let Some((local_id, is_service, is_bundle, needs_erp_upload)) = local_info {
                if is_service == 1 || is_bundle == 1 || needs_erp_upload == 1 {
                    continue;
                }

                // pending_net_delta pre-calculado en memoria O(1)
                let net_delta = pending_deltas_map.get(&local_id).copied().unwrap_or(0.0);
                let effective_stock = (stock_actual + net_delta).max(0.0);

                let affected = tx.prepare_cached(
                    "UPDATE products SET stock = ?1, updated_at = datetime('now') WHERE id = ?2 AND COALESCE(needs_erp_upload, 0) = 0",
                )?.execute(params![effective_stock, local_id]);
                if let Ok(n) = affected {
                    if n > 0 {
                        count += 1;
                    }
                }
            } else {
                // Producto nuevo creado en el ERP u otra caja que aún no existe en este SQLite local
                needs_catalog_sync = true;
            }
        }
    }

    if let Some(ts) = json["data"]["timestamp"].as_str() {
        let _ = tx.prepare_cached(
            "INSERT INTO settings (key, value) VALUES ('last_sync_timestamp', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1",
        )?.execute(params![ts]);
    }

    tx.commit()?;
    Ok((count, needs_catalog_sync))
}

pub async fn pull_inventory_deltas_internal(db: &Db) -> AppResult<usize> {
    let (count, _) = pull_inventory_deltas_with_hint(db).await?;
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

        let pending_sales_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let pending_products_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM products WHERE active = 1 AND needs_erp_upload = 1 AND (erp_id IS NOT NULL OR is_service = 1 OR is_bundle = 1 OR stock > 0)",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let pending_count = pending_sales_count + pending_products_count;

        let last_sync_at = get_setting(&conn, "last_sync_timestamp");
        let offline_policy = get_setting(&conn, "offline_stock_policy").unwrap_or_else(|| "permissive".into());
        let critical_threshold: f64 = get_setting(&conn, "critical_stock_threshold")
            .and_then(|s| s.parse().ok())
            .unwrap_or(2.0);

        (is_paired, erp_url, token, pending_count, last_sync_at, offline_policy, critical_threshold)
    };

    let mut is_online = false;
    if is_paired {
        let mut active_token = token;
        if active_token.is_empty() {
            if crate::commands::auth::try_silent_reconnect(db).await {
                if let Ok(conn) = db.conn() {
                    active_token = get_setting(&conn, "terminal_token").unwrap_or_default();
                }
            }
        }

        if !active_token.is_empty() {
            let client = reqwest::Client::builder().user_agent("Metahabi-POS/0.2 (Windows; Desktop)")
                .timeout(Duration::from_millis(4000))
                .build()?;
            let check_url = format!("{}/api/pos/v1/terminal/estado", erp_url.trim_end_matches('/'));
            if let Ok(res) = client
                .get(&check_url)
                .header("Authorization", format!("Bearer {active_token}"))
                .send()
                .await
            {
                if res.status().is_success() {
                    is_online = true;
                } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
                    if crate::commands::auth::try_silent_reconnect(db).await {
                        is_online = true;
                    }
                }
            }
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
        let mut last_catalog_sync_loop: u64 = 0;
        let mut interval = tokio::time::interval(Duration::from_secs(10));

        loop {
            interval.tick().await;
            loop_count += 1;

            // 1. Despachar Outbox si hay ventas o movimientos pendientes
            let _ = dispatch_outbox_internal(&db).await;

            // 2. Si hay ajustes de stock o productos locales pendientes de subir al ERP (incluyendo stock = 0)
            let has_pending_products = db
                .conn()
                .ok()
                .and_then(|c| {
                    c.query_row(
                        "SELECT COUNT(*) FROM products WHERE active = 1 AND needs_erp_upload = 1",
                        [],
                        |r| r.get::<_, i64>(0),
                    )
                    .ok()
                })
                .unwrap_or(0)
                > 0;

            // Sincronización completa de catálogo al arrancar (loop 1) o cada 10 minutos (60 ticks);
            // incremental en 30s si hay productos pendientes locales o cuando deltas detecte productos nuevos.
            // La completa al arrancar autocorrige existencias locales desfasadas (no presentes en deltas).
            let should_full_catalog_sync = loop_count == 1 || loop_count >= last_catalog_sync_loop + 60;
            let should_incremental_sync =
                has_pending_products && loop_count >= last_catalog_sync_loop + 3;

            if should_full_catalog_sync || should_incremental_sync {
                let force_full = should_full_catalog_sync;
                match sync_catalog_internal_mode(&db, force_full).await {
                    Ok(_) => {
                        last_catalog_sync_loop = loop_count;
                    }
                    Err(e) => {
                        eprintln!("[sync-daemon] Error en sync_catalog (force_full={force_full}): {e}");
                        // Reintentar en ~60s (6 ticks) si falló, no esperar 10 minutos
                        last_catalog_sync_loop = loop_count.saturating_sub(54);
                    }
                }
            } else {
                // 3. Traer deltas de existencias desde el ERP cada ciclo ligero (10 segundos)
                match pull_inventory_deltas_with_hint(&db).await {
                    Ok((_, true)) => {
                        // Llegó un producto nuevo o cambio de catálogo en el ERP: descargar incrementalmente ya
                        if let Err(e) = sync_catalog_internal_mode(&db, false).await {
                            eprintln!("[sync-daemon] Error en sync_catalog incremental disparado por deltas: {e}");
                        } else {
                            last_catalog_sync_loop = loop_count;
                        }
                    }
                    Err(e) => {
                        eprintln!("[sync-daemon] Error en pull_inventory_deltas: {e}");
                    }
                    _ => {}
                }
            }

            // 4. Sincronización asíncrona de clientes, bodegas e imágenes (cada 30 segundos y en el primer ciclo)
            if loop_count == 1 || loop_count % 3 == 0 {
                let _ = sync_warehouses_internal(&db).await;
                let _ = sync_customers_internal(&db).await;
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

/// Pre-calcula los deltas netos de inventario pendientes de sincronizar en `sync_queue`
/// para TODOS los productos locales en una sola pasada rápida con GROUP BY en memoria.
/// Retorna `local_id -> delta_neto`. Evita miles de consultas repetitivas N+1.
pub fn compute_all_pending_stock_deltas(conn: &rusqlite::Connection) -> std::collections::HashMap<i64, f64> {
    let mut map: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();

    // 1. Unidades vendidas directamente en tickets pendientes
    if let Ok(mut stmt) = conn.prepare(
        "SELECT si.product_id, COALESCE(SUM(si.quantity), 0) \
         FROM sale_items si \
         JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
         WHERE sq.status IN ('pending', 'in_flight') \
         GROUP BY si.product_id",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))) {
            for (pid, qty) in rows.flatten() {
                *map.entry(pid).or_insert(0.0) -= qty;
            }
        }
    }

    // 2. Unidades hijas vendidas a través de combos/kits en tickets pendientes
    if let Ok(mut stmt) = conn.prepare(
        "SELECT pc.child_product_id, COALESCE(SUM(si.quantity * pc.quantity), 0) \
         FROM sale_items si \
         JOIN product_components pc ON pc.parent_product_id = si.product_id \
         JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
         WHERE sq.status IN ('pending', 'in_flight') \
         GROUP BY pc.child_product_id",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))) {
            for (pid, qty) in rows.flatten() {
                *map.entry(pid).or_insert(0.0) -= qty;
            }
        }
    }

    // 3. Unidades devueltas directamente (con reingreso a stock) en devoluciones pendientes
    if let Ok(mut stmt) = conn.prepare(
        "SELECT sri.product_id, COALESCE(SUM(sri.quantity), 0) \
         FROM sale_return_items sri \
         JOIN sync_queue sq ON sq.entity_type = 'sale_return' AND sq.entity_id = sri.return_id \
         WHERE sri.inventory_disposition = 'restock' AND sq.status IN ('pending', 'in_flight') \
         GROUP BY sri.product_id",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))) {
            for (pid, qty) in rows.flatten() {
                *map.entry(pid).or_insert(0.0) += qty;
            }
        }
    }

    // 4. Unidades hijas devueltas a través de combos en devoluciones pendientes
    if let Ok(mut stmt) = conn.prepare(
        "SELECT pc.child_product_id, COALESCE(SUM(sri.quantity * pc.quantity), 0) \
         FROM sale_return_items sri \
         JOIN product_components pc ON pc.parent_product_id = sri.product_id \
         JOIN sync_queue sq ON sq.entity_type = 'sale_return' AND sq.entity_id = sri.return_id \
         WHERE sri.inventory_disposition = 'restock' AND sq.status IN ('pending', 'in_flight') \
         GROUP BY pc.child_product_id",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))) {
            for (pid, qty) in rows.flatten() {
                *map.entry(pid).or_insert(0.0) += qty;
            }
        }
    }

    // 5. Ajustes / entradas / salidas manuales de inventario pendientes en sync_queue.
    // Solo se consideran los que aún pueden llegar al ERP ('pending' / 'in_flight'): un movimiento
    // en 'failed' fue rechazado definitivamente (ej. desborde numérico por un código de barras
    // escaneado en el campo de cantidad) y sumarlo aquí desfasaría el stock de forma permanente.
    if let Ok(mut stmt) = conn.prepare(
        "SELECT im.product_id, COALESCE(SUM(im.quantity), 0) \
         FROM inventory_movements im \
         JOIN sync_queue sq ON sq.entity_type = 'inventory_movement' AND sq.entity_id = im.id \
         WHERE sq.status IN ('pending', 'in_flight') \
         GROUP BY im.product_id",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?))) {
            for (pid, qty) in rows.flatten() {
                *map.entry(pid).or_insert(0.0) += qty;
            }
        }
    }

    map
}

/// Calcula el delta neto de unidades pendientes de sincronizar en `sync_queue` para un producto local:
/// `pending_returned (restock) - pending_sold (directas + combos)`
#[allow(dead_code)]
pub fn compute_pending_stock_delta(conn: &rusqlite::Connection, local_id: i64) -> f64 {
    let direct_sold: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(si.quantity), 0) \
             FROM sale_items si \
             JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
             WHERE si.product_id = ?1 AND sq.status IN ('pending', 'in_flight')",
            params![local_id],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let combo_sold: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(si.quantity * pc.quantity), 0) \
             FROM sale_items si \
             JOIN product_components pc ON pc.parent_product_id = si.product_id \
             JOIN sync_queue sq ON sq.entity_type = 'sale' AND sq.entity_id = si.sale_id \
             WHERE pc.child_product_id = ?1 AND sq.status IN ('pending', 'in_flight')",
            params![local_id],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let direct_returned: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(sri.quantity), 0) \
             FROM sale_return_items sri \
             JOIN sync_queue sq ON sq.entity_type = 'sale_return' AND sq.entity_id = sri.return_id \
             WHERE sri.product_id = ?1 AND sri.inventory_disposition = 'restock' AND sq.status IN ('pending', 'in_flight')",
            params![local_id],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let combo_returned: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(sri.quantity * pc.quantity), 0) \
             FROM sale_return_items sri \
             JOIN product_components pc ON pc.parent_product_id = sri.product_id \
             JOIN sync_queue sq ON sq.entity_type = 'sale_return' AND sq.entity_id = sri.return_id \
             WHERE pc.child_product_id = ?1 AND sri.inventory_disposition = 'restock' AND sq.status IN ('pending', 'in_flight')",
            params![local_id],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let manual_adjustments: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(im.quantity), 0) \
             FROM inventory_movements im \
             JOIN sync_queue sq ON sq.entity_type = 'inventory_movement' AND sq.entity_id = im.id \
             WHERE im.product_id = ?1 AND sq.status IN ('pending', 'in_flight')",
            params![local_id],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    (direct_returned + combo_returned + manual_adjustments) - (direct_sold + combo_sold)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sales::{create_sale_in_conn, create_sale_return_in_conn};
    use crate::models::sale::{
        CartItemInput, CreateSaleInput, CreateSaleReturnInput, CreateSaleReturnItemInput,
        PaymentInput,
    };

    #[test]
    fn test_failed_inventory_movement_does_not_skew_pending_delta() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        crate::db::migrations::run(&mut conn).unwrap();

        conn.execute(
            "INSERT INTO products (id, erp_id, sku, name, unit, price_cents, cost_cents, stock, is_service, controls_stock, active)
             VALUES (90, 'erp-prod-90', 'SKU-90', 'Leche', 'pza', 490000, 430000, 15.0, 0, 1, 1)",
            [],
        )
        .unwrap();

        // Movimiento absurdo (código de barras escaneado como cantidad) rechazado por el ERP
        conn.execute(
            "INSERT INTO inventory_movements (id, product_id, kind, quantity) VALUES (500, 90, 'adjustment', 7702495110310.0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sync_queue (entity_type, entity_id, payload, status, attempts) VALUES ('inventory_movement', 500, '{}', 'failed', 10)",
            [],
        )
        .unwrap();

        // Movimiento válido aún pendiente de subir
        conn.execute(
            "INSERT INTO inventory_movements (id, product_id, kind, quantity) VALUES (501, 90, 'adjustment', 3.0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sync_queue (entity_type, entity_id, payload, status) VALUES ('inventory_movement', 501, '{}', 'pending')",
            [],
        )
        .unwrap();

        let map = compute_all_pending_stock_deltas(&conn);
        assert!((map.get(&90).copied().unwrap_or(0.0) - 3.0).abs() < 1e-9);
        assert!((compute_pending_stock_delta(&conn, 90) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn test_adjust_stock_rejects_scanned_barcode_quantity() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        crate::db::migrations::run(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO products (id, sku, name, unit, price_cents, cost_cents, stock, is_service, controls_stock, active)
             VALUES (91, 'SKU-91', 'Leche', 'pza', 490000, 430000, 15.0, 0, 1, 1)",
            [],
        )
        .unwrap();

        let res = crate::commands::products::adjust_stock_in_conn(
            &mut conn,
            crate::models::product::StockAdjustmentInput {
                product_id: 91,
                new_stock: 7702495110325.0,
                reason: "Entrada".into(),
                user_id: None,
                warehouse_id: None,
            },
        );
        assert!(res.is_err());
        let stock: f64 = conn.query_row("SELECT stock FROM products WHERE id = 91", [], |r| r.get(0)).unwrap();
        assert!((stock - 15.0).abs() < 1e-9);
    }

    #[test]
    fn test_sync_catalog_preserves_pending_sales_and_pending_returns() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        crate::db::migrations::run(&mut conn).unwrap();

        conn.execute(
            "INSERT OR REPLACE INTO users (id, username, full_name, role, active) VALUES (1, 'cajero1', 'Cajero Sync', 'cashier', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cash_sessions (id, folio, user_id, opening_cents, status, opened_at) VALUES (1, 'T-SYNC-01', 1, 5000000, 'open', datetime('now'))",
            [],
        )
        .unwrap();
        // Producto con stock inicial = 20 en el ERP y en el POS
        conn.execute(
            "INSERT INTO products (id, erp_id, sku, name, unit, price_cents, cost_cents, stock, is_service, controls_stock, active)
             VALUES (77, 'erp-prod-77', 'SYNC-77', 'Producto Offline Sync', 'UND', 500000, 300000, 20.0, 0, 1, 1)",
            [],
        )
        .unwrap();

        // 1. Cajero vende 5 unidades offline (queda pendiente en sync_queue, stock local baja a 15)
        let sale = create_sale_in_conn(
            &mut conn,
            CreateSaleInput {
                user_id: Some(1),
                customer_id: None,
                items: vec![CartItemInput {
                    product_id: Some(77),
                    sku: Some("SYNC-77".into()),
                    barcode: None,
                    description: "Producto Offline Sync".into(),
                    quantity: 5.0,
                    unit_price_cents: 500000,
                    tax_rate_bp: Some(0),
                    tax_fixed_cents: Some(0),
                    discount_cents: Some(0),
                }],
                payments: vec![PaymentInput {
                    method: "cash".into(),
                    amount_cents: 2500000,
                    reference: None,
                }],
                client_tx_id: None,
            },
        )
        .unwrap();

        // 2. Cajero procesa devolución con reingreso ('restock') de 2 unidades offline (pendiente en sync_queue, stock local sube a 17)
        create_sale_return_in_conn(
            &mut conn,
            CreateSaleReturnInput {
                sale_id: sale.id,
                user_id: Some(1),
                reason: "Devolución parcial offline".into(),
                refund_method: "cash".into(),
                notes: None,
                items: vec![CreateSaleReturnItemInput {
                    sale_item_id: sale.items[0].id,
                    quantity: 2.0,
                    inventory_disposition: Some("restock".into()),
                }],
            },
        )
        .unwrap();

        // 3. El delta neto pendiente en sync_queue debe ser: +2 (devueltas) - 5 (vendidas) = -3.0
        let pending_delta = compute_pending_stock_delta(&conn, 77);
        assert!((pending_delta - (-3.0)).abs() < 1e-6);

        // Si el ERP aún informa stock = 20.0 antes de que el outbox termine de subir,
        // el stock efectivo calculado por sync_catalog debe ser 20.0 + (-3.0) = 17.0 (preservando la venta y la devolución)
        let erp_reported_stock = 20.0;
        let effective_stock = (erp_reported_stock + pending_delta).max(0.0);
        assert!((effective_stock - 17.0).abs() < 1e-6);
    }

    #[test]
    fn test_sale_of_last_single_unit_when_low_stock_succeeds() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        crate::db::migrations::run(&mut conn).unwrap();

        let policy = get_setting(&conn, "offline_stock_policy").unwrap_or_default();
        assert_eq!(policy, "permissive");

        conn.execute(
            "INSERT OR REPLACE INTO users (id, username, full_name, role, active) VALUES (1, 'cajero1', 'Cajero Uno', 'cashier', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cash_sessions (id, folio, user_id, opening_cents, status, opened_at) VALUES (1, 'T-LOW-01', 1, 5000000, 'open', datetime('now'))",
            [],
        )
        .unwrap();
        // Producto bajo de existencias (min_stock = 5.0, stock actual = 1.0 unidad)
        conn.execute(
            "INSERT INTO products (id, sku, name, unit, price_cents, cost_cents, stock, min_stock, is_service, controls_stock, needs_erp_upload, active)
             VALUES (88, 'LOW-88', 'Producto Última Unidad', 'UND', 250000, 150000, 1.0, 5.0, 0, 1, 1, 1)",
            [],
        )
        .unwrap();

        let sale = create_sale_in_conn(
            &mut conn,
            CreateSaleInput {
                user_id: Some(1),
                customer_id: None,
                items: vec![CartItemInput {
                    product_id: Some(88),
                    sku: Some("LOW-88".into()),
                    barcode: None,
                    description: "Producto Última Unidad".into(),
                    quantity: 1.0,
                    unit_price_cents: 250000,
                    tax_rate_bp: Some(0),
                    tax_fixed_cents: Some(0),
                    discount_cents: Some(0),
                }],
                payments: vec![PaymentInput {
                    method: "cash".into(),
                    amount_cents: 250000,
                    reference: None,
                }],
                client_tx_id: None,
            },
        )
        .unwrap();

        assert_eq!(sale.total_cents, 250000);
        let remaining_stock: f64 = conn
            .query_row("SELECT stock FROM products WHERE id = 88", [], |r| r.get(0))
            .unwrap();
        assert!(remaining_stock.abs() < 1e-6);
    }
}


