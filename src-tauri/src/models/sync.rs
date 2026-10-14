use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckStockItemInput {
    pub product_id: i64,
    pub quantity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyStockResult {
    pub ok: bool,
    pub motivo: Option<String>,
    pub product_id: Option<i64>,
    pub product_name: Option<String>,
    pub stock_disponible: Option<f64>,
    pub offline_warning: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusDto {
    pub is_paired: bool,
    pub is_online: bool,
    pub pending_count: i64,
    pub last_sync_at: Option<String>,
    pub offline_policy: String,
    pub critical_threshold: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxBatchResult {
    pub dispatched: usize,
    pub synced: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodDto {
    pub id: String,
    pub code: String,
    pub erp_code: String,
    pub name: String,
    pub r#type: String,
    pub puc_code: Option<String>,
    pub puc_account_id: Option<String>,
    pub puc_account_name: Option<String>,
    pub active: i64,
    pub terminal_enabled: i64,
}
