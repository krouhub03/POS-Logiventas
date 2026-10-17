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
