-- =============================================================
-- Migración 0005: Cola de Sincronización Transaccional (Outbox) y Parámetros
-- =============================================================

CREATE TABLE sync_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT    NOT NULL CHECK(entity_type IN ('sale', 'cash_session', 'customer', 'inventory_movement')),
    entity_id   INTEGER NOT NULL,
    payload     TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_flight', 'synced', 'failed')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    synced_at   TEXT
);

CREATE INDEX idx_sync_queue_status_created ON sync_queue(status, created_at);
CREATE INDEX idx_sync_queue_entity ON sync_queue(entity_type, entity_id);

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('critical_stock_threshold', '2'),
    ('offline_stock_policy', 'strict'),
    ('last_sync_timestamp', ''),
    ('sync_interval_seconds', '10');
