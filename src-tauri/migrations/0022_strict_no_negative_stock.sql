-- Deshabilitar ventas sin stock en todos los productos físicos y compuestos
UPDATE products
SET allow_negative_stock = 0,
    controls_stock = CASE WHEN is_service = 1 THEN 0 ELSE 1 END;
