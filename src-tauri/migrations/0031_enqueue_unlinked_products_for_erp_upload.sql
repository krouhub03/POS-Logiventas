-- Migración 0031: Encolar productos locales activos sin erp_id para que se sincronicen con el ERP
UPDATE products SET needs_erp_upload = 1 WHERE erp_id IS NULL AND active = 1;
