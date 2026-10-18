use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashShift {
    pub id: i64,
    pub folio: String,
    pub user_id: i64,
    pub user_name: Option<String>,
    pub opened_at: String,
    pub closed_at: Option<String>,
    pub opening_cents: i64,
    pub closing_cents: Option<i64>,
    pub expected_cents: Option<i64>,
    pub declared_cents: Option<i64>,
    pub difference_cents: Option<i64>,
    pub notes: Option<String>,
    pub status: String, // "open" | "closed"
    pub erp_turno_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenShiftInput {
    pub opening_cents: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseShiftInput {
    pub declared_cents: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftPaymentBreakdown {
    pub code: String,
    pub name: String,
    pub payment_type: String,
    pub amount_cents: i64,
    pub tx_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShiftSummary {
    pub shift_id: i64,
    pub folio: String,
    pub opened_at: String,
    pub user_name: String,
    pub opening_cents: i64,
    pub sales_count: i64,
    pub total_sales_cents: i64,
    pub cash_sales_cents: i64,
    pub card_sales_cents: i64,
    pub transfer_sales_cents: i64,
    pub other_sales_cents: i64,
    pub customer_payments_cash_cents: i64,
    pub customer_payments_other_cents: i64,
    pub total_tax_cents: i64,
    pub expected_cash_cents: i64,
    #[serde(default)]
    pub payment_breakdown: Vec<ShiftPaymentBreakdown>,
}

