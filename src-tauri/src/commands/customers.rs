use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::db::Db;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerDto {
    pub id: i64,
    pub erp_id: Option<String>,
    pub name: String,
    pub tax_id: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub credit_limit_cents: i64,
    pub current_balance_cents: i64,
    pub is_credit_blocked: bool,
    pub credit_days: i32,
    pub notes: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerInput {
    pub name: String,
    pub tax_id: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub credit_limit_cents: Option<i64>,
    pub credit_days: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCustomerCreditInput {
    pub id: i64,
    pub credit_limit_cents: i64,
    pub is_credit_blocked: bool,
    pub credit_days: i32,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordCustomerPaymentInput {
    pub customer_id: i64,
    pub user_id: i64,
    pub payment_method_id: Option<String>,
    pub method: String,
    pub amount_cents: i64,
    pub reference: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerPaymentDto {
    pub id: i64,
    pub folio: String,
    pub customer_id: i64,
    pub customer_name: String,
    pub session_id: Option<i64>,
    pub user_id: i64,
    pub payment_method_id: Option<String>,
    pub method: Option<String>,
    pub amount_cents: i64,
    pub previous_balance_cents: i64,
    pub new_balance_cents: i64,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

const CUSTOMER_COLUMNS: &str = 
    "id, erp_id, name, tax_id, email, phone, address, credit_limit_cents, current_balance_cents, is_credit_blocked, credit_days, notes, active";

fn map_customer(row: &rusqlite::Row<'_>) -> rusqlite::Result<CustomerDto> {
    let is_blocked_int: i32 = row.get(9).unwrap_or(0);
    let active_int: i32 = row.get(12).unwrap_or(1);
    Ok(CustomerDto {
        id: row.get(0)?,
        erp_id: row.get(1)?,
        name: row.get(2)?,
        tax_id: row.get(3)?,
        email: row.get(4)?,
        phone: row.get(5)?,
        address: row.get(6)?,
        credit_limit_cents: row.get(7).unwrap_or(0),
        current_balance_cents: row.get(8).unwrap_or(0),
        is_credit_blocked: is_blocked_int == 1,
        credit_days: row.get(10).unwrap_or(30),
        notes: row.get(11)?,
        active: active_int == 1,
    })
}

#[tauri::command]
pub async fn get_customers(db: State<'_, Db>) -> Result<Vec<CustomerDto>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {CUSTOMER_COLUMNS} FROM customers WHERE active = 1 ORDER BY name ASC LIMIT 100"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_customer).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

#[tauri::command]
pub async fn search_customers(
    db: State<'_, Db>,
    query: String,
) -> Result<Vec<CustomerDto>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let search_term = format!("%{}%", query.trim());
    let sql = format!(
        "SELECT {CUSTOMER_COLUMNS} FROM customers \
         WHERE active = 1 AND (name LIKE ?1 OR tax_id LIKE ?1 OR phone LIKE ?1) \
         ORDER BY name ASC LIMIT 30"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([&search_term], map_customer).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

#[tauri::command]
pub async fn get_customer(db: State<'_, Db>, id: i64) -> Result<CustomerDto, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {CUSTOMER_COLUMNS} FROM customers WHERE id = ?1");
    conn.query_row(&sql, params![id], map_customer)
        .map_err(|e| format!("Cliente con ID {} no encontrado: {}", id, e))
}

#[tauri::command]
pub async fn create_customer(
    db: State<'_, Db>,
    input: CreateCustomerInput,
) -> Result<CustomerDto, String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("El nombre del cliente es obligatorio".to_string());
    }

    let conn = db.conn().map_err(|e| e.to_string())?;
    let credit_limit = input.credit_limit_cents.unwrap_or(0);
    let credit_days = input.credit_days.unwrap_or(30);

    conn.execute(
        "INSERT INTO customers (name, tax_id, email, phone, address, credit_limit_cents, current_balance_cents, is_credit_blocked, credit_days, notes, active) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, ?7, ?8, 1)",
        params![
            name,
            input.tax_id.as_deref().map(|s| s.trim()),
            input.email.as_deref().map(|s| s.trim()),
            input.phone.as_deref().map(|s| s.trim()),
            input.address.as_deref().map(|s| s.trim()),
            credit_limit,
            credit_days,
            input.notes.as_deref().map(|s| s.trim()),
        ],
    )
    .map_err(|e| format!("Error guardando cliente: {}", e))?;

    let new_id = conn.last_insert_rowid();

    // Encolar en sync_queue para sincronización con el ERP Megalider
    let payload = serde_json::json!({
        "localId": new_id,
        "name": name,
        "taxId": input.tax_id,
        "email": input.email,
        "phone": input.phone,
        "address": input.address,
        "creditLimitCents": credit_limit,
        "creditDays": credit_days,
        "notes": input.notes
    });

    let _ = conn.execute(
        "INSERT INTO sync_queue (entity_type, entity_id, payload, status) \
         VALUES ('customer', ?1, ?2, 'pending')",
        params![new_id, payload.to_string()],
    );

    Ok(CustomerDto {
        id: new_id,
        erp_id: None,
        name,
        tax_id: input.tax_id,
        email: input.email,
        phone: input.phone,
        address: input.address,
        credit_limit_cents: credit_limit,
        current_balance_cents: 0,
        is_credit_blocked: false,
        credit_days,
        notes: input.notes,
        active: true,
    })
}

#[tauri::command]
pub async fn update_customer_credit(
    db: State<'_, Db>,
    input: UpdateCustomerCreditInput,
) -> Result<CustomerDto, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE customers \
         SET credit_limit_cents = ?1, is_credit_blocked = ?2, credit_days = ?3, notes = ?4 \
         WHERE id = ?5",
        params![
            input.credit_limit_cents,
            if input.is_credit_blocked { 1 } else { 0 },
            input.credit_days,
            input.notes.as_deref().map(str::trim),
            input.id
        ],
    )
    .map_err(|e| format!("Error actualizando crédito del cliente: {}", e))?;

    let sql = format!("SELECT {CUSTOMER_COLUMNS} FROM customers WHERE id = ?1");
    conn.query_row(&sql, params![input.id], map_customer)
        .map_err(|e| format!("Error consultando cliente actualizado: {}", e))
}

#[tauri::command]
pub async fn record_customer_payment(
    db: State<'_, Db>,
    input: RecordCustomerPaymentInput,
) -> Result<CustomerPaymentDto, String> {
    if input.amount_cents <= 0 {
        return Err("El monto del abono debe ser mayor a 0".into());
    }

    let mut conn = db.conn().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Obtener datos actuales del cliente
    let (customer_name, current_balance): (String, i64) = tx
        .query_row(
            "SELECT name, current_balance_cents FROM customers WHERE id = ?1",
            params![input.customer_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| format!("Cliente con ID {} no encontrado", input.customer_id))?;

    let previous_balance_cents = current_balance;
    let new_balance_cents = previous_balance_cents - input.amount_cents;

    // 2. Resolver turno activo si existe para consolidar en el corte de caja
    let active_shift_id: Option<i64> = tx
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();

    // 3. Generar folio único para el recibo de caja
    let caja_codigo: String = tx
        .query_row(
            "SELECT value FROM settings WHERE key = 'caja_codigo'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "CAJA-01".into());

    let count: i64 = tx
        .query_row("SELECT COUNT(*) FROM customer_payments", [], |r| r.get(0))
        .unwrap_or(0);

    let folio = format!("REC-{}-{:05}", caja_codigo, count + 1);

    // 4. Actualizar el saldo deudor del cliente
    tx.execute(
        "UPDATE customers SET current_balance_cents = ?1 WHERE id = ?2",
        params![new_balance_cents, input.customer_id],
    )
    .map_err(|e| format!("Error actualizando balance de cliente: {}", e))?;

    // 5. Registrar en customer_payments
    tx.execute(
        "INSERT INTO customer_payments (folio, customer_id, session_id, user_id, payment_method_id, amount_cents, previous_balance_cents, new_balance_cents, reference, notes) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            folio,
            input.customer_id,
            active_shift_id,
            input.user_id,
            input.payment_method_id,
            input.amount_cents,
            previous_balance_cents,
            new_balance_cents,
            input.reference.as_deref().map(str::trim),
            input.notes.as_deref().map(str::trim),
        ],
    )
    .map_err(|e| format!("Error guardando recibo de abono: {}", e))?;

    let payment_id = tx.last_insert_rowid();

    let created_at: String = tx
        .query_row(
            "SELECT created_at FROM customer_payments WHERE id = ?1",
            params![payment_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "now".into());

    // 6. Encolar en sync_queue para reportar el ingreso a tesorería en el ERP
    let sync_payload = serde_json::json!({
        "localPaymentId": payment_id,
        "folio": folio,
        "customerId": input.customer_id,
        "customerName": customer_name,
        "sessionId": active_shift_id,
        "userId": input.user_id,
        "paymentMethodId": input.payment_method_id,
        "method": input.method,
        "amountCents": input.amount_cents,
        "previousBalanceCents": previous_balance_cents,
        "newBalanceCents": new_balance_cents,
        "reference": input.reference,
        "notes": input.notes,
        "createdAt": created_at
    });

    if let Err(e) = tx.execute(
        "INSERT INTO sync_queue (entity_type, entity_id, payload, status) \
         VALUES ('customer_payment', ?1, ?2, 'pending')",
        params![payment_id, sync_payload.to_string()],
    ) {
        eprintln!("[cxc-sync] Error encolando customer_payment en sync_queue: {}", e);
    }

    tx.commit().map_err(|e| format!("Error consolidando transacción de abono: {}", e))?;

    Ok(CustomerPaymentDto {
        id: payment_id,
        folio,
        customer_id: input.customer_id,
        customer_name,
        session_id: active_shift_id,
        user_id: input.user_id,
        payment_method_id: input.payment_method_id,
        method: Some(input.method),
        amount_cents: input.amount_cents,
        previous_balance_cents,
        new_balance_cents,
        reference: input.reference,
        notes: input.notes,
        created_at,
    })
}

#[tauri::command]
pub async fn get_customer_payments(
    db: State<'_, Db>,
    customer_id: i64,
) -> Result<Vec<CustomerPaymentDto>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT cp.id, cp.folio, cp.customer_id, c.name, cp.session_id, cp.user_id, \
                    cp.payment_method_id, pm.name, cp.amount_cents, cp.previous_balance_cents, \
                    cp.new_balance_cents, cp.reference, cp.notes, cp.created_at \
             FROM customer_payments cp \
             JOIN customers c ON c.id = cp.customer_id \
             LEFT JOIN payment_methods pm ON pm.id = cp.payment_method_id \
             WHERE cp.customer_id = ?1 \
             ORDER BY cp.created_at DESC LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![customer_id], |r| {
            Ok(CustomerPaymentDto {
                id: r.get(0)?,
                folio: r.get(1)?,
                customer_id: r.get(2)?,
                customer_name: r.get(3)?,
                session_id: r.get(4)?,
                user_id: r.get(5)?,
                payment_method_id: r.get(6)?,
                method: r.get(7)?,
                amount_cents: r.get(8)?,
                previous_balance_cents: r.get(9)?,
                new_balance_cents: r.get(10)?,
                reference: r.get(11)?,
                notes: r.get(12)?,
                created_at: r.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}
