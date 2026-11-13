-- Migración 0038: Reparar bodega local para sincronizar ID y nombre real del ERP
-- Si la bodega local tiene id 'bod-default' pero en settings ya existe bodega_id y bodega_nombre,
-- actualizar la bodega y los movimientos locales.

UPDATE inventory_movements 
SET warehouse_id = (SELECT value FROM settings WHERE key = 'bodega_id')
WHERE warehouse_id = 'bod-default' 
  AND (SELECT value FROM settings WHERE key = 'bodega_id') IS NOT NULL 
  AND (SELECT value FROM settings WHERE key = 'bodega_id') != '';

UPDATE warehouses 
SET id = (SELECT value FROM settings WHERE key = 'bodega_id'),
    name = (SELECT value FROM settings WHERE key = 'bodega_nombre'),
    updated_at = datetime('now')
WHERE id = 'bod-default' 
  AND (SELECT value FROM settings WHERE key = 'bodega_id') IS NOT NULL 
  AND (SELECT value FROM settings WHERE key = 'bodega_id') != '';
