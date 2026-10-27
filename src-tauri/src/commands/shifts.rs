use reqwest::Client;
use rusqlite::{params, Connection};
use serde_json::json;
use std::time::Duration;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::shift::{
    CashShift, CloseShiftInput, OpenShiftInput, ShiftPaymentBreakdown, ShiftSummary, ShiftZReport,
};

fn get_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .filter(|s| !s.is_empty())
}

pub fn internal_get_active_shift(conn: &rusqlite::Connection) -> AppResult<Option<CashShift>> {
    let mut stmt = conn.prepare(
        "SELECT cs.id, cs.folio, cs.user_id, u.full_name, cs.opened_at, cs.closed_at,
                cs.opening_cents, cs.closing_cents, cs.expected_cents, cs.declared_cents,
                cs.difference_cents, cs.notes, cs.status, cs.erp_turno_id
         FROM cash_sessions cs
         LEFT JOIN users u ON u.id = cs.user_id
         WHERE cs.status = 'open'
         ORDER BY cs.opened_at DESC
         LIMIT 1",
    )?;

    let shift = stmt
        .query_row([], |r| {
            Ok(CashShift {
                id: r.get(0)?,
                folio: r.get(1)?,
                user_id: r.get(2)?,
                user_name: r.get(3)?,
                opened_at: r.get(4)?,
                closed_at: r.get(5)?,
                opening_cents: r.get(6)?,
                closing_cents: r.get(7)?,
                expected_cents: r.get(8)?,
                declared_cents: r.get(9)?,
                difference_cents: r.get(10)?,
                notes: r.get(11)?,
                status: r.get(12)?,
                erp_turno_id: r.get(13)?,
            })
        })
        .ok();

    Ok(shift)
}

#[tauri::command]
pub fn get_active_shift(db: State<'_, Db>) -> AppResult<Option<CashShift>> {
    let conn = db.conn()?;
    internal_get_active_shift(&conn)
}

pub fn open_shift_in_conn(
    conn: &Connection,
    user_id: i64,
    input: &OpenShiftInput,
) -> AppResult<CashShift> {
    if input.opening_cents < 0 {
        return Err(AppError::Validation(
            "La base inicial no puede ser negativa".into(),
        ));
    }

    let existe_abierto: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cash_sessions WHERE status = 'open'",
        [],
        |r| r.get(0),
    )?;
    if existe_abierto > 0 {
        return Err(AppError::Validation(
            "Ya existe un turno de caja abierto en esta terminal".into(),
        ));
    }

    let caja_codigo = get_setting(conn, "caja_codigo").unwrap_or_else(|| "CAJA-01".into());
    let today: String = conn.query_row(
        "SELECT strftime('%Y%m%d', 'now', 'localtime')",
        [],
        |r| r.get(0),
    )?;

    let count_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cash_sessions WHERE opened_at >= date('now', 'localtime')",
        [],
        |r| r.get(0),
    )?;

    let folio = format!("T-{}-{}-{:02}", caja_codigo, today, count_today + 1);

    conn.execute(
        "INSERT INTO cash_sessions (folio, user_id, opening_cents, notes, status, opened_at)
         VALUES (?1, ?2, ?3, ?4, 'open', datetime('now'))",
        params![folio, user_id, input.opening_cents, input.notes],
    )?;

    let shift_id = conn.last_insert_rowid();

    let opened_at: String = conn.query_row(
        "SELECT opened_at FROM cash_sessions WHERE id = ?1",
        params![shift_id],
        |r| r.get(0),
    )?;

    let user_name: Option<String> = conn
        .query_row(
            "SELECT full_name FROM users WHERE id = ?1",
            params![user_id],
            |r| r.get(0),
        )
        .ok();

    Ok(CashShift {
        id: shift_id,
        folio,
        user_id,
        user_name,
        opened_at,
        closed_at: None,
        opening_cents: input.opening_cents,
        closing_cents: None,
        expected_cents: None,
        declared_cents: None,
        difference_cents: None,
        notes: input.notes.clone(),
        status: "open".into(),
        erp_turno_id: None,
    })
}

