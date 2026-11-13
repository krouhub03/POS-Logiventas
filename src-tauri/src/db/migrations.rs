use rusqlite::Connection;

use crate::error::AppResult;

/// Migraciones en orden. El índice + 1 es la versión del esquema (`PRAGMA user_version`).
/// Para agregar una nueva: crear `migrations/000N_nombre.sql` y añadirla al final.
/// NUNCA modificar una migración ya publicada.
const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/0001_initial.sql"),
    include_str!("../../migrations/0002_terminal_settings.sql"),
    include_str!("../../migrations/0003_hardware_settings.sql"),
    include_str!("../../migrations/0004_product_services.sql"),
    include_str!("../../migrations/0005_sync_queue.sql"),
    include_str!("../../migrations/0006_product_erp_id.sql"),
    include_str!("../../migrations/0007_product_sync_flag.sql"),
    include_str!("../../migrations/0008_payment_methods.sql"),
    include_str!("../../migrations/0009_cash_shifts.sql"),
    include_str!("../../migrations/0010_dynamic_payments.sql"),
    include_str!("../../migrations/0011_user_permissions.sql"),
    include_str!("../../migrations/0012_pos_profiles_and_granular_rbac.sql"),
    include_str!("../../migrations/0013_clean_dummy_profiles.sql"),
    include_str!("../../migrations/0014_product_policies_and_tags.sql"),
    include_str!("../../migrations/0015_sale_items_historical_cost.sql"),
    include_str!("../../migrations/0016_product_tags.sql"),
    include_str!("../../migrations/0017_pin_rate_limiting.sql"),
    include_str!("../../migrations/0018_product_components.sql"),
    include_str!("../../migrations/0019_customer_credit_and_payments.sql"),
    include_str!("../../migrations/0020_sync_queue_customer_payments.sql"),
    include_str!("../../migrations/0021_product_images.sql"),
    include_str!("../../migrations/0022_strict_no_negative_stock.sql"),
    include_str!("../../migrations/0023_sale_returns_and_reprints.sql"),
    include_str!("../../migrations/0025_add_plan_settings.sql"),
    include_str!("../../migrations/0026_user_permission_audit.sql"),
    include_str!("../../migrations/0027_eleventa_fields.sql"),
    include_str!("../../migrations/0028_sales_paid_and_change_cents.sql"),
    include_str!("../../migrations/0029_fix_user_permission_audit_trigger.sql"),
    include_str!("../../migrations/0030_optimize_sync_and_inventory_indexes.sql"),
    include_str!("../../migrations/0031_enqueue_unlinked_products_for_erp_upload.sql"),
    include_str!("../../migrations/0032_sales_client_tx_id.sql"),
    include_str!("../../migrations/0033_permissive_offline_stock_policy.sql"),
    include_str!("../../migrations/0034_sales_analytics_indexes.sql"),
    include_str!("../../migrations/0035_customer_sales_indexes.sql"),
    include_str!("../../migrations/0036_warehouses_and_kardex_enhancement.sql"),
    include_str!("../../migrations/0037_kardex_pos_terminals_filter.sql"),
    include_str!("../../migrations/0038_sync_warehouse_code_conflict_fix.sql"),
];

fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    let mut stmt = match conn.prepare(&format!("PRAGMA table_info({})", table)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let rows = stmt.query_map([], |r| r.get::<_, String>(1));
    if let Ok(iter) = rows {
        for col in iter.flatten() {
            if col.eq_ignore_ascii_case(column) {
                return true;
            }
        }
    }
    false
}

