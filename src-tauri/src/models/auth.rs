use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStatus {
    pub is_paired: bool,
    pub erp_url: String,
    pub caja_id: Option<String>,
    pub caja_nombre: Option<String>,
    pub caja_codigo: Option<String>,
    pub bodega_id: Option<String>,
    pub bodega_nombre: Option<String>,
    pub empresa_id: Option<String>,
    pub empresa_nombre: Option<String>,
    pub empresa_nit: Option<String>,
    pub active_cashier: Option<CashierUser>,
    #[serde(default)]
    pub active_cashier_revoked: Option<bool>,
    #[serde(default)]
    pub last_caja_id: Option<String>,
    #[serde(default)]
    pub last_caja_codigo: Option<String>,
    #[serde(default)]
    pub last_caja_nombre: Option<String>,
    #[serde(default)]
    pub last_empresa_nombre: Option<String>,
    #[serde(default)]
    pub is_disconnected: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectTerminalInput {
    pub erp_url: Option<String>,
    pub caja_id: Option<String>,
    pub caja_codigo: Option<String>,
    pub pin: Option<String>,
    pub email: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashierUser {
    pub id: i64,
    pub erp_user_id: Option<String>,
    pub username: String,
    pub full_name: String,
    pub email: Option<String>,
    pub role: String,
    pub active: bool,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub profile_name: Option<String>,
    pub erp_role_code: Option<String>,
    pub login_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCodeInput {
    pub erp_url: String,
    pub code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairLoginInput {
    pub erp_url: String,
    pub email: String,
    pub password: String,
    pub caja_id: Option<String>,
    pub nuevo_nombre_caja: Option<String>,
    pub nuevo_codigo_caja: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErpCajaOption {
    pub id: String,
    pub nombre: String,
    pub codigo: String,
    pub estado: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairLoginResult {
    pub success: bool,
    pub requiere_seleccion_caja: bool,
    pub cajas_disponibles: Option<Vec<ErpCajaOption>>,
    pub terminal_status: Option<TerminalStatus>,
}
