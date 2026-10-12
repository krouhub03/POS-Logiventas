-- =============================================================
-- Migración 0002: Vinculación de Terminal con ERP y soporte de usuarios extendido
-- =============================================================

ALTER TABLE users ADD COLUMN erp_user_id TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_erp_id ON users(erp_user_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('erp_url', 'http://localhost:3000'),
    ('pairing_status', 'unpaired'),
    ('terminal_token', ''),
    ('caja_id', ''),
    ('caja_nombre', ''),
    ('caja_codigo', ''),
    ('empresa_id', ''),
    ('empresa_nombre', ''),
    ('empresa_nit', '');
