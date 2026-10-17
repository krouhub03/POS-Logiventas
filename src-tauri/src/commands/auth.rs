use rusqlite::params;
use serde_json::Value;
use std::time::Duration;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::auth::{
    CashierUser, ErpCajaOption, PairCodeInput, PairLoginInput, PairLoginResult, ReconnectTerminalInput, TerminalStatus,
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

fn fetch_status_sync(conn: &rusqlite::Connection) -> TerminalStatus {
    let pairing_status = get_setting(conn, "pairing_status").unwrap_or_else(|| "unpaired".into());
    let is_paired = pairing_status == "linked";
    let erp_url = get_setting(conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".into());
    let is_disconnected = get_setting(conn, "is_disconnected").as_deref() == Some("1");

    TerminalStatus {
        is_paired,
        erp_url,
        caja_id: get_setting(conn, "caja_id"),
        caja_nombre: get_setting(conn, "caja_nombre"),
        caja_codigo: get_setting(conn, "caja_codigo"),
        bodega_id: get_setting(conn, "bodega_id"),
        bodega_nombre: get_setting(conn, "bodega_nombre"),
        empresa_id: get_setting(conn, "empresa_id"),
        empresa_nombre: get_setting(conn, "empresa_nombre"),
        empresa_nit: get_setting(conn, "empresa_nit"),
        active_cashier: None,
        active_cashier_revoked: None,
        last_caja_id: get_setting(conn, "last_caja_id"),
        last_caja_codigo: get_setting(conn, "last_caja_codigo"),
        last_caja_nombre: get_setting(conn, "last_caja_nombre"),
        last_empresa_nombre: get_setting(conn, "last_empresa_nombre"),
        is_disconnected: Some(is_disconnected),
    }
}

// ─────────────────────────────────────────────────────────────
// HTTP Helpers (Async - Sin referencias a rusqlite::Connection)
// ─────────────────────────────────────────────────────────────

fn internal_unpair(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    // Preservar la identidad de la caja antes de desvincular para permitir reconexión ágil
    if let Some(cid) = get_setting(conn, "caja_id") {
        set_setting(conn, "last_caja_id", &cid)?;
    }
    if let Some(ccod) = get_setting(conn, "caja_codigo") {
        set_setting(conn, "last_caja_codigo", &ccod)?;
    }
    if let Some(cnom) = get_setting(conn, "caja_nombre") {
        set_setting(conn, "last_caja_nombre", &cnom)?;
    }
    if let Some(enom) = get_setting(conn, "empresa_nombre") {
        set_setting(conn, "last_empresa_nombre", &enom)?;
    }
    if let Some(eid) = get_setting(conn, "empresa_id") {
        set_setting(conn, "last_empresa_id", &eid)?;
    }
    if let Some(bid) = get_setting(conn, "bodega_id") {
        set_setting(conn, "last_bodega_id", &bid)?;
    }
    if let Some(bnom) = get_setting(conn, "bodega_nombre") {
        set_setting(conn, "last_bodega_nombre", &bnom)?;
    }
    if let Some(url) = get_setting(conn, "erp_url") {
        set_setting(conn, "last_erp_url", &url)?;
    }
    set_setting(conn, "is_disconnected", "1")?;

    set_setting(conn, "pairing_status", "unpaired")?;
    set_setting(conn, "terminal_token", "")?;
    set_setting(conn, "caja_id", "")?;
    set_setting(conn, "caja_nombre", "")?;
    set_setting(conn, "caja_codigo", "")?;
    set_setting(conn, "bodega_id", "")?;
    set_setting(conn, "bodega_nombre", "")?;
    Ok(())
}

async fn http_verify_user(erp_url: &str, token: &str, erp_user_id: &str) -> AppResult<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2500))
        .build()?;

    let url = format!("{}/api/pos/v1/terminal/usuarios/verificar", erp_url.trim_end_matches('/'));
    let res = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "erpUserId": erp_user_id }))
        .send()
        .await?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!("Error del ERP al verificar usuario: {err_text}")));
    }

    Ok(res.json().await?)
}

async fn http_fetch_users(erp_url: &str, token: &str) -> AppResult<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let url = format!("{}/api/pos/v1/terminal/usuarios", erp_url.trim_end_matches('/'));
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await?;

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!("Error del ERP al sincronizar usuarios: {err_text}")));
    }

    Ok(res.json().await?)
}

