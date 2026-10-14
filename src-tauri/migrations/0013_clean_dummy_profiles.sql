-- Migración 0013: Limpiar perfiles sintéticos no existentes y asegurar exclusión de clientes
-- No inventar perfiles como 'Operador POS' o 'Cajero POS' si no existen en la BD.
-- Desactivar cualquier registro con rol de CLIENTE.

UPDATE users 
SET erp_profile_name = NULL 
WHERE erp_profile_name = 'Operador POS' 
   OR erp_profile_name = 'Cajero POS';

UPDATE users 
SET active = 0 
WHERE erp_role_code = 'CLIENTE' 
   OR role = 'customer';

UPDATE users 
SET erp_profile_name = 'Soporte' 
WHERE erp_role_code = 'SUPERADMINSAAS';
