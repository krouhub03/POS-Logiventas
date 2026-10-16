-- =============================================================
-- Migración 0019: Gestión Integral de Cartera de Clientes (CxC) y Abonos en Caja
-- - Extensión de customers: erp_id, cupo de crédito, balance actual, bloqueo y plazos
-- - Nueva tabla customer_payments: Registro atómico de abonos a cuenta realizados en caja
-- =============================================================

ALTER TABLE customers ADD COLUMN erp_id TEXT;
ALTER TABLE customers ADD COLUMN credit_limit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN current_balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN is_credit_blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE customers ADD COLUMN notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_erp_id ON customers(erp_id) WHERE erp_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_tax_id ON customers(tax_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS customer_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folio TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    session_id INTEGER REFERENCES cash_sessions(id) ON DELETE SET NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    payment_method_id TEXT REFERENCES payment_methods(id),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    previous_balance_cents INTEGER NOT NULL,
    new_balance_cents INTEGER NOT NULL,
    reference TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_session ON customer_payments(session_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_folio ON customer_payments(folio);
