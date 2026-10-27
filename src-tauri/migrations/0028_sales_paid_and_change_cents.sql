-- =============================================================
-- 0028_sales_paid_and_change_cents.sql
-- Trazabilidad exacta de monto recibido (paid_cents) y vuelto/cambio (change_cents)
-- en la cabecera de ventas, garantizando que payments.amount_cents almacene el
-- importe neto retenido en caja (Zero-Difference Cuadre).
-- =============================================================

ALTER TABLE sales ADD COLUMN paid_cents INTEGER;
ALTER TABLE sales ADD COLUMN change_cents INTEGER NOT NULL DEFAULT 0;
