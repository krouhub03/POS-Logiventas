-- =============================================================
-- Migración 0017: Seguridad Local contra Fuerza Bruta en PIN
-- Añade failed_pin_attempts y locked_until para bloquear
-- intentos sucesivos inválidos de PIN en la terminal local
-- =============================================================

ALTER TABLE users ADD COLUMN failed_pin_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
