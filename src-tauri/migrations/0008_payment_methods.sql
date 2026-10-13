-- Tabla de medios de pago sincronizados con el ERP Megalider
CREATE TABLE IF NOT EXISTS payment_methods (
    id                TEXT PRIMARY KEY,
    code              TEXT NOT NULL UNIQUE,
    erp_code          TEXT NOT NULL,
    name              TEXT NOT NULL,
    type              TEXT NOT NULL,
    puc_code          TEXT,
    puc_account_id    TEXT,
    puc_account_name  TEXT,
    active            INTEGER NOT NULL DEFAULT 1,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_code ON payment_methods(code);

-- Semilla por defecto con PUC NIIF estándar para modo offline inicial
INSERT OR IGNORE INTO payment_methods (id, code, erp_code, name, type, puc_code, puc_account_id, puc_account_name, active)
VALUES
('pm_cash', 'cash', 'EFECTIVO', 'Efectivo M/N', 'EFECTIVO', '110505', '5bb6595f-9143-4bb9-b7d2-fbab5c5d4d08', 'CAJA GENERAL', 1),
('pm_card', 'card', 'TARJETA', 'Tarjeta Débito / Crédito', 'TARJETA', '111005', '25a186c6-28a9-4220-b0d8-7c1e0f648539', 'BANCOLOMBIAN CUENTA MONEDA NACIONAL', 1),
('pm_transfer', 'transfer', 'TRANSFERENCIA', 'Transferencia Bancaria', 'BANCO', '111005', '25a186c6-28a9-4220-b0d8-7c1e0f648539', 'BANCOLOMBIAN CUENTA MONEDA NACIONAL', 1);