fn save_synced_users(conn: &rusqlite::Connection, json: &Value) -> AppResult<Vec<CashierUser>> {
    let users_array = json["data"]["usuarios"]
        .as_array()
        .ok_or_else(|| AppError::Auth("Formato inválido de usuarios recibido del ERP".into()))?;

    let mut result = Vec::new();
    let mut valid_erp_ids: Vec<String> = Vec::new();

    for u in users_array {
        let erp_user_id = u["erpUserId"].as_str().unwrap_or_default();
        if erp_user_id.is_empty() {
            continue;
        }
        valid_erp_ids.push(erp_user_id.to_string());

        let email = u["email"].as_str().unwrap_or_default();
        let nombre = u["nombre"].as_str().unwrap_or_default();
        let rol = u["rol"].as_str().unwrap_or("cashier");
        let perfil_str = u["perfil"].as_str().unwrap_or("").to_lowercase();
        let pin_hash = u["pinHash"].as_str();

        let role_mapped = match rol {
            "SUPERADMINSAAS" | "ADMIN_EMPRESA" => "admin",
            "STAFF" => {
                if perfil_str.contains("cajer") || perfil_str.contains("pos") || perfil_str.contains("vendedor") {
                    "cashier"
                } else if perfil_str.contains("superv") || perfil_str.contains("encargad") || perfil_str.contains("gerent") {
                    "manager"
                } else {
                    "cashier"
                }
            },
            _ => "cashier",
        };

        let permisos_val = &u["permisos"];
        let permisos_vec: Vec<String> = if permisos_val.is_array() {
            serde_json::from_value(permisos_val.clone()).unwrap_or_default()
        } else {
            Vec::new()
        };
        let permisos_json = serde_json::to_string(&permisos_vec).unwrap_or_else(|_| "[]".into());
        let rol_codigo = u["rol"].as_str().unwrap_or("STAFF");
        let perfil_nombre = if rol_codigo == "SUPERADMINSAAS" {
            Some("Soporte")
        } else {
            u["perfil"]
                .as_str()
                .filter(|s| !s.is_empty() && *s != "Operador POS" && *s != "Cajero POS")
        };

        conn.execute(
            "INSERT INTO users (erp_user_id, username, email, full_name, pin_hash, role, permissions, erp_profile_name, erp_role_code, active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)
             ON CONFLICT(erp_user_id) DO UPDATE SET
                username = excluded.username,
                email = excluded.email,
                full_name = excluded.full_name,
                pin_hash = COALESCE(excluded.pin_hash, users.pin_hash),
                role = excluded.role,
                permissions = excluded.permissions,
                erp_profile_name = excluded.erp_profile_name,
                erp_role_code = excluded.erp_role_code,
                active = 1",
            params![erp_user_id, email, email, nombre, pin_hash, role_mapped, permisos_json, perfil_nombre, rol_codigo],
        )?;

        let (id, login_count): (i64, i64) = conn.query_row(
            "SELECT id, COALESCE(login_count, 0) FROM users WHERE erp_user_id = ?1",
            params![erp_user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        result.push(CashierUser {
            id,
            erp_user_id: Some(erp_user_id.to_string()),
            username: email.to_string(),
            full_name: nombre.to_string(),
            email: Some(email.to_string()),
            role: role_mapped.to_string(),
            active: true,
            permissions: permisos_vec,
            profile_name: perfil_nombre.map(String::from),
            erp_role_code: Some(rol_codigo.to_string()),
            login_count: Some(login_count),
        });
    }

    // Desactivar usuarios locales con erp_user_id que ya no están autorizados en el ERP (ej. clientes antiguos)
    if !valid_erp_ids.is_empty() {
        let placeholders: Vec<String> = (1..=valid_erp_ids.len()).map(|i| format!("?{}", i)).collect();
        let query = format!(
            "UPDATE users SET active = 0 WHERE erp_user_id IS NOT NULL AND erp_user_id NOT IN ({})",
            placeholders.join(", ")
        );
        let params_slice: Vec<&dyn rusqlite::ToSql> = valid_erp_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        conn.execute(&query, rusqlite::params_from_iter(params_slice))?;

        // Desactivar cualquier usuario legacy local sin erp_user_id (ej. seed 'admin' de inicialización)
        let _ = conn.execute("UPDATE users SET active = 0 WHERE erp_user_id IS NULL", []);
    }

    Ok(result)
}

pub fn sanitize_erp_url(raw_url: &str) -> String {
    let trimmed = raw_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "http://localhost:3000".to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.starts_with("localhost")
        || trimmed.starts_with("127.0.0.1")
        || trimmed.starts_with("192.168.")
        || trimmed.starts_with("10.")
        || trimmed.starts_with("172.")
    {
        format!("http://{}", trimmed)
    } else {
        format!("https://{}", trimmed)
    }
}

#[tauri::command]
pub fn get_terminal_status(db: State<'_, Db>) -> AppResult<TerminalStatus> {
    let conn = db.conn()?;
    Ok(fetch_status_sync(&conn))
}

#[tauri::command]
pub async fn pair_terminal_code(
    db: State<'_, Db>,
    input: PairCodeInput,
) -> AppResult<TerminalStatus> {
    let clean_url = sanitize_erp_url(&input.erp_url);
    let url = format!("{}/api/pos/v1/terminal/vincular", clean_url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let sanitized_code = input.code.replace(' ', "").trim().to_uppercase();
    let res = client
        .post(&url)
        .json(&serde_json::json!({
            "codigoVinculacion": sanitized_code
        }))
        .send()
        .await?;

    if !res.status().is_success() {
        let err_json: Value = res.json().await.unwrap_or_default();
        let msg = err_json["message"]
            .as_str()
            .unwrap_or("No se pudo vincular con el código provisto");
        return Err(AppError::Auth(msg.to_string()));
    }

    let json: Value = res.json().await?;
    let data = &json["data"];

    let token = data["terminalToken"].as_str().ok_or_else(|| {
        AppError::Auth("No se recibió token de terminal en la respuesta del ERP".into())
    })?;
    let caja_id = data["caja"]["id"].as_str().unwrap_or_default();
    let caja_nombre = data["caja"]["nombre"].as_str().unwrap_or_default();
    let caja_codigo = data["caja"]["codigo"].as_str().unwrap_or_default();
    let empresa_id = data["empresa"]["id"].as_str().unwrap_or_default();
    let empresa_nombre = data["empresa"]["nombre"].as_str().unwrap_or_default();
    let empresa_nit = data["empresa"]["nit"].as_str().unwrap_or_default();
    let bodega_id = data["caja"]["bodegaId"].as_str().or_else(|| data["caja"]["bodega"]["id"].as_str()).unwrap_or_default();
    let bodega_nombre = data["caja"]["bodega"]["nombre"].as_str().unwrap_or_default();

    // Guardar configuración en SQLite y asegurar aislamiento Multi-Tenant
    {
        let conn = db.conn()?;
        let prev_empresa = get_setting(&conn, "empresa_id");
        if let Some(ref prev_id) = prev_empresa {
            if !prev_id.is_empty() && prev_id != empresa_id {
                // Purgar tablas de la empresa anterior para aislamiento estricto
                let _ = conn.execute_batch(
                    "DELETE FROM sale_items;
                     DELETE FROM sales;
                     DELETE FROM sync_queue;
                     DELETE FROM products;
                     DELETE FROM categories;
                     DELETE FROM users;
                     DELETE FROM cash_sessions;",
                );
            }
        }
        set_setting(&conn, "erp_url", &clean_url)?;
        set_setting(&conn, "terminal_token", token)?;
        set_setting(&conn, "caja_id", caja_id)?;
        set_setting(&conn, "caja_nombre", caja_nombre)?;
        set_setting(&conn, "caja_codigo", caja_codigo)?;
        set_setting(&conn, "empresa_id", empresa_id)?;
        set_setting(&conn, "empresa_nombre", empresa_nombre)?;
        set_setting(&conn, "empresa_nit", empresa_nit)?;
        if !bodega_id.is_empty() {
            set_setting(&conn, "bodega_id", bodega_id)?;
        }
        if !bodega_nombre.is_empty() {
            set_setting(&conn, "bodega_nombre", bodega_nombre)?;
        }
        set_setting(&conn, "pairing_status", "linked")?;
        set_setting(&conn, "is_disconnected", "0")?;
    }

    // Sincronizar usuarios desde el ERP
    if let Ok(users_json) = http_fetch_users(&clean_url, token).await {
        let conn = db.conn()?;
        let _ = save_synced_users(&conn, &users_json);
    }

    let conn = db.conn()?;
    Ok(fetch_status_sync(&conn))
}

#[tauri::command]
pub async fn pair_terminal_login(
    db: State<'_, Db>,
    input: PairLoginInput,
) -> AppResult<PairLoginResult> {
    let clean_url = sanitize_erp_url(&input.erp_url);
    let url = format!("{}/api/pos/v1/terminal/login-setup", clean_url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let mut payload = serde_json::json!({
        "email": input.email.trim(),
        "password": input.password
    });

    if let Some(cid) = input.caja_id.as_deref() {
        payload["cajaId"] = serde_json::json!(cid);
    }
    if let Some(nom) = input.nuevo_nombre_caja.as_deref() {
        payload["nuevoNombreCaja"] = serde_json::json!(nom);
    }
    if let Some(cod) = input.nuevo_codigo_caja.as_deref() {
        payload["nuevoCodigoCaja"] = serde_json::json!(cod);
    }

    let res = client.post(&url).json(&payload).send().await?;

    if !res.status().is_success() {
        let err_json: Value = res.json().await.unwrap_or_default();
        let msg = err_json["message"]
            .as_str()
            .unwrap_or("Error de autenticación con el ERP");
        return Err(AppError::Auth(msg.to_string()));
    }

    let json: Value = res.json().await?;
    let data = &json["data"];

    if data["requiereSeleccionCaja"].as_bool().unwrap_or(false) {
        let mut cajas_vec = Vec::new();
        if let Some(arr) = data["cajasDisponibles"].as_array() {
            for c in arr {
                cajas_vec.push(ErpCajaOption {
                    id: c["id"].as_str().unwrap_or_default().to_string(),
                    nombre: c["nombre"].as_str().unwrap_or_default().to_string(),
                    codigo: c["codigo"].as_str().unwrap_or_default().to_string(),
                    estado: c["estado"].as_str().unwrap_or_default().to_string(),
                });
            }
        }

        return Ok(PairLoginResult {
            success: true,
            requiere_seleccion_caja: true,
            cajas_disponibles: Some(cajas_vec),
            terminal_status: None,
        });
    }

    let token = data["terminalToken"].as_str().ok_or_else(|| {
        AppError::Auth("No se recibió token de terminal en la respuesta del ERP".into())
    })?;
    let caja_id = data["caja"]["id"].as_str().unwrap_or_default();
    let caja_nombre = data["caja"]["nombre"].as_str().unwrap_or_default();
    let caja_codigo = data["caja"]["codigo"].as_str().unwrap_or_default();
    let empresa_id = data["empresa"]["id"].as_str().unwrap_or_default();
    let empresa_nombre = data["empresa"]["nombre"].as_str().unwrap_or_default();
    let empresa_nit = data["empresa"]["nit"].as_str().unwrap_or_default();
    let bodega_id = data["caja"]["bodegaId"].as_str().or_else(|| data["caja"]["bodega"]["id"].as_str()).unwrap_or_default();
    let bodega_nombre = data["caja"]["bodega"]["nombre"].as_str().unwrap_or_default();

    {
        let conn = db.conn()?;
        let prev_empresa = get_setting(&conn, "empresa_id");
        if let Some(ref prev_id) = prev_empresa {
            if !prev_id.is_empty() && prev_id != empresa_id {
                let _ = conn.execute_batch(
                    "DELETE FROM sale_items;
                     DELETE FROM sales;
                     DELETE FROM sync_queue;
                     DELETE FROM products;
                     DELETE FROM categories;
                     DELETE FROM users;
                     DELETE FROM cash_sessions;",
                );
            }
        }
        set_setting(&conn, "erp_url", &clean_url)?;
        set_setting(&conn, "terminal_token", token)?;
        set_setting(&conn, "caja_id", caja_id)?;
        set_setting(&conn, "caja_nombre", caja_nombre)?;
        set_setting(&conn, "caja_codigo", caja_codigo)?;
        set_setting(&conn, "empresa_id", empresa_id)?;
        set_setting(&conn, "empresa_nombre", empresa_nombre)?;
        set_setting(&conn, "empresa_nit", empresa_nit)?;
        if !bodega_id.is_empty() {
            set_setting(&conn, "bodega_id", bodega_id)?;
        }
        if !bodega_nombre.is_empty() {
            set_setting(&conn, "bodega_nombre", bodega_nombre)?;
        }
        set_setting(&conn, "pairing_status", "linked")?;
        set_setting(&conn, "is_disconnected", "0")?;
    }

    if let Ok(users_json) = http_fetch_users(&clean_url, token).await {
        let conn = db.conn()?;
        let _ = save_synced_users(&conn, &users_json);
    }

    let conn = db.conn()?;
    Ok(PairLoginResult {
        success: true,
        requiere_seleccion_caja: false,
        cajas_disponibles: None,
        terminal_status: Some(fetch_status_sync(&conn)),
    })
}

#[tauri::command]
pub async fn sync_users_from_erp(db: State<'_, Db>) -> AppResult<Vec<CashierUser>> {
    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").ok_or_else(|| {
            AppError::Auth("La terminal no tiene configurada la URL del ERP".into())
        })?;
        let token = get_setting(&conn, "terminal_token").ok_or_else(|| {
            AppError::Auth("La terminal no cuenta con credencial vinculada".into())
        })?;
        (erp_url, token)
    };

    let users_json = http_fetch_users(&erp_url, &token).await?;

    let conn = db.conn()?;
    save_synced_users(&conn, &users_json)
}

#[tauri::command]
pub fn list_local_cashiers(db: State<'_, Db>) -> AppResult<Vec<CashierUser>> {
    let conn = db.conn()?;
    let is_paired = get_setting(&conn, "empresa_id").is_some() || get_setting(&conn, "terminal_token").is_some();
    let query = if is_paired {
        "SELECT id, erp_user_id, username, full_name, email, role, active, permissions, erp_profile_name, login_count, erp_role_code
         FROM users WHERE active = 1 AND erp_user_id IS NOT NULL AND (erp_role_code IS NULL OR erp_role_code != 'CLIENTE') AND role != 'customer'
         ORDER BY login_count DESC, full_name ASC"
    } else {
        "SELECT id, erp_user_id, username, full_name, email, role, active, permissions, erp_profile_name, login_count, erp_role_code
         FROM users WHERE active = 1 AND (erp_role_code IS NULL OR erp_role_code != 'CLIENTE') AND role != 'customer'
         ORDER BY login_count DESC, full_name ASC"
    };
    let mut stmt = conn.prepare(query)?;

    let rows = stmt.query_map([], |r| {
        let permissions_raw: Option<String> = r.get(7).ok();
        let permissions: Vec<String> = permissions_raw
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        Ok(CashierUser {
            id: r.get(0)?,
            erp_user_id: r.get(1)?,
            username: r.get(2)?,
            full_name: r.get(3)?,
            email: r.get(4)?,
            role: r.get(5)?,
            active: r.get::<_, i64>(6)? == 1,
            permissions,
            profile_name: r.get(8)?,
            erp_role_code: r.get(10).ok(),
            login_count: r.get(9)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Inicia sesión validando el PIN exclusivamente para el usuario seleccionado.
/// Garantiza cero colisiones aunque dos cajeros tengan el mismo PIN.
/// Principio: Verifica en tiempo real con el ERP (timeout ultra-rápido 2.5s); si se pierde conexión, degrada a SQLite local (Offline-First).
#[tauri::command]
pub async fn login_cashier_user_pin(db: State<'_, Db>, user_id: i64, pin: String) -> AppResult<CashierUser> {
    let trimmed_pin = pin.trim();
    if !trimmed_pin.chars().all(|c| c.is_ascii_digit()) || trimmed_pin.len() < 4 || trimmed_pin.len() > 6 {
        return Err(AppError::Auth("El PIN debe tener entre 4 y 6 dígitos numéricos".into()));
    }

    // 1. Obtener datos locales del usuario y credenciales del terminal
    let (erp_user_id_opt, user_full_name, erp_url_opt, token_opt) = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT erp_user_id, full_name FROM users WHERE id = ?1 AND active = 1 AND (erp_role_code IS NULL OR erp_role_code != 'CLIENTE') AND role != 'customer'",
        )?;
        let row = stmt.query_row(params![user_id], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?))
        }).map_err(|_| AppError::Auth("Usuario no encontrado, inactivo o con rol CLIENTE no autorizado".into()))?;

        let erp_url = get_setting(&conn, "erp_url");
        let token = get_setting(&conn, "terminal_token");
        (row.0, row.1, erp_url, token)
    };

    // 2. VERIFICACIÓN EN TIEMPO REAL CON EL ERP (Si hay red y token de terminal)
    if let (Some(ref erp_id), Some(ref erp_url), Some(ref token)) = (erp_user_id_opt.as_ref(), erp_url_opt.as_ref(), token_opt.as_ref()) {
        if !erp_url.is_empty() && !token.is_empty() {
            match http_verify_user(erp_url, token, erp_id).await {
                Ok(verify_json) => {
                    let autorizado = verify_json["data"]["autorizado"].as_bool().unwrap_or(false);
                    if !autorizado {
                        let mensaje = verify_json["data"]["mensaje"].as_str().unwrap_or("Usuario no autorizado para operar caja");

                        // Desactivar inmediatamente en SQLite local para prevenir accesos
                        let conn = db.conn()?;
                        let _ = conn.execute(
                            "UPDATE users SET active = 0, erp_role_code = 'CLIENTE' WHERE id = ?1",
                            params![user_id],
                        );

                        return Err(AppError::Auth(format!("Acceso denegado: {}", mensaje)));
                    } else {
                        // El usuario sigue autorizado en el ERP: refrescar datos en SQLite local
                        let u_data = &verify_json["data"]["usuario"];
                        let fresh_rol = u_data["rol"].as_str().unwrap_or("STAFF");
                        let fresh_perfil = if fresh_rol == "SUPERADMINSAAS" {
                            Some("Soporte")
                        } else {
                            u_data["perfil"].as_str().filter(|s| !s.is_empty())
                        };
                        let fresh_pin_hash = u_data["pinHash"].as_str();
                        let fresh_permisos = &u_data["permisos"];
                        let permisos_vec: Vec<String> = if fresh_permisos.is_array() {
                            serde_json::from_value(fresh_permisos.clone()).unwrap_or_default()
                        } else {
                            Vec::new()
                        };
                        let permisos_json = serde_json::to_string(&permisos_vec).unwrap_or_else(|_| "[]".into());

                        let role_mapped = match fresh_rol {
                            "SUPERADMINSAAS" | "ADMIN_EMPRESA" => "admin",
                            "STAFF" => {
                                let p_lower = fresh_perfil.unwrap_or("").to_lowercase();
                                if p_lower.contains("superv") || p_lower.contains("gerent") {
                                    "manager"
                                } else {
                                    "cashier"
                                }
                            },
                            _ => "cashier",
                        };

                        let conn = db.conn()?;
                        let _ = conn.execute(
                            "UPDATE users SET 
                                role = ?1,
                                permissions = ?2,
                                erp_profile_name = ?3,
                                erp_role_code = ?4,
                                pin_hash = COALESCE(?5, pin_hash)
                             WHERE id = ?6",
                            params![role_mapped, permisos_json, fresh_perfil, fresh_rol, fresh_pin_hash, user_id],
                        );
                    }
                }
                Err(e) => {
                    // Fallo transitorio de red o timeout (>2.5s):
                    // Respetar política Offline-First pero registrar advertencia
                    eprintln!("[OFFLINE-FIRST] Sin conexión al ERP para verificar usuario ({e}). Procediendo con base local.");
                }
            }
        }
    }

    // 3. Validación de PIN contra SQLite local con protección Rate-Limiting contra fuerza bruta
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, erp_user_id, username, full_name, email, role, active, pin_hash, permissions, erp_profile_name, login_count, erp_role_code, failed_pin_attempts, locked_until
         FROM users WHERE id = ?1 AND active = 1 AND (erp_role_code IS NULL OR erp_role_code != 'CLIENTE') AND role != 'customer'",
    )?;

    let user_row = stmt.query_row(params![user_id], |r| {
        let permissions_raw: Option<String> = r.get(8).ok();
        let permissions: Vec<String> = permissions_raw
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        Ok((
            CashierUser {
                id: r.get(0)?,
                erp_user_id: r.get(1)?,
                username: r.get(2)?,
                full_name: r.get(3)?,
                email: r.get(4)?,
                role: r.get(5)?,
                active: r.get::<_, i64>(6)? == 1,
                permissions,
                profile_name: r.get(9)?,
                erp_role_code: r.get(11).ok(),
                login_count: r.get(10)?,
            },
            r.get::<_, Option<String>>(7)?,
            r.get::<_, i64>(12).unwrap_or(0),
            r.get::<_, Option<String>>(13)?,
        ))
    }).map_err(|_| AppError::Auth(format!("El usuario '{}' no está autorizado o tiene rol CLIENTE", user_full_name)))?;

    let (mut cashier_user, pin_hash_opt, failed_attempts, locked_until) = user_row;

    // Verificar si el operador se encuentra temporalmente bloqueado por intentos sucesivos
    if let Some(lock_time_str) = locked_until {
        let is_locked: bool = conn
            .query_row(
                "SELECT datetime('now') < ?1",
                params![lock_time_str],
                |r| r.get(0),
            )
            .unwrap_or(false);

        if is_locked {
            return Err(AppError::Auth(format!(
                "⛔ Acceso suspendido temporalmente para {}. Demasiados intentos erróneos. Espera 60 segundos.",
                cashier_user.full_name
            )));
        }
    }

    let pin_hash = pin_hash_opt.ok_or_else(|| {
        AppError::Auth(format!("El usuario '{}' no tiene un PIN configurado en el ERP", cashier_user.full_name))
    })?;

    if bcrypt::verify(trimmed_pin, &pin_hash).unwrap_or(false) {
        // Éxito: resetear contador de fallos y actualizar estadísticas de acceso
        let _ = conn.execute(
            "UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = datetime('now'), failed_pin_attempts = 0, locked_until = NULL WHERE id = ?1",
            params![user_id],
        );
        cashier_user.login_count = Some(cashier_user.login_count.unwrap_or(0) + 1);
        Ok(cashier_user)
    } else {
        let new_failed = failed_attempts + 1;
        if new_failed >= 5 {
            // Bloqueo temporal de 60 segundos tras 5 intentos erróneos
            let _ = conn.execute(
                "UPDATE users SET failed_pin_attempts = ?1, locked_until = datetime('now', '+60 seconds') WHERE id = ?2",
                params![new_failed, user_id],
            );
            Err(AppError::Auth(format!(
                "⛔ PIN incorrecto. Has superado 5 intentos. El usuario '{}' ha sido bloqueado por 60 segundos por seguridad.",
                cashier_user.full_name
            )))
        } else {
            let _ = conn.execute(
                "UPDATE users SET failed_pin_attempts = ?1 WHERE id = ?2",
                params![new_failed, user_id],
            );
            let intentos_restantes = 5 - new_failed;
            Err(AppError::Auth(format!(
                "PIN incorrecto para {}. Te quedan {} intentos antes del bloqueo temporal.",
                cashier_user.full_name, intentos_restantes
            )))
        }
    }
}

