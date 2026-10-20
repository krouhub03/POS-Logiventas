-- =============================================================
-- Migración 0025: Añadir configuración de licencia y plan
-- =============================================================

PRAGMA foreign_keys = ON;

-- Añade columnas para tipo de plan y fecha de expiración
ALTER TABLE settings ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'free';
ALTER TABLE settings ADD COLUMN plan_expiration TEXT; -- ISO‑8601 date (opcional)

-- Opcional: valores por defecto para bases existentes
UPDATE settings SET plan_type = 'free' WHERE plan_type IS NULL;

-- Comentario: los valores pueden ser 'free', 'pro' o 'enterprise'
