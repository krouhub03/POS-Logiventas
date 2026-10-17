use reqwest::Client;
use rusqlite::params;
use serde_json::json;
use std::time::Duration;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::shift::{CashShift, CloseShiftInput, OpenShiftInput, ShiftSummary};

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

#[tauri::command]
pub async fn open_shift(
    db: State<'_, Db>,
    user_id: i64,
    input: OpenShiftInput,
) -> AppResult<CashShift> {
    if input.opening_cents < 0 {
        return Err(AppError::Validation(
            "La base inicial no puede ser negativa".into(),
        ));
    }

    let (caja_codigo, erp_url, terminal_token, erp_user_id) = {
        let conn = db.conn()?;

        // Verificar que no haya un turno ya abierto
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

        let caja = get_setting(&conn, "caja_codigo").unwrap_or_else(|| "CAJA-01".into());
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

        (caja, erp_u, token, erp_uid)
    };

    let shift_id: i64;
    let folio: String;
    let opened_at: String;

    {
        let conn = db.conn()?;
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

        folio = format!("T-{}-{}-{:02}", caja_codigo, today, count_today + 1);

        conn.execute(
            "INSERT INTO cash_sessions (folio, user_id, opening_cents, notes, status, opened_at)
             VALUES (?1, ?2, ?3, ?4, 'open', datetime('now'))",
            params![folio, user_id, input.opening_cents, input.notes],
        )?;

        shift_id = conn.last_insert_rowid();

        opened_at = conn.query_row(
            "SELECT opened_at FROM cash_sessions WHERE id = ?1",
            params![shift_id],
            |r| r.get(0),
        )?;
    }

    // Intentar sincronizar con el ERP (M2M) si hay red y token
    let mut erp_turno_id: Option<String> = None;
    if let (Some(url), Some(token), Some(ref uid)) = (erp_url, terminal_token, erp_user_id.as_ref()) {
        let clean_url = url.trim_end_matches('/');
        let api_url = format!("{}/api/pos/v1/sync/turno", clean_url);
        let client = Client::builder().timeout(Duration::from_secs(5)).build()?;

        let body = json!({
            "folioTurno": folio,
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
                        erp_turno_id = Some(tid.to_string());
                        let conn = db.conn()?;
                        let _ = conn.execute(
                            "UPDATE cash_sessions SET erp_turno_id = ?1 WHERE id = ?2",
                            params![tid, shift_id],
                        );
                    }
                }
            }
        }
    }

    let conn = db.conn()?;
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
        notes: input.notes,
        status: "open".into(),
        erp_turno_id,
    })
}

#[tauri::command]
pub fn get_shift_summary(db: State<'_, Db>) -> AppResult<ShiftSummary> {
    let conn = db.conn()?;
    let shift = internal_get_active_shift(&conn)?
        .ok_or_else(|| AppError::Validation("No hay un turno de caja abierto actualmente".into()))?;

    let row = conn.query_row(
        "SELECT 
            COUNT(DISTINCT s.id) as sales_count,
            COALESCE(SUM(s.total_cents), 0) as total_sales_cents,
            COALESCE(SUM(s.tax_cents), 0) as total_tax_cents,
            COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount_cents ELSE 0 END), 0) as cash_cents,
            COALESCE(SUM(CASE WHEN p.method = 'card' THEN p.amount_cents ELSE 0 END), 0) as card_cents,
            COALESCE(SUM(CASE WHEN p.method = 'transfer' THEN p.amount_cents ELSE 0 END), 0) as transfer_cents,
            COALESCE(SUM(CASE WHEN p.method NOT IN ('cash', 'card', 'transfer') THEN p.amount_cents ELSE 0 END), 0) as other_cents
         FROM sales s
         LEFT JOIN payments p ON p.sale_id = s.id
         WHERE s.cash_session_id = ?1 AND s.status = 'completed'",
        params![shift.id],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        },
    )?;

    let sales_count = row.0;
    let total_sales_cents = row.1;
    let total_tax_cents = row.2;
    let cash_sales_cents = row.3;
    let card_sales_cents = row.4;
    let transfer_sales_cents = row.5;
    let other_sales_cents = row.6;

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

    let cash_returns_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_cents), 0)
         FROM sale_returns
         WHERE cash_session_id = ?1 AND refund_method = 'cash'",
        params![shift.id],
        |r| r.get(0),
    ).unwrap_or(0);

    let expected_cash_cents = shift.opening_cents + cash_sales_cents + customer_payments_cash_cents - cash_returns_cents;

    Ok(ShiftSummary {
        shift_id: shift.id,
        folio: shift.folio,
        opened_at: shift.opened_at,
        user_name: shift.user_name.unwrap_or_else(|| "Cajero".into()),
        opening_cents: shift.opening_cents,
        sales_count,
        total_sales_cents,
        cash_sales_cents,
        card_sales_cents,
        transfer_sales_cents,
        other_sales_cents,
        customer_payments_cash_cents,
        customer_payments_other_cents,
        total_tax_cents,
        expected_cash_cents,
    })
}