#[tauri::command]
pub fn login_cashier_pin(db: State<'_, Db>, pin: String) -> AppResult<CashierUser> {
    let trimmed_pin = pin.trim();
    if !trimmed_pin.chars().all(|c| c.is_ascii_digit()) || trimmed_pin.len() < 4 || trimmed_pin.len() > 6 {
        return Err(AppError::Auth("El PIN debe tener entre 4 y 6 dígitos numéricos".into()));
    }

    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, erp_user_id, username, full_name, email, role, active, pin_hash, permissions, erp_profile_name, login_count, erp_role_code, failed_pin_attempts, locked_until
         FROM users WHERE active = 1 AND pin_hash IS NOT NULL AND (erp_role_code IS NULL OR erp_role_code != 'CLIENTE') AND role != 'customer'",
    )?;

    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let user_id: i64 = r.get(0)?;
        let locked_until: Option<String> = r.get(13)?;

        // Si está bloqueado este usuario específico, ignorar
        if let Some(lock_time) = locked_until {
            let is_locked: bool = conn
                .query_row(
                    "SELECT datetime('now') < ?1",
                    params![lock_time],
                    |res| res.get(0),
                )
                .unwrap_or(false);
            if is_locked {
                continue;
            }
        }

        let pin_hash: String = r.get(7)?;
        if bcrypt::verify(trimmed_pin, &pin_hash).unwrap_or(false) {
            let _ = conn.execute(
                "UPDATE users SET login_count = COALESCE(login_count, 0) + 1, last_login_at = datetime('now'), failed_pin_attempts = 0, locked_until = NULL WHERE id = ?1",
                params![user_id],
            );

            let permissions_raw: Option<String> = r.get(8).ok();
            let permissions: Vec<String> = permissions_raw
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            return Ok(CashierUser {
                id: user_id,
                erp_user_id: r.get(1)?,
                username: r.get(2)?,
                full_name: r.get(3)?,
                email: r.get(4)?,
                role: r.get(5)?,
                active: r.get::<_, i64>(6)? == 1,
                permissions,
                profile_name: r.get(9)?,
                erp_role_code: r.get(11).ok(),
                login_count: r.get(10)?,
            });
        }
    }

    Err(AppError::Auth("PIN incorrecto o usuario no autorizado".into()))
}

