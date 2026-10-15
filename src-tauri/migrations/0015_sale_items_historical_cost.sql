-- =============================================================
-- Migración 0015: Costo Histórico Unitario en Detalle de Venta
-- Guarda el costo de adquisición/promedio vigente al momento de la venta
-- para permitir devoluciones NIIF (NIC 2) precisas al Kardex.
-- =============================================================

ALTER TABLE sale_items ADD COLUMN unit_cost_cents INTEGER NOT NULL DEFAULT 0;
