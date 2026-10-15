use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CartItemInput {
    pub product_id: Option<i64>,
    pub sku: Option<String>,
    pub barcode: Option<String>,
    pub description: String,
    pub quantity: f64,
    pub unit_price_cents: i64,
    pub tax_rate_bp: Option<i64>,
    pub tax_fixed_cents: Option<i64>,
    pub discount_cents: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub method: String, // 'cash', 'card', 'transfer', 'other'
    pub amount_cents: i64,
    pub reference: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSaleInput {
    pub user_id: Option<i64>,
    pub customer_id: Option<i64>,
    pub items: Vec<CartItemInput>,
    pub payments: Vec<PaymentInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleItemDto {
    pub id: i64,
    pub product_id: Option<i64>,
    pub description: String,
    pub quantity: f64,
    pub unit_price_cents: i64,
    pub discount_cents: i64,
    pub tax_cents: i64,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleReceipt {
    pub id: i64,
    pub folio: String,
    pub subtotal_cents: i64,
    pub discount_cents: i64,
    pub tax_cents: i64,
    pub total_cents: i64,
    pub paid_cents: i64,
    pub change_cents: i64,
    pub items_count: usize,
    pub items: Vec<SaleItemDto>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodaySalesSummary {
    pub total_sales_count: i64,
    pub total_cents: i64,
    pub cash_cents: i64,
    pub card_cents: i64,
    pub transfer_cents: i64,
}
