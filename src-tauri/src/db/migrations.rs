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

    // Saneamiento automático de registros en sync_queue estancados (>= 10 intentos)
    let _ = conn.execute(
        "UPDATE sync_queue SET status = 'failed' WHERE status = 'pending' AND attempts >= 10",
        [],
    );

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
}
