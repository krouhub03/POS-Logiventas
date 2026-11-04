-- =============================================================
-- Migración 0033: Política Offline-First permisiva para stock crítico
-- Garantiza que cuando un producto tiene pocas existencias (ej. 1 unidad),
-- el POS permita completar la venta validando contra su SQLite local sin
-- bloquearse por falta de red o desfase de sincronización con el ERP.
-- =============================================================

UPDATE settings SET value = 'permissive' WHERE key = 'offline_stock_policy' AND value = 'strict';
INSERT OR IGNORE INTO settings (key, value) VALUES ('offline_stock_policy', 'permissive');