#[tauri::command]
pub async fn open_shift(
    db: State<'_, Db>,
    user_id: i64,
    input: OpenShiftInput,
) -> AppResult<CashShift> {
    let (mut shift, erp_url, terminal_token, erp_user_id) = {
        let conn = db.conn()?;
        let created = open_shift_in_conn(&conn, user_id, &input)?;
        let erp_u = get_setting(&conn, "erp_url");
        let token = get_setting(&conn, "terminal_token");
        let erp_uid: Option<String> = conn
            .query_row(
                "SELECT erp_user_id FROM users WHERE id = ?1",
                params![user_id],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        (created, erp_u, token, erp_uid)
    };

    // Intentar sincronizar con el ERP (M2M) si hay red y token
    if let (Some(url), Some(token), Some(ref uid)) = (erp_url, terminal_token, erp_user_id.as_ref()) {
        let clean_url = url.trim_end_matches('/');
        let api_url = format!("{}/api/pos/v1/sync/turno", clean_url);
        let client = Client::builder().timeout(Duration::from_secs(5)).build()?;

        let body = json!({
            "folioTurno": shift.folio,
            "baseInicial": (input.opening_cents as f64) / 100.0,
            "erpUserId": uid,
        });

        if let Ok(res) = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
            .await
        {
            if res.status().is_success() {
                if let Ok(json_res) = res.json::<serde_json::Value>().await {
                    if let Some(tid) = json_res["data"]["turno"]["id"].as_str() {
                        shift.erp_turno_id = Some(tid.to_string());
                        let conn = db.conn()?;
                        let _ = conn.execute(
                            "UPDATE cash_sessions SET erp_turno_id = ?1 WHERE id = ?2",
                            params![tid, shift.id],
                        );
                    }
                }
            }
        }
    }

    Ok(shift)
}

#[tauri::command]
pub fn get_shift_summary(db: State<'_, Db>) -> AppResult<ShiftSummary> {
    let conn = db.conn()?;
    get_shift_summary_in_conn(&conn)
}

pub fn get_shift_summary_in_conn(conn: &Connection) -> AppResult<ShiftSummary> {
    let shift = internal_get_active_shift(conn)?
        .ok_or_else(|| AppError::Validation("No hay un turno de caja abierto actualmente".into()))?;
    get_shift_summary_for_shift(conn, &shift)
}

pub fn get_shift_summary_for_shift(conn: &Connection, shift: &CashShift) -> AppResult<ShiftSummary> {
    // 1. Totales de cabecera de ventas desacoplados del JOIN de pagos para evitar duplicación en pagos mixtos
    let (sales_count, total_sales_cents, total_tax_cents): (i64, i64, i64) = conn.query_row(
        "SELECT 
            COUNT(s.id) as sales_count,
            COALESCE(SUM(s.total_cents), 0) as total_sales_cents,
            COALESCE(SUM(s.tax_cents), 0) as total_tax_cents
         FROM sales s
         WHERE s.cash_session_id = ?1 AND s.status = 'completed'",
        params![shift.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    // 2. Agregación exacta de pagos por categoría normalizada
    let (cash_sales_cents, card_sales_cents, transfer_sales_cents, other_sales_cents): (i64, i64, i64, i64) = conn.query_row(
        "SELECT 
            COALESCE(SUM(CASE 
                WHEN LOWER(p.method) IN ('cash', 'efectivo') OR UPPER(COALESCE(pm.type, '')) = 'EFECTIVO'
                THEN p.amount_cents ELSE 0 END), 0) as cash_cents,
            COALESCE(SUM(CASE 
                WHEN LOWER(p.method) IN ('card', 'tarjeta') OR UPPER(COALESCE(pm.type, '')) = 'TARJETA'
                THEN p.amount_cents ELSE 0 END), 0) as card_cents,
            COALESCE(SUM(CASE 
                WHEN LOWER(p.method) IN ('transfer', 'transferencia') OR UPPER(COALESCE(pm.type, '')) = 'TRANSFERENCIA'
                THEN p.amount_cents ELSE 0 END), 0) as transfer_cents,
            COALESCE(SUM(CASE 
                WHEN NOT (
                    LOWER(p.method) IN ('cash', 'efectivo', 'card', 'tarjeta', 'transfer', 'transferencia')
                    OR UPPER(COALESCE(pm.type, '')) IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA')
                )
                THEN p.amount_cents ELSE 0 END), 0) as other_cents
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id OR pm.code = p.method
         WHERE s.cash_session_id = ?1 AND s.status = 'completed'",
        params![shift.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;

    let (customer_payments_cash_cents, customer_payments_other_cents): (i64, i64) = conn.query_row(
        "SELECT 
            COALESCE(SUM(CASE 
                WHEN pm.type = 'EFECTIVO' 
                     OR LOWER(COALESCE(pm.code, '')) LIKE '%cash%' 
                     OR LOWER(COALESCE(cp.payment_method_id, '')) IN ('cash', 'efectivo', 'pm_cash') 
                     OR cp.payment_method_id IS NULL 
                THEN cp.amount_cents 
                ELSE 0 
            END), 0) as cp_cash_cents,
            COALESCE(SUM(CASE 
                WHEN NOT (
                     pm.type = 'EFECTIVO' 
                     OR LOWER(COALESCE(pm.code, '')) LIKE '%cash%' 
                     OR LOWER(COALESCE(cp.payment_method_id, '')) IN ('cash', 'efectivo', 'pm_cash') 
                     OR cp.payment_method_id IS NULL
                )
                THEN cp.amount_cents 
                ELSE 0 
            END), 0) as cp_other_cents
         FROM customer_payments cp
         LEFT JOIN payment_methods pm ON pm.id = cp.payment_method_id
         WHERE cp.session_id = ?1",
        params![shift.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap_or((0, 0));

    let (cash_returns_cents, returns_count): (i64, i64) = conn.query_row(
        "SELECT 
            COALESCE(SUM(CASE WHEN refund_method = 'cash' THEN total_cents ELSE 0 END), 0),
            COUNT(id)
         FROM sale_returns
         WHERE cash_session_id = ?1",
        params![shift.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap_or((0, 0));

    let expected_cash_cents = shift.opening_cents + cash_sales_cents + customer_payments_cash_cents - cash_returns_cents;

    // Obtener desglose dinámico de todos los medios de pago configurados y con operaciones
    let mut breakdown_map: std::collections::HashMap<String, ShiftPaymentBreakdown> = std::collections::HashMap::new();

    // 1. Obtener todas las ventas agrupadas por medio de pago en este turno
    let mut p_stmt = conn.prepare(
        "SELECT 
            COALESCE(p.method, 'other') as p_method,
            COALESCE(pm.name, CASE 
                WHEN LOWER(p.method) IN ('cash', 'efectivo') THEN 'Efectivo M/N'
                WHEN LOWER(p.method) IN ('credit', 'credito', 'fiado') THEN 'Crédito / Fiado'
                WHEN LOWER(p.method) IN ('card', 'tarjeta') THEN 'Tarjeta Débito / Crédito'
                WHEN LOWER(p.method) IN ('transfer', 'transferencia') THEN 'Transferencia'
                ELSE p.method
            END) as p_name,
            COALESCE(pm.type, CASE 
                WHEN LOWER(p.method) IN ('cash', 'efectivo') THEN 'EFECTIVO'
                WHEN LOWER(p.method) IN ('credit', 'credito', 'fiado') THEN 'CREDITO'
                WHEN LOWER(p.method) IN ('card', 'tarjeta') THEN 'TARJETA'
                WHEN LOWER(p.method) IN ('transfer', 'transferencia') THEN 'TRANSFERENCIA'
                ELSE 'OTRO'
            END) as p_type,
            COALESCE(SUM(p.amount_cents), 0) as total_cents,
            COUNT(p.id) as count_tx
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id OR pm.code = p.method
         WHERE s.cash_session_id = ?1 AND s.status = 'completed'
         GROUP BY p_method, p_name, p_type",
    )?;

    let rows = p_stmt.query_map(params![shift.id], |r| {
        Ok(ShiftPaymentBreakdown {
            code: r.get(0)?,
            name: r.get(1)?,
            payment_type: r.get(2)?,
            amount_cents: r.get(3)?,
            tx_count: r.get(4)?,
        })
    })?;

    for r in rows {
        if let Ok(item) = r {
            breakdown_map.insert(item.code.to_lowercase(), item);
        }
    }

    // 2. Cargar medios de pago configurados en el negocio (activos y habilitados para esta terminal)
    let mut pm_stmt = conn.prepare(
        "SELECT code, name, type FROM payment_methods WHERE active = 1 AND terminal_enabled = 1",
    )?;
    let pm_rows = pm_stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
    })?;

    for r in pm_rows {
        if let Ok((code, name, p_type)) = r {
            let key = code.to_lowercase();
            breakdown_map.entry(key.clone()).or_insert_with(|| ShiftPaymentBreakdown {
                code,
                name,
                payment_type: p_type,
                amount_cents: 0,
                tx_count: 0,
            });
        }
    }

    let mut payment_breakdown: Vec<ShiftPaymentBreakdown> = breakdown_map.into_values().collect();
    // Ordenar: primero los que tienen dinero facturado > 0 (mayor a menor), luego alfabéticamente
    payment_breakdown.sort_by(|a, b| {
        b.amount_cents.cmp(&a.amount_cents).then_with(|| a.name.cmp(&b.name))
    });

    Ok(ShiftSummary {
        shift_id: shift.id,
        folio: shift.folio.clone(),
        opened_at: shift.opened_at.clone(),
        user_name: shift.user_name.clone().unwrap_or_else(|| "Cajero".into()),
        opening_cents: shift.opening_cents,
        sales_count,
        total_sales_cents,
        cash_sales_cents,
        card_sales_cents,
        transfer_sales_cents,
        other_sales_cents,
        customer_payments_cash_cents,
        customer_payments_other_cents,
        cash_returns_cents,
        returns_count,
        total_tax_cents,
        expected_cash_cents,
        payment_breakdown,
    })
}

pub fn build_shift_z_report(conn: &Connection, shift_id: i64) -> AppResult<ShiftZReport> {
    let shift = conn.query_row(
        "SELECT cs.id, cs.folio, cs.user_id, u.full_name,
                COALESCE(datetime(cs.opened_at, 'localtime'), cs.opened_at),
                CASE WHEN cs.closed_at IS NOT NULL THEN COALESCE(datetime(cs.closed_at, 'localtime'), cs.closed_at) ELSE NULL END,
                cs.opening_cents, cs.closing_cents, cs.expected_cents, cs.declared_cents,
                cs.difference_cents, cs.notes, cs.status, cs.erp_turno_id
         FROM cash_sessions cs
         LEFT JOIN users u ON u.id = cs.user_id
         WHERE cs.id = ?1",
        params![shift_id],
        |r| {
            Ok(CashShift {
                id: r.get(0)?,
                folio: r.get(1)?,
                user_id: r.get(2)?,
                user_name: r.get(3)?,
                opened_at: r.get(4)?,
                closed_at: r.get(5)?,
                opening_cents: r.get(6)?,
                closing_cents: r.get(7)?,
                expected_cents: r.get(8)?,
                declared_cents: r.get(9)?,
                difference_cents: r.get(10)?,
                notes: r.get(11)?,
                status: r.get(12)?,
                erp_turno_id: r.get(13)?,
            })
        },
    ).map_err(|_| AppError::Validation(format!("Turno de caja #{shift_id} no encontrado")))?;

    let summary = get_shift_summary_for_shift(conn, &shift)?;
    Ok(ShiftZReport { shift, summary })
}

pub fn close_shift_in_conn(
    conn: &Connection,
    input: &CloseShiftInput,
) -> AppResult<CashShift> {
    if input.declared_cents < 0 {
        return Err(AppError::Validation(
            "El efectivo declarado no puede ser negativo".into(),
        ));
    }

    let active = internal_get_active_shift(conn)?
        .ok_or_else(|| AppError::Validation("No hay un turno de caja abierto para cerrar".into()))?;

    let shift_id = active.id;
    let folio = active.folio;
    let user_id = active.user_id;
    let user_name = active.user_name;
    let opened_at = active.opened_at;
    let opening_cents = active.opening_cents;

    let erp_user_id: Option<String> = conn
        .query_row(
            "SELECT erp_user_id FROM users WHERE id = ?1",
            params![user_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();

    let cash_sales_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(p.amount_cents), 0)
         FROM payments p
         JOIN sales s ON s.id = p.sale_id
         LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id OR pm.code = p.method
         WHERE s.cash_session_id = ?1 AND s.status = 'completed'
           AND (LOWER(p.method) IN ('cash', 'efectivo') OR UPPER(COALESCE(pm.type, '')) = 'EFECTIVO')",
        params![shift_id],
        |r| r.get(0),
    )?;

    let customer_payments_cash_cents: i64 = conn
        .query_row(
            "SELECT 
                COALESCE(SUM(CASE 
                    WHEN pm.type = 'EFECTIVO' 
                         OR LOWER(COALESCE(pm.code, '')) LIKE '%cash%' 
                         OR LOWER(COALESCE(cp.payment_method_id, '')) IN ('cash', 'efectivo', 'pm_cash') 
                         OR cp.payment_method_id IS NULL 
                    THEN cp.amount_cents 
                    ELSE 0 
                END), 0)
             FROM customer_payments cp
             LEFT JOIN payment_methods pm ON pm.id = cp.payment_method_id
             WHERE cp.session_id = ?1",
            params![shift_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let cash_returns_cents: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0)
             FROM sale_returns
             WHERE cash_session_id = ?1 AND refund_method = 'cash'",
            params![shift_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let expected_cents =
        opening_cents + cash_sales_cents + customer_payments_cash_cents - cash_returns_cents;
    let difference_cents = input.declared_cents - expected_cents;

    conn.execute(
        "UPDATE cash_sessions
         SET closed_at = datetime('now'),
             closing_cents = ?1,
             expected_cents = ?2,
             declared_cents = ?3,
             difference_cents = ?4,
             notes = COALESCE(?5, notes),
             status = 'closed'
         WHERE id = ?6",
        params![
            input.declared_cents,
            expected_cents,
            input.declared_cents,
            difference_cents,
            input.notes,
            shift_id
        ],
    )?;

    let closed_at: String = conn.query_row(
        "SELECT closed_at FROM cash_sessions WHERE id = ?1",
        params![shift_id],
        |r| r.get(0),
    )?;

    // Encolar en sync_queue para asegurar sincronización en background
    let sync_payload = json!({
        "folioTurno": folio,
        "erpUserId": erp_user_id,
        "efectivoDeclarado": (input.declared_cents as f64) / 100.0,
        "observaciones": input.notes
    });

    conn.execute(
        "INSERT INTO sync_queue (entity_type, entity_id, payload, status)
         VALUES ('cash_session', ?1, ?2, 'pending')",
        params![shift_id, sync_payload.to_string()],
    )?;

    Ok(CashShift {
        id: shift_id,
        folio,
        user_id,
        user_name,
        opened_at,
        closed_at: Some(closed_at),
        opening_cents,
        closing_cents: Some(input.declared_cents),
        expected_cents: Some(expected_cents),
        declared_cents: Some(input.declared_cents),
        difference_cents: Some(difference_cents),
        notes: input.notes.clone(),
        status: "closed".into(),
        erp_turno_id: None,
    })
}

#[tauri::command]
pub async fn close_shift(
    db: State<'_, Db>,
    input: CloseShiftInput,
) -> AppResult<CashShift> {
    let (closed_shift, erp_url, terminal_token, erp_user_id) = {
        let conn = db.conn()?;
        let closed = close_shift_in_conn(&conn, &input)?;
        let erp_u = get_setting(&conn, "erp_url");
        let token = get_setting(&conn, "terminal_token");
        let erp_uid: Option<String> = conn
            .query_row(
                "SELECT erp_user_id FROM users WHERE id = ?1",
                params![closed.user_id],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        (closed, erp_u, token, erp_uid)
    };

    // Intentar sincronizar inmediatamente con el ERP (Z-Report contable)
    if let (Some(url), Some(token), Some(ref uid)) = (erp_url, terminal_token, erp_user_id.as_ref()) {
        let clean_url = url.trim_end_matches('/');
        let api_url = format!("{}/api/pos/v1/sync/cierre-turno", clean_url);
        let client = Client::builder().timeout(Duration::from_secs(8)).build()?;

        let body = json!({
            "folioTurno": closed_shift.folio,
            "erpUserId": uid,
            "efectivoDeclarado": (input.declared_cents as f64) / 100.0,
            "observaciones": input.notes.clone().unwrap_or_default()
        });

        if let Ok(res) = client
            .post(&api_url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&body)
            .send()
            .await
        {
            if res.status().is_success() {
                let conn = db.conn()?;
                let _ = conn.execute(
                    "UPDATE sync_queue SET status = 'synced', synced_at = datetime('now')
                     WHERE entity_type = 'cash_session' AND entity_id = ?1",
                    params![closed_shift.id],
                );
            }
        }
    }

    // Respaldo Preventivo de Base de Datos Local (Auto-Backup SQLite)
    // Protege a la tienda/PyME ante fallas de disco o apagones tras consolidar el arqueo
    if let Ok(conn) = db.conn() {
        let backup_query = "VACUUM INTO ?1";
        let backup_name = format!("backup_turno_{}.db", closed_shift.folio.replace(['/', '\\', ':', '*'], "-"));
        let _ = conn.execute(backup_query, params![backup_name]);
    }

    Ok(closed_shift)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::customers::{record_customer_payment_in_conn, RecordCustomerPaymentInput};
    use crate::commands::sales::{create_sale_in_conn, create_sale_return_in_conn};
    use crate::models::sale::{
        CartItemInput, CreateSaleInput, CreateSaleReturnInput, CreateSaleReturnItemInput,
        PaymentInput,
    };

    fn setup_shift_test_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        crate::db::migrations::run(&mut conn).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO users (id, username, full_name, role, active) VALUES (1, 'cajero1', 'Cajero Turno', 'cashier', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO products (id, sku, name, unit, price_cents, cost_cents, tax_rate_bp, stock, is_service, controls_stock, active)
             VALUES (1, 'PROD-01', 'Producto Turno', 'UND', 1000000, 600000, 0, 100.0, 0, 1, 1)",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_shift_mixed_payments_no_total_duplication() {
        let mut conn = setup_shift_test_db();

        // Abrir turno con base de $100.000 (10,000,000 centavos)
        let shift = open_shift_in_conn(
            &conn,
            1,
            &OpenShiftInput {
                opening_cents: 10000000,
                notes: Some("Apertura prueba mixta".into()),
            },
        )
        .unwrap();
        assert_eq!(shift.opening_cents, 10000000);

        // Registrar 1 venta de 2 unidades ($20.000 = 2,000,000 centavos) pagada con:
        // - $10.000 en transferencia (1,000,000 centavos)
        // - Billete de $20.000 en efectivo (2,000,000 centavos) -> devuelve $10.000 de cambio, retiene $10.000 netos
        let sale = create_sale_in_conn(
            &mut conn,
            CreateSaleInput {
                user_id: Some(1),
                customer_id: None,
                items: vec![CartItemInput {
                    product_id: Some(1),
                    sku: Some("PROD-01".into()),
                    barcode: None,
                    description: "Producto Turno".into(),
                    quantity: 2.0,
                    unit_price_cents: 1000000,
                    tax_rate_bp: Some(0),
                    tax_fixed_cents: Some(0),
                    discount_cents: Some(0),
                }],
                payments: vec![
                    PaymentInput {
                        method: "transfer".into(),
                        amount_cents: 1000000,
                        reference: Some("NEQUI-123".into()),
                    },
                    PaymentInput {
                        method: "cash".into(),
                        amount_cents: 2000000,
                        reference: None,
                    },
                ],
            },
        )
        .unwrap();

        assert_eq!(sale.total_cents, 2000000);
        assert_eq!(sale.change_cents, 1000000);

        // Consultar resumen del turno:
        // Total ventas debe ser $20.000 (2,000,000) y NUNCA $40.000 duplicado por el JOIN de los 2 pagos
        // Efectivo en ventas debe ser $10.000 netos (1,000,000) y transferencia $10.000 (1,000,000)
        // Efectivo esperado en gaveta = Base ($100.000) + Efectivo neto ($10.000) = $110.000 (11,000,000)
        let summary = get_shift_summary_in_conn(&conn).unwrap();
        assert_eq!(summary.sales_count, 1);
        assert_eq!(summary.total_sales_cents, 2000000);
        assert_eq!(summary.cash_sales_cents, 1000000);
        assert_eq!(summary.transfer_sales_cents, 1000000);
        assert_eq!(summary.expected_cash_cents, 11000000);
    }

    #[test]
    fn test_shift_full_cash_equation_with_returns_and_abonos() {
        let mut conn = setup_shift_test_db();
        conn.execute(
            "INSERT INTO customers (id, name, tax_id, credit_limit_cents, current_balance_cents, is_credit_blocked, active)
             VALUES (1, 'Cliente Abono', '900555666', 10000000, 3000000, 0, 1)",
            [],
        )
        .unwrap();

        // 1. Abrir turno con Base Inicial = $50.000 (5,000,000 centavos)
        open_shift_in_conn(
            &conn,
            1,
            &OpenShiftInput {
                opening_cents: 5000000,
                notes: None,
            },
        )
        .unwrap();

        // 2. Venta en efectivo de 3 unidades ($30.000 = 3,000,000 centavos)
        let sale = create_sale_in_conn(
            &mut conn,
            CreateSaleInput {
                user_id: Some(1),
                customer_id: None,
                items: vec![CartItemInput {
                    product_id: Some(1),
                    sku: None,
                    barcode: None,
                    description: "Producto Turno".into(),
                    quantity: 3.0,
                    unit_price_cents: 1000000,
                    tax_rate_bp: Some(0),
                    tax_fixed_cents: Some(0),
                    discount_cents: Some(0),
                }],
                payments: vec![PaymentInput {
                    method: "efectivo".into(), // probando código 'efectivo' en español
                    amount_cents: 3000000,
                    reference: None,
                }],
            },
        )
        .unwrap();

        // 3. Abono de cartera en efectivo por $15.000 (1,500,000 centavos)
        record_customer_payment_in_conn(
            &mut conn,
            RecordCustomerPaymentInput {
                customer_id: 1,
                user_id: 1,
                payment_method_id: Some("cash".into()),
                method: "cash".into(),
                amount_cents: 1500000,
                reference: None,
                notes: Some("Abono en efectivo".into()),
            },
        )
        .unwrap();

        // 4. Devolución en efectivo de 1 unidad ($10.000 = 1,000,000 centavos)
        create_sale_return_in_conn(
            &mut conn,
            CreateSaleReturnInput {
                sale_id: sale.id,
                user_id: Some(1),
                reason: "Devolución efectivo".into(),
                refund_method: "cash".into(),
                notes: None,
                items: vec![CreateSaleReturnItemInput {
                    sale_item_id: sale.items[0].id,
                    quantity: 1.0,
                    inventory_disposition: Some("restock".into()),
                }],
            },
        )
        .unwrap();

        // Ecuación Maestra del Cajón:
        // Base ($50.000) + Ventas Efectivo ($30.000) + Abonos Efectivo ($15.000) - Devoluciones Efectivo ($10.000) = $85.000 (8,500,000 centavos)
        let summary = get_shift_summary_in_conn(&conn).unwrap();
        assert_eq!(summary.expected_cash_cents, 8500000);

        // 5. Cerrar turno declarando exactamente $85.000 -> Diferencia = 0
        let closed = close_shift_in_conn(
            &conn,
            &CloseShiftInput {
                declared_cents: 8500000,
                notes: Some("Cuadre perfecto".into()),
            },
        )
        .unwrap();

        assert_eq!(closed.expected_cents, Some(8500000));
        assert_eq!(closed.declared_cents, Some(8500000));
        assert_eq!(closed.difference_cents, Some(0));
        assert_eq!(closed.status, "closed");
    }
}