#[tauri::command]
pub async fn unpair_terminal(db: State<'_, Db>) -> AppResult<TerminalStatus> {
    {
        let conn = db.conn()?;
        let existe_abierto: i64 = conn.query_row(
            "SELECT COUNT(*) FROM cash_sessions WHERE status = 'open'",
            [],
            |r| r.get(0),
        )?;
        if existe_abierto > 0 {
            return Err(AppError::Validation(
                "No se puede desvincular la terminal mientras exista un turno de caja activo. Realiza el arqueo y cierre de caja primero.".into(),
            ));
        }
    }

    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_default();
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if !erp_url.is_empty() && !token.is_empty() {
        if let Ok(client) = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
        {
            let url = format!("{}/api/pos/v1/terminal/estado", erp_url.trim_end_matches('/'));
            let _ = client
                .post(&url)
                .header("Authorization", format!("Bearer {token}"))
                .json(&serde_json::json!({ "accion": "DESVINCULAR" }))
                .send()
                .await;
        }
    }

    let conn = db.conn()?;
    internal_unpair(&conn)?;
    Ok(fetch_status_sync(&conn))
}

/// 🗑️ Olvida por completo cualquier caja previamente recordada o desconectada.
#[tauri::command]
pub async fn forget_terminal(db: State<'_, Db>) -> AppResult<TerminalStatus> {
    {
        let conn = db.conn()?;
        let existe_abierto: i64 = conn.query_row(
            "SELECT COUNT(*) FROM cash_sessions WHERE status = 'open'",
            [],
            |r| r.get(0),
        )?;
        if existe_abierto > 0 {
            return Err(AppError::Validation(
                "No se puede desvincular u olvidar la caja mientras exista un turno activo. Realiza el arqueo primero.".into(),
            ));
        }
    }

    let conn = db.conn()?;
    set_setting(&conn, "last_caja_id", "")?;
    set_setting(&conn, "last_caja_codigo", "")?;
    set_setting(&conn, "last_caja_nombre", "")?;
    set_setting(&conn, "last_empresa_nombre", "")?;
    set_setting(&conn, "last_empresa_id", "")?;
    set_setting(&conn, "last_bodega_id", "")?;
    set_setting(&conn, "last_bodega_nombre", "")?;
    set_setting(&conn, "last_erp_url", "")?;
    set_setting(&conn, "is_disconnected", "0")?;
    set_setting(&conn, "pairing_status", "unpaired")?;
    set_setting(&conn, "terminal_token", "")?;
    set_setting(&conn, "caja_id", "")?;
    set_setting(&conn, "caja_nombre", "")?;
    set_setting(&conn, "caja_codigo", "")?;
    Ok(fetch_status_sync(&conn))
}

