use std::fs;
use std::path::PathBuf;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use rusqlite::params;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::product::Product;
use crate::commands::products::calculate_bundle_stock;

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .ok()
}

/// Calcula el hash SHA-256 de un arreglo de bytes en formato hexadecimal.
pub fn calculate_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Obtiene o asegura la ruta de almacenamiento de imágenes locales de productos:
/// `%APPDATA%\com.briankrou.pos-logiventa\storage\images\products`
pub fn get_images_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("storage")
        .join("images")
        .join("products");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Descarga de imágenes pendientes desde el ERP hacia el POS local (Worker en segundo plano).
/// Solo descarga productos donde `image_sync_status = 'pending_download'`.
pub async fn download_pending_images_internal(app: &AppHandle, db: &Db) -> AppResult<usize> {
    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url")
            .or_else(|| get_setting(&conn, "erp_api_url"))
            .unwrap_or_default();
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    let pending_images: Vec<(i64, String, String, Option<String>)> = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, sku, image_url, image_hash FROM products \
             WHERE image_sync_status = 'pending_download' AND image_url IS NOT NULL AND active = 1 \
             LIMIT 15",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })?;
        rows.filter_map(Result::ok).collect()
    };

    if pending_images.is_empty() {
        return Ok(0);
    }

    let images_dir = get_images_dir(app);
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(0),
    };

    let mut downloaded_count = 0;

    for (product_id, sku, image_url, expected_hash) in pending_images {
        let full_url = if image_url.starts_with("http://") || image_url.starts_with("https://") {
            image_url.clone()
        } else {
            if erp_url.is_empty() {
                continue;
            }
            format!("{}/{}", erp_url.trim_end_matches('/'), image_url.trim_start_matches('/'))
        };

        let mut req = client.get(&full_url);
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        let res = req.send().await;
        let resp = match res {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                eprintln!("[Images] HTTP {} al descargar imagen de {}", r.status(), sku);
                if let Ok(conn) = db.conn() {
                    let _ = conn.execute(
                        "UPDATE products SET image_sync_status = 'failed' WHERE id = ?1",
                        params![product_id],
                    );
                }
                continue;
            }
            Err(e) => {
                eprintln!("[Images] Error al conectar para descargar imagen de {}: {}", sku, e);
                continue;
            }
        };

        let bytes_data = match resp.bytes().await {
            Ok(b) => b,
            Err(_) => continue,
        };

        if bytes_data.is_empty() {
            continue;
        }

        let slice = bytes_data.as_ref();
        let computed_hash = calculate_sha256(slice);
        let hash_to_store = expected_hash.unwrap_or_else(|| computed_hash.clone());

        let clean_sku: String = sku
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect();
        let short_hash = &computed_hash[..computed_hash.len().min(12)];
        let file_name = format!("{clean_sku}_{short_hash}.webp");
        let dest_path = images_dir.join(&file_name);

        if let Err(e) = fs::write(&dest_path, slice) {
            eprintln!("[Images] No se pudo escribir archivo local {}: {}", dest_path.display(), e);
            continue;
        }

        let local_path_str = dest_path.to_string_lossy().to_string();

        if let Ok(conn) = db.conn() {
            let _ = conn.execute(
                "UPDATE products SET image_local_path = ?1, image_hash = ?2, image_sync_status = 'synced' WHERE id = ?3",
                params![local_path_str, hash_to_store, product_id],
            );
        }

        downloaded_count += 1;
    }

    Ok(downloaded_count)
}

/// Sube al ERP las imágenes capturadas o modificadas localmente en el POS (delegado a Db).
pub async fn upload_pending_images_internal(_app: &AppHandle, db: &Db) -> AppResult<usize> {
    upload_pending_images_db(db).await
}

/// Sube al ERP las imágenes pendientes directamente con la referencia a la base de datos local.
pub async fn upload_pending_images_db(db: &Db) -> AppResult<usize> {
    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url")
            .or_else(|| get_setting(&conn, "erp_api_url"))
            .unwrap_or_default();
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if erp_url.is_empty() || token.is_empty() {
        return Ok(0);
    }

    let pending_uploads: Vec<(i64, String, String)> = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, sku, image_local_path FROM products \
             WHERE image_sync_status = 'pending_upload' AND image_local_path IS NOT NULL AND active = 1 \
             LIMIT 50",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        rows.filter_map(Result::ok).collect()
    };

    if pending_uploads.is_empty() {
        return Ok(0);
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(0),
    };

    let upload_url = format!("{}/api/pos/v1/sync/productos/imagen", erp_url.trim_end_matches('/'));
    let mut uploaded_count = 0;

    for (product_id, sku, local_path) in pending_uploads {
        let path = PathBuf::from(&local_path);
        if !path.exists() {
            if let Ok(conn) = db.conn() {
                let _ = conn.execute(
                    "UPDATE products SET image_sync_status = 'none', image_local_path = NULL WHERE id = ?1",
                    params![product_id],
                );
            }
            continue;
        }

        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };

        let base64_data = BASE64_STANDARD.encode(&bytes);
        let payload = serde_json::json!({
            "sku": sku,
            "imageBase64": base64_data,
            "mimeType": "image/webp"
        });

        let resp_res = client
            .post(&upload_url)
            .header("Authorization", format!("Bearer {token}"))
            .json(&payload)
            .send()
            .await;

        let resp = match resp_res {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[Images] Error al enviar imagen de {} al ERP: {}", sku, e);
                continue;
            }
        };

        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let remote_url = json["data"]["imageUrl"].as_str().map(String::from);
                let remote_hash = json["data"]["imageHash"].as_str().map(String::from);

                if let Ok(conn) = db.conn() {
                    let _ = conn.execute(
                        "UPDATE products SET image_url = ?1, image_hash = ?2, image_sync_status = 'synced' WHERE id = ?3",
                        params![remote_url, remote_hash, product_id],
                    );
                }
                uploaded_count += 1;
            }
        }
    }

    Ok(uploaded_count)
}

