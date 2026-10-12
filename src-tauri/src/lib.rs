mod commands;
mod db;
mod error;
mod models;

use tauri::Manager;

use crate::db::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Updater: habilitar cuando existan `pubkey` y `endpoints` en tauri.conf.json
        // (ver README > "Actualizaciones automáticas").
        //    .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = app.path().app_data_dir()?.join("logiventa.db");
            let db = Db::open(&db_path)?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::products::list_products,
            commands::products::find_product_by_barcode,
            commands::products::create_product,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
