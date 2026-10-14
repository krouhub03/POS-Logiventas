-- =============================================================
-- Migración 0011: Permisos granulares de usuario sincronizados con ERP
-- Permite control de acceso por roles (RBAC) y permisos directos
-- (ej. 'pos:vender', 'inventario:ajustar', 'pos:configuracion')
-- =============================================================

ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '[]';
