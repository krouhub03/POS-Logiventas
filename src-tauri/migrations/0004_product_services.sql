-- =============================================================
-- Migración 0004: Soporte para Servicios vs Productos físicos
-- Permite distinguir productos físicos (control de inventario) de
-- servicios (sin control de stock físico).
-- =============================================================

ALTER TABLE products ADD COLUMN is_service INTEGER NOT NULL DEFAULT 0;
