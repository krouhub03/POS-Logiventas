use tauri::State;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::auth::TerminalStatus;
use serde::{Serialize, Deserialize};
use rusqlite::params;

#[derive(Serialize, Deserialize, Debug)]
pub struct PlanInfo {
    pub plan_type: String,          // "free" | "pro" | "enterprise"
    pub plan_expiration: Option<String>, // ISO‑8601 date string
    pub plan_code: Option<String>,   // legacy code (e.g., "POS_FREE")
}

/// Obtiene la información de licencia/plan almacenada en `settings`.
#[tauri::command]
pub fn get_plan_info(db: State<'_, Db>) -> AppResult<PlanInfo> {
    let conn = db.conn()?;
    let plan_type = crate::commands::auth::get_setting(&conn, "plan_type")
        .unwrap_or_else(|| "free".to_string());
    let plan_expiration = crate::commands::auth::get_setting(&conn, "plan_expiration");
    let plan_code = crate::commands::auth::get_setting(&conn, "plan_codigo");
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
    let conn = db.conn()?;
    let token = crate::commands::auth::get_setting(&conn, "terminal_token").unwrap_or_default();
    // Si la terminal no está vinculada, siempre se considera válida (modo offline‑first)
    if token.is_empty() {
        return Ok(true);
    }
    let erp_url = crate::commands::auth::get_setting(&conn, "erp_url")
        .unwrap_or_else(|| "http://localhost:3000".to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;
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
    // Obtener información local del plan
    let plan_type = crate::commands::auth::get_setting(&conn, "plan_type")
        .unwrap_or_else(|| "free".to_string());
    let plan_expiration = crate::commands::auth::get_setting(&conn, "plan_expiration");
    // Si el plan no es "free", se asume que es una suscripción válida
    if plan_type != "free" {
        return Ok(true);
    }
    // Para plan "free" verificamos si tiene fecha de expiración y si está vencida
    if let Some(exp_str) = plan_expiration {
        // Intentar parsear ISO‑8601; si falla, consideramos inválida
        if let Ok(exp_dt) = chrono::DateTime::parse_from_rfc3339(&exp_str) {
            let now = chrono::Utc::now();
            if exp_dt.with_timezone(&chrono::Utc) > now {
                return Ok(true);
            }
        }
    }
    // En cualquier otro caso, la licencia se considera inválida
    Ok(false)
}
    let conn = db.conn()?;
    let token = crate::commands::auth::get_setting(&conn, "terminal_token").unwrap_or_default();
    if token.is_empty() {
        // No está vinculada: se considera válida en modo offline‑first.
        return Ok(true);
    }
    let erp_url = crate::commands::auth::get_setting(&conn, "erp_url")
        .unwrap_or_else(|| "http://localhost:3000".to_string());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let url = format!("{}/api/pos/v1/license/validate", erp_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    if resp.status().is_success() {
        Ok(true)
    } else {
        // Si el ERP responde 403 o 401 significa que la licencia está revocada.
        Ok(false)
    }
}
