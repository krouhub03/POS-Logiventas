-- =============================================================
-- Migración 0020: Extender sync_queue para admitir entidad 'customer_payment'
-- Permite encolar abonos y recaudos de cartera en la cola Outbox
-- =============================================================

CREATE TABLE IF NOT EXISTS sync_queue_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT    NOT NULL CHECK(entity_type IN ('sale', 'cash_session', 'customer', 'inventory_movement', 'customer_payment')),
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