fn ensure_critical_schema(conn: &Connection) -> AppResult<()> {
    if !column_exists(conn, "users", "last_modified_by") {
        let _ = conn.execute(
            "ALTER TABLE users ADD COLUMN last_modified_by TEXT DEFAULT 'system'",
            [],
        );
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS user_permission_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            old_permissions TEXT NOT NULL,
            new_permissions TEXT NOT NULL,
            changed_at TEXT NOT NULL DEFAULT (datetime('now')),
            changed_by TEXT NOT NULL
        );
        DROP TRIGGER IF EXISTS trg_user_permissions_audit;
        CREATE TRIGGER trg_user_permissions_audit
        AFTER UPDATE OF permissions ON users
        FOR EACH ROW
        WHEN OLD.permissions IS NOT NEW.permissions
        BEGIN
            INSERT INTO user_permission_audit (
                user_id, old_permissions, new_permissions, changed_by
            ) VALUES (
                OLD.id,
                COALESCE(OLD.permissions, '[]'),
                COALESCE(NEW.permissions, '[]'),
                COALESCE(NEW.last_modified_by, 'system')
            );
        END;",
    )?;

    if !column_exists(conn, "products", "wholesale_price_cents") {
        let _ = conn.execute(
            "ALTER TABLE products ADD COLUMN wholesale_price_cents INTEGER NOT NULL DEFAULT 0",
            [],
        );
    }
    if !column_exists(conn, "products", "max_stock") {
        let _ = conn.execute(
            "ALTER TABLE products ADD COLUMN max_stock REAL NOT NULL DEFAULT 0",
            [],
        );
    }
    if !column_exists(conn, "sales", "paid_cents") {
        let _ = conn.execute(
            "ALTER TABLE sales ADD COLUMN paid_cents INTEGER NOT NULL DEFAULT 0",
            [],
        );
    }
    if !column_exists(conn, "sales", "change_cents") {
        let _ = conn.execute(
            "ALTER TABLE sales ADD COLUMN change_cents INTEGER NOT NULL DEFAULT 0",
            [],
        );
    }

    if !column_exists(conn, "sales", "client_tx_id") {
        let _ = conn.execute("ALTER TABLE sales ADD COLUMN client_tx_id TEXT", []);
        let _ = conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_tx_id ON sales(client_tx_id) WHERE client_tx_id IS NOT NULL",
            [],
        );
    }

    // Saneamiento automático de registros en sync_queue estancados (>= 10 intentos)
    let _ = conn.execute(
        "UPDATE sync_queue SET status = 'failed' WHERE status = 'pending' AND attempts >= 10",
        [],
    );

    // Saneamiento y coherencia de configuración de apertura automática de cajón monedero
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('drawer_open_on_print', 'true')",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('drawer_open_on_sale', 'true')",
        [],
    );

    // Alinear política de stock crítico con arquitectura Offline-First para no bloquear venta de última unidad
    let _ = conn.execute(
        "UPDATE settings SET value = 'permissive' WHERE key = 'offline_stock_policy' AND value = 'strict'",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('offline_stock_policy', 'permissive')",
        [],
    );

    // Asegurar tabla warehouses y columnas de kardex enriquecidas
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS warehouses (
            id          TEXT PRIMARY KEY,
            code        TEXT NOT NULL UNIQUE,
            name        TEXT NOT NULL,
            is_default  INTEGER NOT NULL DEFAULT 0,
            active      INTEGER NOT NULL DEFAULT 1,
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    );
    let _ = conn.execute(
        "INSERT OR IGNORE INTO warehouses (id, code, name, is_default, active)
         VALUES ('bod-default', 'BOD-01', 'Bodega Principal', 1, 1)",
        [],
    );
    if !column_exists(conn, "inventory_movements", "warehouse_id") {
        let _ = conn.execute("ALTER TABLE inventory_movements ADD COLUMN warehouse_id TEXT REFERENCES warehouses(id)", []);
        let _ = conn.execute("UPDATE inventory_movements SET warehouse_id = 'bod-default' WHERE warehouse_id IS NULL", []);
    }
    if !column_exists(conn, "inventory_movements", "balance_before") {
        let _ = conn.execute("ALTER TABLE inventory_movements ADD COLUMN balance_before REAL DEFAULT 0", []);
    }
    if !column_exists(conn, "inventory_movements", "balance_after") {
        let _ = conn.execute("ALTER TABLE inventory_movements ADD COLUMN balance_after REAL DEFAULT 0", []);
    }
    if !column_exists(conn, "inventory_movements", "unit_cost_cents") {
        let _ = conn.execute("ALTER TABLE inventory_movements ADD COLUMN unit_cost_cents INTEGER DEFAULT 0", []);
    }
    if !column_exists(conn, "inventory_movements", "erp_movement_id") {
        let _ = conn.execute("ALTER TABLE inventory_movements ADD COLUMN erp_movement_id TEXT", []);
    }
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS pos_terminals (
            id            TEXT PRIMARY KEY,
            code          TEXT NOT NULL,
            name          TEXT NOT NULL,
            warehouse_id  TEXT,
            is_current    INTEGER NOT NULL DEFAULT 0,
            active        INTEGER NOT NULL DEFAULT 1,
            updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    );
    if !column_exists(conn, "inventory_movements", "caja_id") {
        let _ = conn.execute("ALTER TABLE inventory_movements ADD COLUMN caja_id TEXT", []);
    }
    if !column_exists(conn, "inventory_movements", "caja_code") {
        let _ = conn.execute("ALTER TABLE inventory_movements ADD COLUMN caja_code TEXT", []);
    }
    if !column_exists(conn, "inventory_movements", "caja_name") {
        let _ = conn.execute("ALTER TABLE inventory_movements ADD COLUMN caja_name TEXT", []);
    }

    Ok(())
}

