-- =============================================================
-- Migración 0023: Devoluciones POS (Notas Crédito), Reimpresiones
-- y extensión de sync_queue para 'sale_return'
-- =============================================================

-- 1. Trazabilidad de reimpresiones y estado de devolución en sales
ALTER TABLE sales ADD COLUMN reprint_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN last_reprinted_at TEXT;
ALTER TABLE sales ADD COLUMN return_status TEXT NOT NULL DEFAULT 'none' CHECK (return_status IN ('none', 'partial', 'full'));
ALTER TABLE sales ADD COLUMN returned_cents INTEGER NOT NULL DEFAULT 0;

-- 2. Control de cantidad ya devuelta por línea de venta (anti-doble devolución)
ALTER TABLE sale_items ADD COLUMN returned_quantity REAL NOT NULL DEFAULT 0;

-- 3. Cabecera de Devoluciones / Notas Crédito POS
CREATE TABLE IF NOT EXISTS sale_returns (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    folio               TEXT    NOT NULL UNIQUE,
    sale_id             INTEGER NOT NULL REFERENCES sales(id),
    sale_folio          TEXT    NOT NULL,
    customer_id         INTEGER REFERENCES customers(id),
    user_id             INTEGER REFERENCES users(id),
    cash_session_id     INTEGER REFERENCES cash_sessions(id),
    return_type         TEXT    NOT NULL CHECK (return_type IN ('full', 'partial')),
    reason              TEXT    NOT NULL,
    refund_method       TEXT    NOT NULL CHECK (refund_method IN ('cash', 'credit_balance', 'transfer', 'other')),
    subtotal_cents      INTEGER NOT NULL,
    discount_cents      INTEGER NOT NULL DEFAULT 0,
    tax_cents           INTEGER NOT NULL DEFAULT 0,
    total_cents         INTEGER NOT NULL,
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sale_returns_sale_id ON sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_session_id ON sale_returns(cash_session_id);
CREATE INDEX IF NOT EXISTS idx_sale_returns_created_at ON sale_returns(created_at);

-- 4. Detalle de Ítems Devueltos con Destino de Inventario (Reingreso vs Merma/Avería)
CREATE TABLE IF NOT EXISTS sale_return_items (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id             INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
    sale_item_id          INTEGER NOT NULL REFERENCES sale_items(id),
    product_id            INTEGER REFERENCES products(id),
    description           TEXT    NOT NULL,
    quantity              REAL    NOT NULL CHECK (quantity > 0),
    unit_price_cents      INTEGER NOT NULL,
    unit_cost_cents       INTEGER NOT NULL DEFAULT 0,
    discount_cents        INTEGER NOT NULL DEFAULT 0,
    tax_cents             INTEGER NOT NULL DEFAULT 0,
    total_cents           INTEGER NOT NULL,
    inventory_disposition TEXT    NOT NULL DEFAULT 'restock' CHECK (inventory_disposition IN ('restock', 'merma', 'no_stock'))
);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_return ON sale_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_sale_return_items_sale_item ON sale_return_items(sale_item_id);

-- 5. Extender sync_queue para admitir 'sale_return'
CREATE TABLE IF NOT EXISTS sync_queue_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT    NOT NULL CHECK(entity_type IN ('sale', 'cash_session', 'customer', 'inventory_movement', 'customer_payment', 'sale_return')),
    entity_id   INTEGER NOT NULL,
    payload     TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_flight', 'synced', 'failed')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    synced_at   TEXT
);

INSERT INTO sync_queue_new (id, entity_type, entity_id, payload, status, attempts, last_error, created_at, synced_at)
SELECT id, entity_type, entity_id, payload, status, attempts, last_error, created_at, synced_at FROM sync_queue;

DROP TABLE sync_queue;
ALTER TABLE sync_queue_new RENAME TO sync_queue;

CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created ON sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
