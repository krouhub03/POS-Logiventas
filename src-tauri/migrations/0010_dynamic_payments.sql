-- Migración 0010: Medios de pago dinámicos y habilitación selectiva por terminal
-- 1. Permitir que la tabla payments admita cualquier código de medio sin restricción fija
CREATE TABLE IF NOT EXISTS payments_new (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id            INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    payment_method_id  TEXT,
    method             TEXT NOT NULL,
    amount_cents       INTEGER NOT NULL,
    reference          TEXT,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO payments_new (id, sale_id, method, amount_cents, reference, created_at)
SELECT id, sale_id, method, amount_cents, reference, created_at FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);

-- 2. Añadir columna terminal_enabled a payment_methods para que el POS decida qué medios activar localmente
ALTER TABLE payment_methods ADD COLUMN terminal_enabled INTEGER NOT NULL DEFAULT 1;
