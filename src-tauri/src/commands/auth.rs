use rusqlite::params;
use serde_json::Value;
use std::time::Duration;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::auth::{
    CashierUser, ErpCajaOption, PairCodeInput, PairLoginInput, PairLoginResult, TerminalStatus,
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

    TerminalStatus {
        is_paired,
        erp_url,
        caja_id: get_setting(conn, "caja_id"),
        caja_nombre: get_setting(conn, "caja_nombre"),
        caja_codigo: get_setting(conn, "caja_codigo"),
        empresa_id: get_setting(conn, "empresa_id"),
        empresa_nombre: get_setting(conn, "empresa_nombre"),
        empresa_nit: get_setting(conn, "empresa_nit"),
        active_cashier: None,
    }
}

// ─────────────────────────────────────────────────────────────
// HTTP Helpers (Async - Sin referencias a rusqlite::Connection)
// ─────────────────────────────────────────────────────────────

fn internal_unpair(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    set_setting(conn, "pairing_status", "unpaired")?;
    set_setting(conn, "terminal_token", "")?;
    set_setting(conn, "caja_id", "")?;
    set_setting(conn, "caja_nombre", "")?;
    set_setting(conn, "caja_codigo", "")?;
    Ok(())
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

    for u in users_array {
        let erp_user_id = u["erpUserId"].as_str().unwrap_or_default();
        let email = u["email"].as_str().unwrap_or_default();
        let nombre = u["nombre"].as_str().unwrap_or_default();
        let rol = u["rol"].as_str().unwrap_or("cashier");
        let pin_hash = u["pinHash"].as_str();

        let role_mapped = match rol {
            "SUPERADMINSAAS" | "ADMIN_EMPRESA" => "admin",
            "STAFF" => "manager",
            _ => "cashier",
        };

        conn.execute(
            "INSERT INTO users (erp_user_id, username, email, full_name, pin_hash, role, active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
             ON CONFLICT(erp_user_id) DO UPDATE SET
                username = excluded.username,
                email = excluded.email,
                full_name = excluded.full_name,
                pin_hash = COALESCE(excluded.pin_hash, users.pin_hash),
                role = excluded.role,
                active = 1",
            params![erp_user_id, email, email, nombre, pin_hash, role_mapped],
        )?;

        let id = conn.query_row(
            "SELECT id FROM users WHERE erp_user_id = ?1",
            params![erp_user_id],
            |r| r.get::<_, i64>(0),
        )?;

        result.push(CashierUser {
            id,
            erp_user_id: Some(erp_user_id.to_string()),
            username: email.to_string(),
            full_name: nombre.to_string(),
            email: Some(email.to_string()),
            role: role_mapped.to_string(),
            active: true,
        });
    }

    Ok(result)
}

// ─────────────────────────────────────────────────────────────
// Comandos #[tauri::command]
// ─────────────────────────────────────────────────────────────

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
    let clean_url = input.erp_url.trim().trim_end_matches('/').to_string();
    let url = format!("{}/api/pos/v1/terminal/vincular", clean_url);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    let res = client
        .post(&url)
        .json(&serde_json::json!({
            "codigoVinculacion": input.code.trim().to_uppercase()
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

    // Guardar configuración en SQLite
    {
        let conn = db.conn()?;
        set_setting(&conn, "erp_url", &clean_url)?;
        set_setting(&conn, "terminal_token", token)?;
        set_setting(&conn, "caja_id", caja_id)?;
        set_setting(&conn, "caja_nombre", caja_nombre)?;
        set_setting(&conn, "caja_codigo", caja_codigo)?;
        set_setting(&conn, "empresa_id", empresa_id)?;
        set_setting(&conn, "empresa_nombre", empresa_nombre)?;
        set_setting(&conn, "empresa_nit", empresa_nit)?;
        set_setting(&conn, "pairing_status", "linked")?;
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
    let clean_url = input.erp_url.trim().trim_end_matches('/').to_string();
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

    {
        let conn = db.conn()?;
        set_setting(&conn, "erp_url", &clean_url)?;
        set_setting(&conn, "terminal_token", token)?;
        set_setting(&conn, "caja_id", caja_id)?;
        set_setting(&conn, "caja_nombre", caja_nombre)?;
        set_setting(&conn, "caja_codigo", caja_codigo)?;
        set_setting(&conn, "empresa_id", empresa_id)?;
        set_setting(&conn, "empresa_nombre", empresa_nombre)?;
        set_setting(&conn, "empresa_nit", empresa_nit)?;
        set_setting(&conn, "pairing_status", "linked")?;
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
    let mut stmt = conn.prepare(
        "SELECT id, erp_user_id, username, full_name, email, role, active
         FROM users WHERE active = 1 ORDER BY full_name",
    )?;

    let rows = stmt.query_map([], |r| {
        Ok(CashierUser {
            id: r.get(0)?,
            erp_user_id: r.get(1)?,
            username: r.get(2)?,
            full_name: r.get(3)?,
            email: r.get(4)?,
            role: r.get(5)?,
            active: r.get::<_, i64>(6)? == 1,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn login_cashier_pin(db: State<'_, Db>, pin: String) -> AppResult<CashierUser> {
    let trimmed_pin = pin.trim();
    if !trimmed_pin.chars().all(|c| c.is_ascii_digit()) || trimmed_pin.len() < 4 || trimmed_pin.len() > 6 {
        return Err(AppError::Auth("El PIN debe tener entre 4 y 6 dígitos numéricos".into()));
    }

    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, erp_user_id, username, full_name, email, role, active, pin_hash
         FROM users WHERE active = 1 AND pin_hash IS NOT NULL",
    )?;

    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let pin_hash: String = r.get(7)?;
        if bcrypt::verify(trimmed_pin, &pin_hash).unwrap_or(false) {
            return Ok(CashierUser {
                id: r.get(0)?,
                erp_user_id: r.get(1)?,
                username: r.get(2)?,
                full_name: r.get(3)?,
                email: r.get(4)?,
                role: r.get(5)?,
                active: r.get::<_, i64>(6)? == 1,
            });
        }
    }

    Err(AppError::Auth("PIN incorrecto o usuario no autorizado".into()))
}

#[tauri::command]
pub fn unpair_terminal(db: State<'_, Db>) -> AppResult<TerminalStatus> {
    let conn = db.conn()?;
    internal_unpair(&conn)?;
    Ok(fetch_status_sync(&conn))
}

/// Valida periódicamente con el ERP si la caja sigue activa.
/// Si la caja fue eliminada o revocada en el ERP (401, 403, 404),
/// la terminal se auto-desvincula localmente de inmediato para prevenir uso indebido.
#[tauri::command]
pub async fn validate_terminal_session(db: State<'_, Db>) -> AppResult<TerminalStatus> {
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

    let conn = db.conn()?;
    Ok(fetch_status_sync(&conn))
}

