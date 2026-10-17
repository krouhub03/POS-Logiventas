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
    pub method: String, // 'cash', 'card', 'transfer', 'other' o código ERP
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
    pub sku: Option<String>,
    pub barcode: Option<String>,
    pub unit: Option<String>,
    pub description: String,
    pub quantity: f64,
    pub returned_quantity: f64,
    pub unit_price_cents: i64,
    pub discount_cents: i64,
    pub tax_cents: i64,
    pub total_cents: i64,
    pub is_service: bool,
    pub is_bundle: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalePaymentDto {
    pub id: i64,
    pub method: String,
    pub method_name: String,
    pub amount_cents: i64,
    pub reference: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleReturnItemDto {
    pub id: i64,
    pub sale_item_id: i64,
    pub product_id: Option<i64>,
    pub description: String,
    pub quantity: f64,
    pub unit_price_cents: i64,
    pub discount_cents: i64,
    pub tax_cents: i64,
    pub total_cents: i64,
    pub inventory_disposition: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleReturnDto {
    pub id: i64,
    pub folio: String,
    pub sale_id: i64,
    pub sale_folio: String,
    pub customer_id: Option<i64>,
    pub customer_name: Option<String>,
    pub cashier_name: Option<String>,
    pub return_type: String,
    pub reason: String,
    pub refund_method: String,
    pub subtotal_cents: i64,
    pub discount_cents: i64,
    pub tax_cents: i64,
    pub total_cents: i64,
    pub notes: Option<String>,
    pub created_at: String,
    pub items: Vec<SaleReturnItemDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleReceipt {
    pub id: i64,
    pub folio: String,
    pub customer_id: Option<i64>,
    pub customer_name: Option<String>,
    pub customer_tax_id: Option<String>,
    pub cashier_name: Option<String>,
    pub subtotal_cents: i64,
    pub discount_cents: i64,
    pub tax_cents: i64,
    pub total_cents: i64,
    pub paid_cents: i64,
    pub change_cents: i64,
    pub reprint_count: i64,
    pub last_reprinted_at: Option<String>,
    pub return_status: String,
    pub returned_cents: i64,
    pub items_count: usize,
    pub items: Vec<SaleItemDto>,
    pub payments: Vec<SalePaymentDto>,
    pub returns: Vec<SaleReturnDto>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaleSummaryItem {
    pub id: i64,
    pub folio: String,
    pub customer_id: Option<i64>,
    pub customer_name: Option<String>,
    pub customer_tax_id: Option<String>,
    pub cashier_name: Option<String>,
    pub subtotal_cents: i64,
    pub discount_cents: i64,
    pub tax_cents: i64,
    pub total_cents: i64,
    pub paid_cents: i64,
    pub change_cents: i64,
    pub items_count: i64,
    pub reprint_count: i64,
    pub return_status: String,
    pub returned_cents: i64,
    pub payment_summary: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSaleReturnItemInput {
    pub sale_item_id: i64,
    pub quantity: f64,
    pub inventory_disposition: Option<String>, // 'restock' | 'merma' | 'no_stock'
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSaleReturnInput {
    pub sale_id: i64,
    pub user_id: Option<i64>,
    pub reason: String,
    pub refund_method: String, // 'cash' | 'credit_balance' | 'transfer' | 'other'
    pub notes: Option<String>,
    pub items: Vec<CreateSaleReturnItemInput>,
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
