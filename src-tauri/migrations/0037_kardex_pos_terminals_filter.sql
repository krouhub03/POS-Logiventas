-- Migración 0037: Catálogo local de cajas POS y soporte de filtrado por Caja en Kardex

CREATE TABLE IF NOT EXISTS pos_terminals (
    id            TEXT PRIMARY KEY,
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    warehouse_id  TEXT,
    is_current    INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Enriquecer inventory_movements con trazabilidad de la caja que ejecutó el movimiento
ALTER TABLE inventory_movements ADD COLUMN caja_id TEXT;
ALTER TABLE inventory_movements ADD COLUMN caja_code TEXT;
ALTER TABLE inventory_movements ADD COLUMN caja_name TEXT;

CREATE INDEX IF NOT EXISTS idx_inv_mov_caja_created ON inventory_movements(caja_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_mov_caja_code_created ON inventory_movements(caja_code, created_at);
