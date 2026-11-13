-- Migración 0038: Reparar bodega local para sincronizar ID y nombre real del ERP
-- Segura frente a restricciones PRIMARY KEY (id), UNIQUE (code), NOT NULL (name) y FOREIGN KEY (inventory_movements.warehouse_id).

-- 1. Si existe 'bod-default' y tenemos un bodega_id real en settings distinto de 'bod-default',
--    liberamos el código 'BOD-01' en 'bod-default' para evitar colisión UNIQUE(code) al insertar la bodega real.
UPDATE warehouses
SET code = '__legacy_bod_default'
WHERE id = 'bod-default'
  AND EXISTS (
      SELECT 1 FROM settings
      WHERE key = 'bodega_id'
        AND value IS NOT NULL
        AND TRIM(value) != ''
        AND TRIM(value) != 'bod-default'
  );

-- 2. Garantizar que la bodega real de settings exista en warehouses antes de reasignar movimientos (cumple FOREIGN KEY).
INSERT OR IGNORE INTO warehouses (id, code, name, is_default, active, updated_at)
SELECT
    TRIM(s.value),
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM warehouses WHERE code = 'BOD-01') THEN 'BOD-01'
        ELSE 'BOD-' || TRIM(s.value)
    END,
    COALESCE(
        NULLIF(TRIM((SELECT value FROM settings WHERE key = 'bodega_nombre')), ''),
        'Bodega Principal'
    ),
    1,
    1,
    datetime('now')
FROM settings s
WHERE s.key = 'bodega_id'
  AND s.value IS NOT NULL
  AND TRIM(s.value) != ''
  AND TRIM(s.value) != 'bod-default';

-- 3. Reasignar los movimientos históricos que apuntaban a 'bod-default' hacia el bodega_id real.
UPDATE inventory_movements
SET warehouse_id = (SELECT TRIM(value) FROM settings WHERE key = 'bodega_id')
WHERE warehouse_id = 'bod-default'
  AND EXISTS (
      SELECT 1 FROM settings s
      JOIN warehouses w ON w.id = TRIM(s.value)
      WHERE s.key = 'bodega_id'
        AND s.value IS NOT NULL
        AND TRIM(s.value) != ''
        AND TRIM(s.value) != 'bod-default'
  );

-- 4. Limpiar 'bod-default' si ya no tiene movimientos que lo referencien.
DELETE FROM warehouses
WHERE id = 'bod-default'
  AND EXISTS (
      SELECT 1 FROM settings
      WHERE key = 'bodega_id'
        AND value IS NOT NULL
        AND TRIM(value) != ''
        AND TRIM(value) != 'bod-default'
  )
  AND NOT EXISTS (
      SELECT 1 FROM inventory_movements WHERE warehouse_id = 'bod-default'
  );
