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
            commands::system::toggle_fullscreen,
            commands::system::set_fullscreen,
            commands::products::list_products,
            commands::products::find_product_by_barcode,
            commands::products::create_product,
            commands::auth::get_terminal_status,
            commands::auth::pair_terminal_code,
            commands::auth::pair_terminal_login,
            commands::auth::sync_users_from_erp,
            commands::auth::list_local_cashiers,
            commands::auth::login_cashier_pin,
            commands::auth::unpair_terminal,
            commands::sales::create_sale,
            commands::sales::get_last_sale,
            commands::sales::get_today_summary,
            commands::settings::get_all_settings,
            commands::settings::update_settings,
            commands::settings::test_print_ticket,
            commands::settings::test_open_drawer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
