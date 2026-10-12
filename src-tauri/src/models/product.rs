use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: i64,
    pub sku: String,
    pub barcode: Option<String>,
    pub name: String,
    pub category_id: Option<i64>,
    pub unit: String,
    pub price_cents: i64,
    pub cost_cents: i64,
    pub tax_rate_bp: i64,
    pub stock: f64,
    pub min_stock: f64,
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
}
