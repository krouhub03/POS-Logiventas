mod commands;
mod db;
mod error;
mod models;

use tauri::Manager;

use crate::db::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Metahabi POS");
            }
            let db_path = app.path().app_data_dir()?.join("logiventa.db");
            let db = Db::open(&db_path)?;
            app.manage(db.clone());
            // 🚀 Iniciar Daemon de Sincronización Automática Continua en segundo plano
            commands::sync::start_sync_daemon(app.handle().clone(), db);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(db) = window.try_state::<Db>() {
                    let db_clone = db.inner().clone();
                    tauri::async_runtime::block_on(async move {
                        commands::auth::notify_terminal_shutdown(&db_clone).await;
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::system::toggle_fullscreen,
            commands::system::set_fullscreen,
            commands::system::minimize_window,
            commands::system::restart_app,
            commands::products::list_products,
            commands::products::find_product_by_barcode,
            commands::products::get_product,
            commands::products::create_product,
            commands::products::update_product,
            commands::products::delete_product,
            commands::products::adjust_stock,
            commands::products::list_inventory_movements,
            commands::products::list_product_tags,
            commands::products::create_product_tag,
            commands::products::update_product_tag,
            commands::products::delete_product_tag,
            commands::products::list_categories,
            commands::products::get_product_components,
            commands::products::save_product_components,
            commands::auth::get_terminal_status,
            commands::auth::validate_terminal_session,
            commands::auth::pair_terminal_code,
            commands::auth::pair_terminal_login,
            commands::auth::sync_users_from_erp,
            commands::auth::list_local_cashiers,
            commands::auth::login_cashier_pin,
            commands::auth::login_cashier_user_pin,
            commands::auth::change_cashier_pin,
            commands::auth::unpair_terminal,
            commands::auth::reconnect_terminal,
            commands::auth::disconnect_terminal_temporarily,
            commands::sales::create_sale,
            commands::sales::get_last_sale,
            commands::sales::get_today_summary,
            commands::sales::list_recent_sales,
            commands::sales::get_sale_detail,
            commands::sales::register_sale_reprint,
            commands::sales::create_sale_return,
            commands::settings::get_all_settings,
            commands::settings::update_settings,
            commands::printers::list_system_printers,
            commands::printers::test_print_ticket,
            commands::printers::test_open_drawer,
            commands::sync::verify_and_reserve_stock,
            commands::sync::release_stock_reservation,
            commands::sync::sync_catalog_from_erp,
            commands::sync::dispatch_sync_outbox,
            commands::sync::pull_inventory_deltas,
            commands::sync::get_sync_status,
            commands::sync::sync_payment_methods,
            commands::sync::get_payment_methods,
            commands::sync::toggle_payment_method_terminal_status,
            commands::shifts::get_active_shift,
            commands::shifts::open_shift,
            commands::shifts::get_shift_summary,
            commands::shifts::close_shift,
            commands::customers::get_customers,
            commands::customers::get_customer,
            commands::customers::search_customers,
            commands::customers::create_customer,
            commands::customers::update_customer_credit,
            commands::customers::record_customer_payment,
            commands::customers::get_customer_payments,
            commands::images::save_product_image_local,
            commands::images::delete_product_image_local,
            commands::images::get_product_image_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
