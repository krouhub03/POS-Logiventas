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
];

pub fn run(conn: &mut Connection) -> AppResult<()> {
    let current: usize = conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))? as usize;

    for (idx, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let version = idx + 1;
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version as i64)?;
        tx.commit()?;
    }

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
}
