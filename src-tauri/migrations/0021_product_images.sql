-- Migración 0021: Soporte de almacenamiento y sincronización de imágenes de productos
-- Permite almacenar la referencia local (offline), la URL remota del ERP y el hash SHA-256 para evitar descargas redundantes.

ALTER TABLE products ADD COLUMN image_url TEXT;
ALTER TABLE products ADD COLUMN image_local_path TEXT;
ALTER TABLE products ADD COLUMN image_hash TEXT;
ALTER TABLE products ADD COLUMN image_sync_status TEXT DEFAULT 'none';
ALTER TABLE products ADD COLUMN image_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_products_image_hash ON products(image_hash);
CREATE INDEX IF NOT EXISTS idx_products_image_sync_status ON products(image_sync_status);
