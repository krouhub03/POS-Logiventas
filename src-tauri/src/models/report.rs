use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SalesReportFilterInput {
    /// Fecha de inicio en formato 'YYYY-MM-DD' (hora local)
    pub start_date: String,
    /// Fecha de fin en formato 'YYYY-MM-DD' (hora local)
    pub end_date: String,
    /// Fecha de inicio del período anterior equivalente (para % variación)
    pub prev_start_date: Option<String>,
    /// Fecha de fin del período anterior equivalente (para % variación)
    pub prev_end_date: Option<String>,
    /// Fecha de inicio del período t-2 (para la proyección del siguiente período)
    pub prev2_start_date: Option<String>,
    /// Fecha de fin del período t-2 (para la proyección del siguiente período)
    pub prev2_end_date: Option<String>,
    /// Filtro opcional por ID de cajero local
    pub cashier_id: Option<i64>,
    /// Filtro opcional por nombre de categoría
    pub category_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SalesKpiSummary {
    pub gross_sales_cents: i64,
    pub returns_cents: i64,
    pub net_sales_cents: i64,
    pub prev_net_sales_cents: i64,
    /// Crecimiento en puntos base (ej. 1420 = +14.20%, -500 = -5.00%)
    pub net_sales_growth_bp: i64,
    pub total_cost_cents: i64,
    pub estimated_profit_cents: i64,
    pub prev_profit_cents: i64,
    /// Margen sobre ventas netas en puntos base (ej. 2510 = 25.10%)
    pub profit_margin_bp: i64,
    pub tickets_count: i64,
    pub prev_tickets_count: i64,
    pub avg_ticket_cents: i64,
    pub total_units_sold: f64,
    pub returns_count: i64,
    pub peak_hour: Option<i64>,
    pub peak_hour_label: String,
    pub peak_hour_sales_cents: i64,
    pub peak_hour_tickets_count: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HourlySalesBucket {
    /// Hora del día en formato 24h (0..=23)
    pub hour: i64,
    pub label: String,
    pub tickets_count: i64,
    pub total_cents: i64,
    pub profit_cents: i64,
    pub units_sold: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DailySalesPoint {
    /// Fecha en formato 'YYYY-MM-DD'
    pub date: String,
    pub label: String,
    pub tickets_count: i64,
    pub total_cents: i64,
    pub profit_cents: i64,
    pub returns_cents: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TopProductStat {
    pub product_id: Option<i64>,
    pub sku: Option<String>,
    pub barcode: Option<String>,
    pub name: String,
    pub category_name: String,
    pub unit: String,
    pub image_url: Option<String>,
    pub image_local_path: Option<String>,
    pub units_sold: f64,
    pub revenue_cents: i64,
    pub cost_cents: i64,
    pub profit_cents: i64,
    /// Margen del producto en puntos base (ej. 3510 = 35.1%)
    pub margin_bp: i64,
    /// Participación sobre el total de ingresos en puntos base
    pub share_bp: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CategorySalesStat {
    pub category_name: String,
    pub units_sold: f64,
    pub tickets_count: i64,
    pub revenue_cents: i64,
    pub profit_cents: i64,
    /// Participación sobre el total de ventas en puntos base (10000 = 100.00%)
    pub share_bp: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PaymentMethodStat {
    pub method_code: String,
    pub method_name: String,
    pub transactions_count: i64,
    pub total_cents: i64,
    /// Participación sobre el total recaudado en puntos base
    pub share_bp: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CashierSalesStat {
    pub user_id: Option<i64>,
    pub cashier_name: String,
    pub tickets_count: i64,
    pub net_sales_cents: i64,
    pub avg_ticket_cents: i64,
    pub share_bp: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ForecastSeriesPoint {
    pub label: String,
    pub sales_cents: i64,
    pub is_projected: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SalesForecastSummary {
    /// Venta proyectada para el siguiente período equivalente en centavos
    pub projected_sales_cents: i64,
    /// Escenario conservador (límite inferior en centavos)
    pub conservative_sales_cents: i64,
    /// Escenario optimista (límite superior en centavos)
    pub optimistic_sales_cents: i64,
    /// Utilidad estimada proyectada en centavos
    pub projected_profit_cents: i64,
    /// Número estimado de tickets para el próximo período
    pub projected_tickets_count: i64,
    /// Meta operativa por hora o por día en centavos
    pub target_rate_cents: i64,
    /// Etiqueta de la meta (ej. "Meta por Hora" o "Meta por Día")
    pub target_rate_label: String,
    /// Variación esperada frente al período actual en puntos base
    pub expected_growth_bp: i64,
    /// Nivel de confianza ('Alta' | 'Media' | 'En aprendizaje')
    pub confidence_label: String,
    /// Puntos históricos (t-2, t-1, actual) + punto proyectado (t+1) para el mini-gráfico
    pub series: Vec<ForecastSeriesPoint>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SalesAnalyticsReport {
    pub start_date: String,
    pub end_date: String,
    pub kpis: SalesKpiSummary,
    pub forecast: SalesForecastSummary,
    pub hourly_distribution: Vec<HourlySalesBucket>,
    pub daily_trend: Vec<DailySalesPoint>,
    pub top_products: Vec<TopProductStat>,
    pub top_categories: Vec<CategorySalesStat>,
    pub payment_methods: Vec<PaymentMethodStat>,
    pub cashier_breakdown: Vec<CashierSalesStat>,
}
