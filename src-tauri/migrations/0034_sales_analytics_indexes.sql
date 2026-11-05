-- =============================================================
-- Migración 0034: Índices analíticos para Inteligencia y Reportes de Ventas
-- Optimiza consultas por rango de fechas, estado de venta, cajero y métodos de pago
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_status_created_at ON sales(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_user_created_at ON sales(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_sale_method ON payments(sale_id, method);
