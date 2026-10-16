-- =============================================================
-- Migración 0018: Soporte Local para Productos Compuestos (Combos, Packs y Recetas)
-- - parent_product_id: Producto principal/combo (products.is_bundle = 1)
-- - child_product_id: Insumo o producto individual integrante
-- - quantity: Cantidad de unidades requeridas por cada unidad de combo
-- =============================================================

CREATE TABLE IF NOT EXISTS product_components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    child_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity REAL NOT NULL CHECK(quantity > 0),
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(parent_product_id, child_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_components_parent ON product_components(parent_product_id);
CREATE INDEX IF NOT EXISTS idx_product_components_child ON product_components(child_product_id);
