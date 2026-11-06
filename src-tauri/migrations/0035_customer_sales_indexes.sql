-- =============================================================
-- Migración 0035: Índices para Consulta de Compras a Crédito y Cartera
-- Optimiza la búsqueda de ventas asociadas a clientes en el modal de CxC
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_sales_customer_created ON sales(customer_id, created_at DESC);
