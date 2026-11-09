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
    pub wholesale_price_cents: i64,
    pub cost_cents: i64,
    pub tax_rate_bp: i64,
    pub stock: f64,
    pub min_stock: f64,
    pub max_stock: f64,
    pub is_service: bool,
    pub controls_stock: bool,
    pub allow_negative_stock: bool,
    pub is_bundle: bool,
    pub tags: Option<String>,
    pub tax_fixed_cents: i64,
    pub image_url: Option<String>,
    pub image_local_path: Option<String>,
    pub image_hash: Option<String>,
    pub image_sync_status: Option<String>,
    pub active: bool,
    pub components: Option<Vec<ProductComponentDto>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct NewProduct {
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub unit: Option<String>,
    pub price_cents: i64,
    pub wholesale_price_cents: Option<i64>,
    pub cost_cents: Option<i64>,
    pub tax_rate_bp: Option<i64>,
    pub stock: Option<f64>,
    pub min_stock: Option<f64>,
    pub max_stock: Option<f64>,
    pub is_service: Option<bool>,
    pub controls_stock: Option<bool>,
    pub allow_negative_stock: Option<bool>,
    pub is_bundle: Option<bool>,
    pub tags: Option<String>,
    pub tax_fixed_cents: Option<i64>,
    pub image_url: Option<String>,
    pub image_local_path: Option<String>,
    pub image_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct UpdateProductInput {
    pub id: i64,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub unit: Option<String>,
    pub price_cents: i64,
    pub wholesale_price_cents: Option<i64>,
    pub cost_cents: Option<i64>,
    pub tax_rate_bp: Option<i64>,
    pub stock: Option<f64>,
    pub min_stock: Option<f64>,
    pub max_stock: Option<f64>,
    pub is_service: Option<bool>,
    pub controls_stock: Option<bool>,
    pub allow_negative_stock: Option<bool>,
    pub is_bundle: Option<bool>,
    pub tags: Option<String>,
    pub tax_fixed_cents: Option<i64>,
    pub image_url: Option<String>,
    pub image_local_path: Option<String>,
    pub image_hash: Option<String>,
    pub image_sync_status: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StockAdjustmentInput {
    pub product_id: i64,
    pub new_stock: f64,
    pub reason: String,
    pub user_id: Option<i64>,
    pub warehouse_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseDto {
    pub id: String,
    pub code: String,
    pub name: String,
    pub is_default: bool,
    pub active: bool,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct KardexFilterInput {
    pub product_id: Option<i64>,
    pub warehouse_id: Option<String>,
    pub time_preset: Option<String>, // "today" | "week" | "month" | "custom"
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InventoryMovementDto {
    pub id: i64,
    pub product_id: i64,
    pub product_name: Option<String>,
    pub product_sku: Option<String>,
    pub warehouse_id: Option<String>,
    pub warehouse_code: Option<String>,
    pub warehouse_name: Option<String>,
    pub kind: String,
    pub quantity: f64,
    pub balance_before: Option<f64>,
    pub balance_after: Option<f64>,
    pub unit_cost_cents: Option<i64>,
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
    pub child_price_cents: i64,
    pub child_cost_cents: i64,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSearchPagedInput {
    pub query: Option<String>,
    pub type_filter: Option<String>,
    pub category: Option<String>,
    pub tag: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductSearchPagedResult {
    pub items: Vec<Product>,
    pub total_count: i64,
    pub products_count: i64,
    pub services_count: i64,
    pub has_more: bool,
}

