use tauri::State;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct PlanInfo {
    pub plan_type: String,          // "free" | "pro" | "enterprise"
    pub plan_expiration: Option<String>, // ISO‑8601 date string
    pub plan_code: Option<String>,   // legacy code (e.g., "POS_FREE")
}

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .filter(|s| !s.is_empty())
}

/// Obtiene la información de licencia/plan almacenada en `settings`.
#[tauri::command]
pub fn get_plan_info(db: State<'_, Db>) -> AppResult<PlanInfo> {
    let conn = db.conn()?;
    let plan_type = get_setting(&conn, "plan_type").unwrap_or_else(|| "free".to_string());
    let plan_expiration = get_setting(&conn, "plan_expiration");
    let plan_code = get_setting(&conn, "plan_codigo");
    Ok(PlanInfo {
        plan_type,
        plan_expiration,
        plan_code,
    })
}

/// Valida que el token de la terminal siga activo y que el plan permita la operación.
/// Devuelve `true` si la licencia es válida; `false` si está revocada o caducada.
#[tauri::command]
pub async fn validate_license(db: State<'_, Db>) -> AppResult<bool> {
    // 1. Extraer configuraciones necesarias liberando el MutexGuard antes del await
    let (token, erp_url, plan_type, plan_expiration) = {
        let conn = db.conn()?;
        let token = get_setting(&conn, "terminal_token").unwrap_or_default();
        let erp_url = get_setting(&conn, "erp_url").unwrap_or_else(|| "http://localhost:3000".to_string());
        let plan_type = get_setting(&conn, "plan_type").unwrap_or_else(|| "free".to_string());
        let plan_expiration = get_setting(&conn, "plan_expiration");
        (token, erp_url, plan_type, plan_expiration)
    };

    // Si la terminal no está vinculada, siempre se considera válida (modo offline‑first)
    if token.is_empty() {
        return Ok(true);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(AppError::Network)?;
    let url = format!("{}/api/pos/v1/license/validate", erp_url.trim_end_matches('/'));
    
    // Intentar validación remota
    let remote_res = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await;

    // Si la llamada remota funciona y devuelve 2xx, la licencia es válida
    if let Ok(resp) = remote_res {
        if resp.status().is_success() {
            return Ok(true);
        }
    }

    // ---- Fallback offline ------------------------------------------------
    // Si el plan no es "free", se asume que es una suscripción válida
    if plan_type != "free" {
        return Ok(true);
    }

    // Para plan "free" verificamos si tiene fecha de expiración mediante SQLite
    if let Some(exp_str) = plan_expiration {
        let conn = db.conn()?;
        let is_valid: bool = conn.query_row(
            "SELECT datetime(?1) > datetime('now')",
            rusqlite::params![exp_str],
            |r| r.get(0),
        ).unwrap_or(false);

        if is_valid {
            return Ok(true);
        }
    }

    // En cualquier otro caso o expirado, la licencia se considera inválida
    Ok(false)
}