/// ⚡ Reconecta una terminal POS previamente vinculada o desconectada.
#[tauri::command]
pub async fn reconnect_terminal(
    db: State<'_, Db>,
    input: ReconnectTerminalInput,
) -> AppResult<TerminalStatus> {
    let (clean_url, caja_id, caja_codigo, empresa_id) = {
        let conn = db.conn()?;
        let raw_url = input
            .erp_url
            .filter(|s| !s.trim().is_empty())
            .or_else(|| get_setting(&conn, "last_erp_url"))
            .or_else(|| get_setting(&conn, "erp_url"))
            .unwrap_or_else(|| "http://localhost:3000".to_string());
        let url = sanitize_erp_url(&raw_url);

        let cid = input
            .caja_id
            .filter(|s| !s.trim().is_empty())
            .or_else(|| get_setting(&conn, "last_caja_id"))
            .or_else(|| get_setting(&conn, "caja_id"));

        let ccod = input
            .caja_codigo
            .filter(|s| !s.trim().is_empty())
            .or_else(|| get_setting(&conn, "last_caja_codigo"))
            .or_else(|| get_setting(&conn, "caja_codigo"));

        let eid = get_setting(&conn, "last_empresa_id").or_else(|| get_setting(&conn, "empresa_id"));

        (url, cid, ccod, eid)
    };

    if caja_id.is_none() && caja_codigo.is_none() {
        return Err(AppError::Auth("No se encontró información de la caja anterior para reconectar. Por favor realiza una vinculación normal.".into()));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let url = format!("{}/api/pos/v1/terminal/reconectar", clean_url);

    let mut payload = serde_json::json!({});
    if let Some(ref cid) = caja_id {
        payload["cajaId"] = serde_json::json!(cid);
    }
    if let Some(ref ccod) = caja_codigo {
        payload["cajaCodigo"] = serde_json::json!(ccod);
    }
    if let Some(ref eid) = empresa_id {
        payload["empresaId"] = serde_json::json!(eid);
    }
    if let Some(ref pin) = input.pin {
        payload["pin"] = serde_json::json!(pin.trim());
    }
    if let Some(ref em) = input.email {
        payload["email"] = serde_json::json!(em.trim());
    }
    if let Some(ref pw) = input.password {
        payload["password"] = serde_json::json!(pw);
    }

    let res = client.post(&url).json(&payload).send().await?;

    if !res.status().is_success() {
        let err_json: Value = res.json().await.unwrap_or_default();
        let msg = err_json["message"]
            .as_str()
            .unwrap_or("No se pudo reconectar la terminal con el ERP");
        return Err(AppError::Auth(msg.to_string()));
    }

    let json: Value = res.json().await?;
    let data = &json["data"];

    let token = data["terminalToken"].as_str().ok_or_else(|| {
        AppError::Auth("No se recibió token de terminal en la respuesta de reconexión".into())
    })?;
    let new_caja_id = data["caja"]["id"].as_str().unwrap_or_default();
    let new_caja_nombre = data["caja"]["nombre"].as_str().unwrap_or_default();
    let new_caja_codigo = data["caja"]["codigo"].as_str().unwrap_or_default();
    let new_empresa_id = data["empresa"]["id"].as_str().unwrap_or_default();
    let new_empresa_nombre = data["empresa"]["nombre"].as_str().unwrap_or_default();
    let new_empresa_nit = data["empresa"]["nit"].as_str().unwrap_or_default();
    let new_bodega_id = data["caja"]["bodegaId"].as_str().or_else(|| data["caja"]["bodega"]["id"].as_str()).unwrap_or_default();
    let new_bodega_nombre = data["caja"]["bodega"]["nombre"].as_str().unwrap_or_default();

    {
        let conn = db.conn()?;
        set_setting(&conn, "erp_url", &clean_url)?;
        set_setting(&conn, "terminal_token", token)?;
        set_setting(&conn, "caja_id", new_caja_id)?;
        set_setting(&conn, "caja_nombre", new_caja_nombre)?;
        set_setting(&conn, "caja_codigo", new_caja_codigo)?;
        set_setting(&conn, "empresa_id", new_empresa_id)?;
        set_setting(&conn, "empresa_nombre", new_empresa_nombre)?;
        set_setting(&conn, "empresa_nit", new_empresa_nit)?;
        if !new_bodega_id.is_empty() {
            set_setting(&conn, "bodega_id", new_bodega_id)?;
        }
        if !new_bodega_nombre.is_empty() {
            set_setting(&conn, "bodega_nombre", new_bodega_nombre)?;
        }
        set_setting(&conn, "pairing_status", "linked")?;
        set_setting(&conn, "is_disconnected", "0")?;
    }

    // Refrescar usuarios desde el ERP
    if let Ok(users_json) = http_fetch_users(&clean_url, token).await {
        let conn = db.conn()?;
        let _ = save_synced_users(&conn, &users_json);
    }

    let conn = db.conn()?;
    Ok(fetch_status_sync(&conn))
}

/// Pone la terminal en modo desconectado / fuera de línea sin borrar credenciales
/// para permitir reconexión inmediata en 1 clic.
#[tauri::command]
pub async fn disconnect_terminal_temporarily(db: State<'_, Db>) -> AppResult<TerminalStatus> {
    {
        let conn = db.conn()?;
        let existe_abierto: i64 = conn.query_row(
            "SELECT COUNT(*) FROM cash_sessions WHERE status = 'open'",
            [],
            |r| r.get(0),
        )?;
        if existe_abierto > 0 {
            return Err(AppError::Validation(
                "No se puede desconectar la caja mientras exista un turno activo. Realiza el arqueo y cierre de caja primero.".into(),
            ));
        }
    }

    let (erp_url, token) = {
        let conn = db.conn()?;
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_default();
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if !erp_url.is_empty() && !token.is_empty() {
        if let Ok(client) = reqwest::Client::builder().timeout(Duration::from_millis(1500)).build() {
            let url = format!("{}/api/pos/v1/terminal/estado", erp_url.trim_end_matches('/'));
            let _ = client
                .post(&url)
                .header("Authorization", format!("Bearer {token}"))
                .json(&serde_json::json!({ "accion": "DESCONECTAR_SESION" }))
                .send()
                .await;
        }
    }

    let conn = db.conn()?;
    if let Some(cid) = get_setting(&conn, "caja_id") {
        set_setting(&conn, "last_caja_id", &cid)?;
    }
    if let Some(ccod) = get_setting(&conn, "caja_codigo") {
        set_setting(&conn, "last_caja_codigo", &ccod)?;
    }
    if let Some(cnom) = get_setting(&conn, "caja_nombre") {
        set_setting(&conn, "last_caja_nombre", &cnom)?;
    }
    if let Some(enom) = get_setting(&conn, "empresa_nombre") {
        set_setting(&conn, "last_empresa_nombre", &enom)?;
    }
    set_setting(&conn, "is_disconnected", "1")?;
    set_setting(&conn, "pairing_status", "unpaired")?;

    Ok(fetch_status_sync(&conn))
}

/// Envía una señal rápida al ERP cuando la ventana del POS se cierra para marcar la caja como desconectada.
pub async fn notify_terminal_shutdown(db: &Db) {
    let (erp_url, token) = {
        let Ok(conn) = db.conn() else { return };
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_default();
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (erp_url, token)
    };

    if !erp_url.is_empty() && !token.is_empty() {
        if let Ok(client) = reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
        {
            let url = format!("{}/api/pos/v1/terminal/estado", erp_url.trim_end_matches('/'));
            let _ = client
                .post(&url)
                .header("Authorization", format!("Bearer {token}"))
                .json(&serde_json::json!({ "accion": "DESCONECTAR_SESION" }))
                .send()
                .await;
        }
    }
}

/// Valida periódicamente con el ERP si la caja sigue activa.
/// Si la caja fue eliminada o revocada en el ERP (401, 403, 404),
/// la terminal se auto-desvincula localmente de inmediato para prevenir uso indebido.
#[tauri::command]
pub async fn validate_terminal_session(
    db: State<'_, Db>,
    active_erp_user_id: Option<String>,
) -> AppResult<TerminalStatus> {
    let (erp_url, token, is_paired) = {
        let conn = db.conn()?;
        let status = fetch_status_sync(&conn);
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        (status.erp_url, token, status.is_paired)
    };

    if !is_paired || token.is_empty() {
        let conn = db.conn()?;
        return Ok(fetch_status_sync(&conn));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;

    let url = format!("{}/api/pos/v1/terminal/estado", erp_url.trim_end_matches('/'));
    let res_opt = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await;

    match res_opt {
        Ok(res) => {
            let status_code = res.status();
            // 401 (no autorizada/revocada), 403, 404 (caja eliminada)
            if status_code == reqwest::StatusCode::UNAUTHORIZED
                || status_code == reqwest::StatusCode::FORBIDDEN
                || status_code == reqwest::StatusCode::NOT_FOUND
            {
                let conn = db.conn()?;
                internal_unpair(&conn)?;
                return Ok(fetch_status_sync(&conn));
            }

            if status_code.is_success() {
                if let Ok(json) = res.json::<Value>().await {
                    let is_active = json["data"]["activo"].as_bool().unwrap_or(true);
                    let caja_estado = json["data"]["caja"]["estado"].as_str().unwrap_or("ACTIVA");
                    if !is_active || caja_estado != "ACTIVA" {
                        let conn = db.conn()?;
                        internal_unpair(&conn)?;
                        return Ok(fetch_status_sync(&conn));
                    }
                }
            }
        }
        Err(e) => {
            // Falla de red transitoria: NO desvincular para mantener la política Offline-First
            // pero logueamos advertencia.
            eprintln!("[WARN POS] Error temporal al contactar ERP: {e}");
        }
    }

    // Si hay un cajero activo en pantalla, auditar su vigencia en tiempo real
    let mut cashier_revoked = false;
    if let Some(ref erp_id) = active_erp_user_id {
        if !erp_id.is_empty() {
            if let Ok(verify_res) = http_verify_user(&erp_url, &token, erp_id).await {
                let autorizado = verify_res["data"]["autorizado"].as_bool().unwrap_or(false);
                if !autorizado {
                    cashier_revoked = true;
                    let conn = db.conn()?;
                    let _ = conn.execute(
                        "UPDATE users SET active = 0, erp_role_code = 'CLIENTE' WHERE erp_user_id = ?1",
                        params![erp_id],
                    );
                }
            }
        }
    }

    let conn = db.conn()?;
    let mut status = fetch_status_sync(&conn);
    status.active_cashier_revoked = Some(cashier_revoked);
    Ok(status)
}

/// Cambia el PIN de seguridad de un usuario, validando el PIN anterior
/// y sincronizando el nuevo hash con SQLite local y el ERP central (Offline-First con Outbox).
#[tauri::command]
pub async fn change_cashier_pin(
    db: State<'_, Db>,
    user_id: i64,
    current_pin: String,
    new_pin: String,
) -> AppResult<bool> {
    let clean_current = current_pin.trim();
    let clean_new = new_pin.trim();

    if !clean_new.chars().all(|c| c.is_ascii_digit()) || clean_new.len() < 4 || clean_new.len() > 6 {
        return Err(AppError::Auth("El nuevo PIN debe tener entre 4 y 6 dígitos numéricos".into()));
    }

    if clean_current == clean_new {
        return Err(AppError::Auth("El nuevo PIN no puede ser idéntico al PIN actual".into()));
    }

    // 1. Obtener datos locales del usuario
    let (erp_user_id, pin_hash_opt, erp_url_opt, token_opt) = {
        let conn = db.conn()?;
        let mut stmt = conn.prepare(
            "SELECT erp_user_id, pin_hash, full_name FROM users WHERE id = ?1 AND active = 1"
        )?;
        let row = stmt.query_row(params![user_id], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, Option<String>>(1)?,
            ))
        }).map_err(|_| AppError::Auth("Usuario no encontrado o inactivo".into()))?;

        let erp_url = get_setting(&conn, "erp_url");
        let token = get_setting(&conn, "terminal_token");
        (row.0, row.1, erp_url, token)
    };

    // 2. Validar PIN actual con bcrypt
    if let Some(ref pin_hash) = pin_hash_opt {
        if !bcrypt::verify(clean_current, pin_hash).unwrap_or(false) {
            return Err(AppError::Auth("El PIN actual ingresado es incorrecto".into()));
        }
    } else {
        return Err(AppError::Auth("El usuario no tiene un PIN previo configurado para validar".into()));
    }

    // 3. Generar nuevo hash bcrypt
    let new_hash = bcrypt::hash(clean_new, bcrypt::DEFAULT_COST)
        .map_err(|e| AppError::Auth(format!("Error al cifrar nuevo PIN: {e}")))?;

    // 4. Actualizar SQLite local y encolar en Outbox
    {
        let conn = db.conn()?;
        conn.execute(
            "UPDATE users SET pin_hash = ?1, failed_pin_attempts = 0, locked_until = NULL WHERE id = ?2",
            params![new_hash, user_id],
        )?;

        if let Some(ref erp_uid) = erp_user_id {
            let payload = serde_json::json!({
                "erpUserId": erp_uid,
                "pin": clean_new,
                "pinHash": new_hash,
                "userId": user_id,
            });
            conn.execute(
                "INSERT INTO sync_queue (entity_type, entity_id, payload, status) VALUES ('user_pin', ?1, ?2, 'pending')",
                params![user_id, payload.to_string()],
            )?;
        }
    }

    // 5. Intentar despacho HTTP inmediato al ERP si hay red
    if let (Some(ref erp_uid), Some(ref erp_url), Some(ref token)) = (erp_user_id.as_ref(), erp_url_opt.as_ref(), token_opt.as_ref()) {
        if !erp_url.is_empty() && !token.is_empty() {
            if let Ok(client) = reqwest::Client::builder().timeout(Duration::from_millis(3000)).build() {
                let url = format!("{}/api/pos/v1/terminal/usuarios/cambiar-pin", erp_url.trim_end_matches('/'));
                if let Ok(res) = client
                    .post(&url)
                    .header("Authorization", format!("Bearer {token}"))
                    .json(&serde_json::json!({
                        "erpUserId": erp_uid,
                        "pin": clean_new,
                    }))
                    .send()
                    .await
                {
                    if res.status().is_success() {
                        let conn = db.conn()?;
                        let _ = conn.execute(
                            "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now') WHERE entity_type = 'user_pin' AND entity_id = ?1 AND status = 'pending'",
                            params![user_id],
                        );
                    }
                }
            }
        }
    }

    Ok(true)
}


