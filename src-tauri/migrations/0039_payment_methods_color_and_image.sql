-- Migración 0039: Color e imagen/logo personalizable por medio de pago (sincronizado desde ERP)
ALTER TABLE payment_methods ADD COLUMN color TEXT;
ALTER TABLE payment_methods ADD COLUMN image_url TEXT;
