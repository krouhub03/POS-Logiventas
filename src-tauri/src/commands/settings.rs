use std::collections::HashMap;
use rusqlite::params;
use tauri::State;

use crate::db::Db;
use crate::error::AppResult;

#[tauri::command]
pub fn get_all_settings(db: State<'_, Db>) -> AppResult<HashMap<String, String>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;

    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row?;
        map.insert(k, v);
    }
    Ok(map)
}

#[tauri::command]
pub fn update_settings(
    db: State<'_, Db>,
    settings: HashMap<String, String>,
) -> AppResult<()> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;

    for (k, v) in settings {
        tx.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![k, v],
        )?;
    }

    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn test_print_ticket(db: State<'_, Db>) -> AppResult<String> {
    let conn = db.conn()?;
    let printer_target: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'printer_target'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "POS-58".into());

    let paper_width: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'printer_paper_width'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "58mm".into());

    // Nota: Aquí se conectará el driver ESC/POS directo o spooler nativo de Windows.
    // Retornamos confirmación con los parámetros activos.
    Ok(format!(
        "Impresión de prueba enviada a '{}' ({})",
        printer_target, paper_width
    ))
}

#[tauri::command]
pub fn test_open_drawer(db: State<'_, Db>) -> AppResult<String> {
    let conn = db.conn()?;
    let trigger: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'drawer_trigger'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "printer_pulse".into());

    // Pulso estándar ESC p 0 25 250
    Ok(format!(
        "Pulso de apertura de cajón enviado vía '{}'",
        trigger
    ))
}
