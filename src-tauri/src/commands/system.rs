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

/// Alternar modo pantalla completa (cubre la barra de tareas de Windows).
#[tauri::command]
pub fn toggle_fullscreen(window: tauri::Window) -> AppResult<bool> {
    let is_fs = window.is_fullscreen()?;
    let next_state = !is_fs;
    window.set_fullscreen(next_state)?;
    Ok(next_state)
}

/// Establecer explícitamente modo pantalla completa.
#[tauri::command]
pub fn set_fullscreen(window: tauri::Window, fullscreen: bool) -> AppResult<()> {
    window.set_fullscreen(fullscreen)?;
    Ok(())
}

/// Minimizar la ventana principal (necesario porque en pantalla completa no hay barra de título).
#[tauri::command]
pub fn minimize_window(window: tauri::Window) -> AppResult<()> {
    window.minimize()?;
    Ok(())
}

/// Reiniciar la aplicación (útil tras instalar actualizaciones).
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Cerrar la aplicación de escritorio de forma ordenada.
/// Valida si existe un turno de caja abierto para forzar arqueo contable a menos que force sea true.
#[tauri::command]
pub fn close_app(app: tauri::AppHandle, db: State<'_, Db>, force: Option<bool>) -> AppResult<()> {
    if force != Some(true) {
        let conn = db.conn()?;
        let existe_abierto: i64 = conn.query_row(
            "SELECT COUNT(*) FROM cash_sessions WHERE status = 'open'",
            [],
            |r| r.get(0),
        )?;
        if existe_abierto > 0 {
            return Err(crate::error::AppError::Validation(
                "Existe un turno de caja activo en esta terminal. Realiza el arqueo y cierre antes de apagar la estación.".into(),
            ));
        }
    }
    app.exit(0);
    Ok(())
}


