-- Migración 0007: Bandera de sincronización bidireccional de catálogo y stock POS -> ERP
ALTER TABLE products ADD COLUMN needs_erp_upload INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_needs_erp_upload ON products(needs_erp_upload);
