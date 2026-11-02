-- Migración 0032: Control de idempotencia en ventas locales mediante client_tx_id único
ALTER TABLE sales ADD COLUMN client_tx_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_tx_id ON sales(client_tx_id) WHERE client_tx_id IS NOT NULL;
