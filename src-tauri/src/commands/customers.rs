use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::db::Db;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerDto {
    pub id: i64,
    pub name: String,
    pub tax_id: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
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
}

#[tauri::command]
pub async fn get_customers(db: State<'_, Db>) -> Result<Vec<CustomerDto>, String> {
    let conn = db.conn().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, tax_id, email, phone, address, active 
             FROM customers 
             WHERE active = 1 
             ORDER BY name ASC 
             LIMIT 100",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let active_int: i32 = row.get(6)?;
            Ok(CustomerDto {
                id: row.get(0)?,
                name: row.get(1)?,
                tax_id: row.get(2)?,
                email: row.get(3)?,
                phone: row.get(4)?,
                address: row.get(5)?,
                active: active_int == 1,
            })
        })
        .map_err(|e| e.to_string())?;

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

    let mut stmt = conn
        .prepare(
            "SELECT id, name, tax_id, email, phone, address, active 
             FROM customers 
             WHERE active = 1 AND (name LIKE ?1 OR tax_id LIKE ?1 OR phone LIKE ?1) 
             ORDER BY name ASC 
             LIMIT 30",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([&search_term], |row| {
            let active_int: i32 = row.get(6)?;
            Ok(CustomerDto {
                id: row.get(0)?,
                name: row.get(1)?,
                tax_id: row.get(2)?,
                email: row.get(3)?,
                phone: row.get(4)?,
                address: row.get(5)?,
                active: active_int == 1,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
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

    conn.execute(
        "INSERT INTO customers (name, tax_id, email, phone, address, active) 
         VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        params![
            name,
            input.tax_id.as_deref().map(|s| s.trim()),
            input.email.as_deref().map(|s| s.trim()),
            input.phone.as_deref().map(|s| s.trim()),
            input.address.as_deref().map(|s| s.trim()),
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
        "address": input.address
    });

    let _ = conn.execute(
        "INSERT INTO sync_queue (entity_type, entity_id, payload, status) 
         VALUES ('customer', ?1, ?2, 'pending')",
        params![new_id, payload.to_string()],
    );

    Ok(CustomerDto {
        id: new_id,
        name,
        tax_id: input.tax_id,
        email: input.email,
        phone: input.phone,
        address: input.address,
        active: true,
    })
}
