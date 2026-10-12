-- =============================================================
-- Logiventa POS - Esquema inicial (v1)
-- Convenciones:
--   * Importes monetarios en CENTAVOS (INTEGER) para evitar errores de redondeo.
--   * Cantidades en REAL para permitir venta a granel (kg, litros).
--   * Tasas de impuesto en puntos base (1600 = 16.00 %).
--   * Fechas en texto ISO-8601 UTC (datetime('now')).
-- =============================================================

CREATE TABLE users (
    id          INTEGER PRIMARY KEY,
    username    TEXT    NOT NULL UNIQUE,
    full_name   TEXT    NOT NULL,
    pin_hash    TEXT,
    role        TEXT    NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'manager', 'cashier')),
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL UNIQUE,
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE products (
    id            INTEGER PRIMARY KEY,
    sku           TEXT    NOT NULL UNIQUE,
    barcode       TEXT    UNIQUE,
    name          TEXT    NOT NULL,
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit          TEXT    NOT NULL DEFAULT 'pza',
    price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
    cost_cents    INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
    tax_rate_bp   INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
    stock         REAL    NOT NULL DEFAULT 0,
    min_stock     REAL    NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_products_name ON products(name);

CREATE TABLE customers (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL,
    tax_id      TEXT,
    email       TEXT,
    phone       TEXT,
    address     TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cash_sessions (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    opened_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    closed_at       TEXT,
    opening_cents   INTEGER NOT NULL DEFAULT 0,
    closing_cents   INTEGER,
    expected_cents  INTEGER,
    notes           TEXT
);

CREATE TABLE sales (
    id               INTEGER PRIMARY KEY,
    folio            TEXT    NOT NULL UNIQUE,
    customer_id      INTEGER REFERENCES customers(id),
    user_id          INTEGER REFERENCES users(id),
    cash_session_id  INTEGER REFERENCES cash_sessions(id),
    subtotal_cents   INTEGER NOT NULL,
    discount_cents   INTEGER NOT NULL DEFAULT 0,
    tax_cents        INTEGER NOT NULL DEFAULT 0,
    total_cents      INTEGER NOT NULL,
    status           TEXT    NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled', 'pending')),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sales_created_at ON sales(created_at);

CREATE TABLE sale_items (
    id                INTEGER PRIMARY KEY,
    sale_id           INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id        INTEGER REFERENCES products(id),
    description       TEXT    NOT NULL,
    quantity          REAL    NOT NULL CHECK (quantity > 0),
    unit_price_cents  INTEGER NOT NULL,
    discount_cents    INTEGER NOT NULL DEFAULT 0,
    tax_cents         INTEGER NOT NULL DEFAULT 0,
    total_cents       INTEGER NOT NULL
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE payments (
    id            INTEGER PRIMARY KEY,
    sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method        TEXT    NOT NULL CHECK (method IN ('cash', 'card', 'transfer', 'other')),
    amount_cents  INTEGER NOT NULL,
    reference     TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE inventory_movements (
    id          INTEGER PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    kind        TEXT    NOT NULL CHECK (kind IN ('sale', 'purchase', 'adjustment', 'return')),
    quantity    REAL    NOT NULL,
    reference   TEXT,
    user_id     INTEGER REFERENCES users(id),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_inventory_product ON inventory_movements(product_id);

CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
    ('business_name', 'Mi Negocio'),
    ('currency', 'MXN'),
    ('default_tax_rate_bp', '1600');

INSERT INTO users (username, full_name, role) VALUES ('admin', 'Administrador', 'admin');
