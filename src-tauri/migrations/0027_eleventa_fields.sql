-- =============================================================
-- Migración 0027: Campos adicionales de catálogo e inventario (Eleventa / Mayorista)
-- - wholesale_price_cents: Precio de mayoreo en centavos enteros (INTEGER)
-- - max_stock: Inventario máximo sugerido (REAL)
-- =============================================================

ALTER TABLE products ADD COLUMN wholesale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (wholesale_price_cents >= 0);
ALTER TABLE products ADD COLUMN max_stock REAL NOT NULL DEFAULT 0 CHECK (max_stock >= 0);
