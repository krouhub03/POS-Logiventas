use tauri::State;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct PlanInfo {
    pub plan_type: String,          // "free" | "pro" | "enterprise"
    pub plan_expiration: Option<String>, // ISO‑8601 date string
    pub plan_code: Option<String>,   // legacy code (e.g., "POS_FREE")
    pub version: String,
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

fn set_setting(conn: &rusqlite::Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// Obtiene la información de licencia/plan almacenada en `settings`.
#[tauri::command]
pub fn get_plan_info(db: State<'_, Db>) -> AppResult<PlanInfo> {
    let conn = db.conn()?;
    let plan_type = get_setting(&conn, "plan_type").unwrap_or_else(|| "free".to_string());
    let plan_expiration = get_setting(&conn, "plan_expiration");
    let plan_code = get_setting(&conn, "plan_codigo");
    let version = env!("CARGO_PKG_VERSION").to_string();

    Ok(PlanInfo {
        plan_type,
        plan_expiration,
        plan_code,
        version,
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

    // Si la llamada remota responde
    if let Ok(resp) = remote_res {
        let status = resp.status();
        if status.is_success() {
            // Actualizar configuraciones con lo retornado por el ERP si viene el plan
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                if let Some(plan_obj) = body.get("data").and_then(|d| d.get("plan")) {
                    if let Ok(conn) = db.conn() {
                        if let Some(tipo) = plan_obj.get("tipo").and_then(|t| t.as_str()) {
                            let _ = set_setting(&conn, "plan_type", tipo);
                        }
                        if let Some(codigo) = plan_obj.get("codigo").and_then(|c| c.as_str()) {
                            let _ = set_setting(&conn, "plan_codigo", codigo);
                        }
                        if let Some(exp) = plan_obj.get("expiracion").and_then(|e| e.as_str()) {
                            let _ = set_setting(&conn, "plan_expiration", exp);
                        }
                    }
                }
            }
            return Ok(true);
        }

        // Si responde 401 o 403 explícito, la terminal o la licencia fueron suspendidas/revocadas
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Ok(false);
        }
    }

    // ---- Fallback offline ------------------------------------------------
    // Si la red no está disponible o el ERP da error 5xx, aplicamos política Offline-First:
    // El plan "free" es perpetuo a menos que tenga una fecha de expiración explícita configurada.
    if let Some(exp_str) = plan_expiration {
        if !exp_str.is_empty() {
            let conn = db.conn()?;
            let is_valid: bool = conn.query_row(
                "SELECT datetime(?1) > datetime('now')",
                rusqlite::params![exp_str],
                |r| r.get(0),
            ).unwrap_or(false);

            return Ok(is_valid);
        }
    }

    // Si es plan free sin fecha de caducidad o planes pro/enterprise en offline:
    // Permitir operar localmente bajo el principio Offline-First
    let _ = plan_type;
    Ok(true)
}