#[tauri::command]
pub async fn close_shift(
    db: State<'_, Db>,
    input: CloseShiftInput,
) -> AppResult<CashShift> {
    if input.declared_cents < 0 {
        return Err(AppError::Validation(
            "El efectivo declarado no puede ser negativo".into(),
        ));
    }

    let (shift_id, folio, user_id, user_name, opened_at, opening_cents, erp_url, terminal_token, erp_user_id) = {
        let conn = db.conn()?;
        let active = internal_get_active_shift(&conn)?
            .ok_or_else(|| AppError::Validation("No hay un turno de caja abierto para cerrar".into()))?;

        let erp_uid: Option<String> = conn
            .query_row(
                "SELECT erp_user_id FROM users WHERE id = ?1",
                params![active.user_id],
                |r| r.get(0),
            )
            .ok()
            .flatten();

        let erp_u = get_setting(&conn, "erp_url");
        let token = get_setting(&conn, "terminal_token");

        (
            active.id,
            active.folio,
            active.user_id,
            active.user_name,
            active.opened_at,
            active.opening_cents,
            erp_u,
            token,
            erp_uid,
        )
    };

    let (cash_sales_cents, _total_sales_cents): (i64, i64) = {
        let conn = db.conn()?;
        conn.query_row(
            "SELECT 
                COALESCE(SUM(CASE WHEN p.method = 'cash' THEN p.amount_cents ELSE 0 END), 0),
                COALESCE(SUM(s.total_cents), 0)
             FROM sales s
             LEFT JOIN payments p ON p.sale_id = s.id
             WHERE s.cash_session_id = ?1 AND s.status = 'completed'",
            params![shift_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?
    };

    let customer_payments_cash_cents: i64 = {
        let conn = db.conn()?;
        conn.query_row(
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
        ).unwrap_or(0)
    };
    let cash_returns_cents: i64 = {
        let conn = db.conn()?;
        conn.query_row(
            "SELECT COALESCE(SUM(total_cents), 0)
             FROM sale_returns
             WHERE cash_session_id = ?1 AND refund_method = 'cash'",
            params![shift_id],
            |r| r.get(0),
        ).unwrap_or(0)
    };

    let expected_cents = opening_cents + cash_sales_cents + customer_payments_cash_cents - cash_returns_cents;
    let difference_cents = input.declared_cents - expected_cents;

    let closed_at: String;

    {
        let conn = db.conn()?;
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

        closed_at = conn.query_row(
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
    }

    // Intentar sincronizar inmediatamente con el ERP (Z-Report contable)
    if let (Some(url), Some(token), Some(ref uid)) = (erp_url, terminal_token, erp_user_id.as_ref()) {
        let clean_url = url.trim_end_matches('/');
        let api_url = format!("{}/api/pos/v1/sync/cierre-turno", clean_url);
        let client = Client::builder().timeout(Duration::from_secs(8)).build()?;

        let body = json!({
            "folioTurno": folio,
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
                    params![shift_id],
                );
            }
        }
    }

    // Respaldo Preventivo de Base de Datos Local (Auto-Backup SQLite)
    // Protege a la tienda/PyME ante fallas de disco o apagones tras consolidar el arqueo
    if let Ok(conn) = db.conn() {
        let backup_query = "VACUUM INTO ?1";
        // Si SQLite soporta VACUUM INTO, genera backup atómico con fecha del turno
        let backup_name = format!("backup_turno_{}.db", folio.replace(['/', '\\', ':', '*'], "-"));
        let _ = conn.execute(backup_query, params![backup_name]);
    }

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
        notes: input.notes,
        status: "closed".into(),
        erp_turno_id: None,
    })
}
