-- =============================================================
-- Migración 0014: Soporte para Políticas de Stock, Combos, Tags e Impuestos Nominales
-- - controls_stock: 1 para tangibles, 0 para intangibles/servicios
-- - allow_negative_stock: 1 permite facturación offline continua
-- - is_bundle: 1 para combos/recetas cobrados atómicamente
-- - tags: micro-etiquetas para búsqueda rápida en F10 (#frio, #combo, etc.)
-- - tax_fixed_cents: impuesto nominal fijo por unidad en centavos (Bolsa plástica, ICUI, etc.)
-- =============================================================

ALTER TABLE products ADD COLUMN controls_stock INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN allow_negative_stock INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN is_bundle INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN tags TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN tax_fixed_cents INTEGER NOT NULL DEFAULT 0;

-- Sincronizar controls_stock inicial a partir del indicador previo is_service
UPDATE products SET controls_stock = 0 WHERE is_service = 1;

-- Índice para búsqueda acelerada por tags en F10
CREATE INDEX IF NOT EXISTS idx_products_tags ON products(tags);
