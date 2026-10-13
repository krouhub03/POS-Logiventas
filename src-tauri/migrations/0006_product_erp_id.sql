-- =============================================================
-- Migración 0006: Identificador Único de Producto para ERP
-- =============================================================

ALTER TABLE products ADD COLUMN erp_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_erp_id ON products(erp_id);
