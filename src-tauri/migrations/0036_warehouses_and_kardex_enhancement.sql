-- Migración 0036: Catálogo local de bodegas y soporte multi-bodega con trazabilidad de saldos para Kardex

CREATE TABLE IF NOT EXISTS warehouses (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insertar bodega principal predeterminada para asegurar integridad referencial
INSERT OR IGNORE INTO warehouses (id, code, name, is_default, active)
VALUES ('bod-default', 'BOD-01', 'Bodega Principal', 1, 1);

-- Enriquecer inventory_movements con bodega, saldos y costo
ALTER TABLE inventory_movements ADD COLUMN warehouse_id TEXT REFERENCES warehouses(id);
ALTER TABLE inventory_movements ADD COLUMN balance_before REAL DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN balance_after REAL DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN unit_cost_cents INTEGER DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN erp_movement_id TEXT;

-- Asignar la bodega por defecto a los movimientos históricos
UPDATE inventory_movements SET warehouse_id = 'bod-default' WHERE warehouse_id IS NULL;

-- Índices de alto rendimiento para filtrado temporal y multi-bodega
CREATE INDEX IF NOT EXISTS idx_inv_mov_warehouse_created ON inventory_movements(warehouse_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_mov_created_at ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_inv_mov_product_date ON inventory_movements(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_mov_erp_id ON inventory_movements(erp_movement_id) WHERE erp_movement_id IS NOT NULL;
