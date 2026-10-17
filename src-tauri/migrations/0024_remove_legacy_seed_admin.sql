-- Migración 0024: Desactivar usuario semilla local 'admin' no perteneciente al ERP
-- En un POS vinculado a una empresa, solo deben operar usuarios reales sincronizados desde el ERP (erp_user_id IS NOT NULL).

UPDATE users 
SET active = 0 
WHERE erp_user_id IS NULL 
  AND (username = 'admin' OR full_name = 'Administrador');
