-- =============================================================
-- Migración 0016: Catálogo Maestro de Etiquetas (Tags) de Producto
-- Cada etiqueta tiene un nombre único y un color_hex representativo.
-- =============================================================

CREATE TABLE IF NOT EXISTS product_tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    color_hex   TEXT NOT NULL DEFAULT '#6366f1',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Semillas predeterminadas de etiquetas comerciales
INSERT OR IGNORE INTO product_tags (name, color_hex) VALUES 
('Oferta', '#ef4444'),
('Frío', '#3b82f6'),
('Promo 2x1', '#f97316'),
('Más Vendido', '#f59e0b'),
('Vegano / Orgánico', '#10b981'),
('Premium', '#8b5cf6'),
('Combo', '#ec4899'),
('Importado', '#64748b');
