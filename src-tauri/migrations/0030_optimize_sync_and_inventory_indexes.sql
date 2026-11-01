-- =============================================================
-- Migración 0030: Optimización de Índices de Alto Rendimiento para Inventario y Sincronización
-- =============================================================

-- Índice crítico para acelerar el cálculo de deltas de ventas en cola de sincronización (O(1) / O(log N) en lugar de table scan)
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items(product_id);

-- Índice crítico para devoluciones pendientes
CREATE INDEX IF NOT EXISTS idx_sale_return_items_product_id ON sale_return_items(product_id);

-- Índice compuesto para búsqueda rápida de entidades pendientes en cola de sincronización
CREATE INDEX IF NOT EXISTS idx_sync_queue_entity_status ON sync_queue(entity_type, entity_id, status);

-- Índice para acelerar filtros de inventario y stock físico
CREATE INDEX IF NOT EXISTS idx_products_active_stock ON products(active, stock, min_stock);