pub fn run(conn: &mut Connection) -> AppResult<()> {
    let current: usize = conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))? as usize;

    for (idx, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let version = idx + 1;
        let tx = conn.transaction()?;
        if let Err(err) = tx.execute_batch(sql) {
            let msg = err.to_string().to_lowercase();
            if !msg.contains("duplicate column name") {
                return Err(err.into());
            }
        }
        tx.pragma_update(None, "user_version", version as i64)?;
        tx.commit()?;
    }

    ensure_critical_schema(conn)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_on_empty_db() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run(&mut conn).unwrap();
        let v: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
        // Idempotente: correr de nuevo no falla
        run(&mut conn).unwrap();
    }

    #[test]
    fn user_permission_audit_trigger_works_on_update() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run(&mut conn).unwrap();

        conn.execute(
            "INSERT INTO users (erp_user_id, username, email, full_name, pin_hash, role, permissions, active)
             VALUES ('erp_u1', 'cajero1', 'cajero1@test.com', 'Cajero Uno', 'hash1', 'cashier', '[\"ventas:crear\"]', 1)",
            [],
        ).unwrap();

        // Actualizar permisos simulando sync_users (ON CONFLICT DO UPDATE)
        conn.execute(
            "INSERT INTO users (erp_user_id, username, email, full_name, pin_hash, role, permissions, active)
             VALUES ('erp_u1', 'cajero1', 'cajero1@test.com', 'Cajero Uno', 'hash2', 'admin', '[\"ventas:crear\",\"inventario:ver\"]', 1)
             ON CONFLICT(erp_user_id) DO UPDATE SET
                pin_hash = COALESCE(excluded.pin_hash, users.pin_hash),
                role = excluded.role,
                permissions = excluded.permissions,
                active = 1",
            [],
        ).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM user_permission_audit", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    fn setup_db_at_v028(conn: &mut Connection) {
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        // Ejecutar solo hasta la migración 36 (estado exacto de v0.2.8)
        for (idx, sql) in MIGRATIONS.iter().take(36).enumerate() {
            let tx = conn.transaction().unwrap();
            tx.execute_batch(sql).unwrap();
            tx.pragma_update(None, "user_version", (idx + 1) as i64).unwrap();
            tx.commit().unwrap();
        }
        // Insertar un producto base para registrar movimientos históricos
        conn.execute(
            "INSERT INTO products (id, sku, name, price_cents, cost_cents, stock, active)
             VALUES (1, 'SKU-TEST', 'Producto Test', 1000, 500, 10.0, 1)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn migration_0038_handles_existing_warehouse_and_missing_bodega_nombre() {
        // Caso 1: La caja ya tenía 'bod-default' Y también la bodega real sincronizada del ERP
        let mut conn = Connection::open_in_memory().unwrap();
        setup_db_at_v028(&mut conn);

        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('bodega_id', 'bod_real_1'), ('bodega_nombre', 'Bodega Norte')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO warehouses (id, code, name, is_default, active) VALUES ('bod_real_1', 'BOD-NORTE', 'Bodega Norte', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO inventory_movements (product_id, kind, quantity, reference, warehouse_id)
             VALUES (1, 'adjustment', 5.0, 'Mov legacy', 'bod-default')",
            [],
        )
        .unwrap();

        // Debe migrar 0037 y 0038 sin error de UNIQUE/FK
        run(&mut conn).unwrap();

        let moved_wh: String = conn
            .query_row(
                "SELECT warehouse_id FROM inventory_movements WHERE reference = 'Mov legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(moved_wh, "bod_real_1");

        // Caso 2: La caja tenía bodega_id en settings, SIN bodega_nombre, y aún no existía la bodega real en warehouses
        let mut conn2 = Connection::open_in_memory().unwrap();
        setup_db_at_v028(&mut conn2);

        conn2
            .execute(
                "INSERT INTO settings (key, value) VALUES ('bodega_id', 'bod_real_2')",
                [],
            )
            .unwrap();
        conn2
            .execute(
                "INSERT INTO inventory_movements (product_id, kind, quantity, reference, warehouse_id)
                 VALUES (1, 'adjustment', 3.0, 'Mov legacy 2', 'bod-default')",
                [],
            )
            .unwrap();

        // Debe crear la bodega con fallback NOT NULL y reasignar sin error de FK
        run(&mut conn2).unwrap();

        let (wh_id, wh_name): (String, String) = conn2
            .query_row(
                "SELECT id, name FROM warehouses WHERE id = 'bod_real_2'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(wh_id, "bod_real_2");
        assert!(!wh_name.is_empty());

        let moved_wh2: String = conn2
            .query_row(
                "SELECT warehouse_id FROM inventory_movements WHERE reference = 'Mov legacy 2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(moved_wh2, "bod_real_2");
    }
}
