-- =============================================================
-- Migración 0012: Perfiles funcionales y métricas de acceso en caja
-- Permite proyectar el perfil real del ERP (ej. "Gerente de Tienda",
-- "Vendedor Mostrador", "Administrador") en lugar de forzar "Cajero",
-- y registrar frecuencia de logins para acceso rápido con avatar.
-- =============================================================

CREATE TABLE IF NOT EXISTS pos_profiles (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT
);

ALTER TABLE users ADD COLUMN erp_profile_name TEXT;
ALTER TABLE users ADD COLUMN erp_role_code    TEXT;
ALTER TABLE users ADD COLUMN last_login_at    TEXT;
ALTER TABLE users ADD COLUMN login_count      INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_login_count ON users(login_count DESC);
