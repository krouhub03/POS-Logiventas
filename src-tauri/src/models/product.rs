use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: i64,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub unit: String,
    pub price_cents: i64,
    pub cost_cents: i64,
    pub tax_rate_bp: i64,
    pub stock: f64,
    pub min_stock: f64,
    pub is_service: bool,
    pub controls_stock: bool,
    pub allow_negative_stock: bool,
    pub is_bundle: bool,
    pub tags: Option<String>,
    pub tax_fixed_cents: i64,
    pub active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProduct {
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub unit: Option<String>,
    pub price_cents: i64,
    pub cost_cents: Option<i64>,
    pub tax_rate_bp: Option<i64>,
    pub stock: Option<f64>,
    pub min_stock: Option<f64>,
    pub is_service: Option<bool>,
    pub controls_stock: Option<bool>,
    pub allow_negative_stock: Option<bool>,
    pub is_bundle: Option<bool>,
    pub tags: Option<String>,
    pub tax_fixed_cents: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProductInput {
    pub id: i64,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub unit: Option<String>,
    pub price_cents: i64,
    pub cost_cents: Option<i64>,
    pub tax_rate_bp: Option<i64>,
    pub stock: Option<f64>,
    pub min_stock: Option<f64>,
    pub is_service: Option<bool>,
    pub controls_stock: Option<bool>,
    pub allow_negative_stock: Option<bool>,
    pub is_bundle: Option<bool>,
    pub tags: Option<String>,
    pub tax_fixed_cents: Option<i64>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockAdjustmentInput {
    pub product_id: i64,
    pub new_stock: f64,
    pub reason: String,
    pub user_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryMovementDto {
    pub id: i64,
    pub product_id: i64,
    pub product_name: Option<String>,
    pub kind: String,
    pub quantity: f64,
    pub reference: Option<String>,
    pub user_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductTag {
    pub id: i64,
    pub name: String,
    pub color_hex: String,
    pub active: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductComponentDto {
    pub id: i64,
    pub parent_product_id: i64,
    pub child_product_id: i64,
    pub child_name: String,
    pub child_sku: String,
    pub child_barcode: Option<String>,
    pub child_stock: f64,
    pub child_unit: String,
    pub quantity: f64,
    pub order_index: i64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveProductComponentItem {
    pub child_product_id: i64,
    pub quantity: f64,
    pub order_index: Option<i64>,
}