/// Guarda una imagen localmente desde Base64 para un producto y encola su sincronización.
#[tauri::command]
pub async fn save_product_image_local(
    app: AppHandle,
    db: State<'_, Db>,
    product_id: i64,
    image_base64: String,
) -> AppResult<Product> {
    if product_id <= 0 {
        return Err(AppError::Validation("ID de producto inválido".into()));
    }

    let clean_b64 = if let Some(idx) = image_base64.find("base64,") {
        &image_base64[idx + 7..]
    } else {
        &image_base64
    };

    let bytes = BASE64_STANDARD
        .decode(clean_b64.trim())
        .map_err(|e| AppError::Validation(format!("Formato Base64 inválido: {e}")))?;

    if bytes.is_empty() {
        return Err(AppError::Validation("La imagen recibida está vacía".into()));
    }

    let hash = calculate_sha256(&bytes);
    let short_hash = &hash[..hash.len().min(12)];

    let (sku,): (String,) = {
        let conn = db.conn()?;
        conn.query_row(
            "SELECT sku FROM products WHERE id = ?1",
            params![product_id],
            |r| Ok((r.get(0)?,)),
        )
        .map_err(|_| AppError::Validation("Producto no encontrado".into()))?
    };

    let clean_sku: String = sku
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();

    let images_dir = get_images_dir(&app);
    let file_name = format!("{clean_sku}_{short_hash}.webp");
    let dest_path = images_dir.join(&file_name);

    fs::write(&dest_path, &bytes)?;

    let local_path_str = dest_path.to_string_lossy().to_string();

    {
        let conn = db.conn()?;
        conn.execute(
            "UPDATE products SET image_local_path = ?1, image_hash = ?2, image_sync_status = 'pending_upload', \
             needs_erp_upload = 1, updated_at = datetime('now') WHERE id = ?3",
            params![local_path_str, hash, product_id],
        )?;
    }

    let conn = db.conn()?;
    let sql = "SELECT p.id, p.sku, p.barcode, p.name, p.category_id, p.unit, p.price_cents, p.cost_cents, \
               p.tax_rate_bp, p.stock, p.min_stock, p.is_service, p.active, p.controls_stock, p.allow_negative_stock, \
               p.is_bundle, p.tags, p.tax_fixed_cents, c.name, p.image_url, p.image_local_path, p.image_hash, p.image_sync_status, \
               p.wholesale_price_cents, p.max_stock \
               FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?1";

    let mut product = conn.query_row(sql, params![product_id], |r| {
        let is_service_int: i64 = r.get(11)?;
        let active_int: i64 = r.get(12)?;
        let controls_stock_int: i64 = r.get(13).unwrap_or(if is_service_int != 0 { 0 } else { 1 });
        let allow_negative_stock_int: i64 = r.get(14).unwrap_or(1);
        let is_bundle_int: i64 = r.get(15).unwrap_or(0);
        let tags: Option<String> = r.get(16).ok();
        let tax_fixed_cents: i64 = r.get(17).unwrap_or(0);
        let category_name: Option<String> = r.get(18).ok();
        let image_url: Option<String> = r.get(19).ok();
        let image_local_path: Option<String> = r.get(20).ok();
        let image_hash: Option<String> = r.get(21).ok();
        let image_sync_status: Option<String> = r.get(22).ok();
        let wholesale_price_cents: i64 = r.get(23).unwrap_or(0);
        let max_stock: f64 = r.get(24).unwrap_or(0.0);

        Ok(Product {
            id: r.get(0)?,
            sku: r.get(1)?,
            barcode: r.get(2)?,
            name: r.get(3)?,
            category_id: r.get(4)?,
            category_name,
            unit: r.get(5)?,
            price_cents: r.get(6)?,
            wholesale_price_cents,
            cost_cents: r.get(7)?,
            tax_rate_bp: r.get(8)?,
            stock: r.get(9)?,
            min_stock: r.get(10)?,
            max_stock,
            is_service: is_service_int != 0,
            controls_stock: controls_stock_int != 0,
            allow_negative_stock: allow_negative_stock_int != 0,
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
    })?;

    if product.is_bundle {
        if let Ok(Some(bundle_stock)) = calculate_bundle_stock(&conn, product.id) {
            product.stock = bundle_stock.max(0.0);
        }
    }

    Ok(product)
}

/// Elimina la imagen de un producto localmente y marca para sincronizar la baja con el ERP.
#[tauri::command]
pub fn delete_product_image_local(
    db: State<'_, Db>,
    product_id: i64,
) -> AppResult<Product> {
    if product_id <= 0 {
        return Err(AppError::Validation("ID de producto inválido".into()));
    }

    let existing_path: Option<String> = {
        let conn = db.conn()?;
        conn.query_row(
            "SELECT image_local_path FROM products WHERE id = ?1",
            params![product_id],
            |r| r.get(0),
        )
        .ok()
        .flatten()
    };

    if let Some(path_str) = existing_path {
        let p = PathBuf::from(path_str);
        if p.exists() {
            let _ = fs::remove_file(p);
        }
    }

    {
        let conn = db.conn()?;
        conn.execute(
            "UPDATE products SET image_local_path = NULL, image_url = NULL, image_hash = NULL, \
             image_sync_status = 'pending_upload', needs_erp_upload = 1, updated_at = datetime('now') WHERE id = ?1",
            params![product_id],
        )?;
    }

    let conn = db.conn()?;
    let sql = "SELECT p.id, p.sku, p.barcode, p.name, p.category_id, p.unit, p.price_cents, p.cost_cents, \
               p.tax_rate_bp, p.stock, p.min_stock, p.is_service, p.active, p.controls_stock, p.allow_negative_stock, \
               p.is_bundle, p.tags, p.tax_fixed_cents, c.name, p.image_url, p.image_local_path, p.image_hash, p.image_sync_status, \
               p.wholesale_price_cents, p.max_stock \
               FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?1";

    let mut product = conn.query_row(sql, params![product_id], |r| {
        let is_service_int: i64 = r.get(11)?;
        let active_int: i64 = r.get(12)?;
        let controls_stock_int: i64 = r.get(13).unwrap_or(if is_service_int != 0 { 0 } else { 1 });
        let allow_negative_stock_int: i64 = r.get(14).unwrap_or(1);
        let is_bundle_int: i64 = r.get(15).unwrap_or(0);
        let tags: Option<String> = r.get(16).ok();
        let tax_fixed_cents: i64 = r.get(17).unwrap_or(0);
        let category_name: Option<String> = r.get(18).ok();
        let image_url: Option<String> = r.get(19).ok();
        let image_local_path: Option<String> = r.get(20).ok();
        let image_hash: Option<String> = r.get(21).ok();
        let image_sync_status: Option<String> = r.get(22).ok();
        let wholesale_price_cents: i64 = r.get(23).unwrap_or(0);
        let max_stock: f64 = r.get(24).unwrap_or(0.0);

        Ok(Product {
            id: r.get(0)?,
            sku: r.get(1)?,
            barcode: r.get(2)?,
            name: r.get(3)?,
            category_id: r.get(4)?,
            category_name,
            unit: r.get(5)?,
            price_cents: r.get(6)?,
            wholesale_price_cents,
            cost_cents: r.get(7)?,
            tax_rate_bp: r.get(8)?,
            stock: r.get(9)?,
            min_stock: r.get(10)?,
            max_stock,
            is_service: is_service_int != 0,
            controls_stock: controls_stock_int != 0,
            allow_negative_stock: allow_negative_stock_int != 0,
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
    })?;

    if product.is_bundle {
        if let Ok(Some(bundle_stock)) = calculate_bundle_stock(&conn, product.id) {
            product.stock = bundle_stock.max(0.0);
        }
    }

    Ok(product)
}

/// Obtiene la imagen de un producto en formato Data URL Base64 (`data:image/webp;base64,...`)
/// para garantizar la previsualización inmediata en cualquier entorno webview.
#[tauri::command]
pub fn get_product_image_base64(
    db: State<'_, Db>,
    product_id: i64,
) -> AppResult<Option<String>> {
    if product_id <= 0 {
        return Ok(None);
    }

    let local_path: Option<String> = {
        let conn = db.conn()?;
        conn.query_row(
            "SELECT image_local_path FROM products WHERE id = ?1",
            params![product_id],
            |r| r.get(0),
        )
        .ok()
        .flatten()
    };

    let path_str = match local_path {
        Some(p) => p,
        None => return Ok(None),
    };

    let path = PathBuf::from(&path_str);
    if !path.exists() {
        return Ok(None);
    }

    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Ok(None),
    };

    let b64 = BASE64_STANDARD.encode(&bytes);
    Ok(Some(format!("data:image/webp;base64,{b64}")))
}

