use serde::Serialize;
use tauri::State;

use crate::db::Db;
use crate::error::AppResult;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub db_path: String,
    pub schema_version: i64,
}

/// Información básica de la app; útil como "health check" desde el frontend.
#[tauri::command]
pub fn app_info(app: tauri::AppHandle, db: State<'_, Db>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        db_path: db.path().display().to_string(),
        schema_version: db.schema_version()?,
    })
}
