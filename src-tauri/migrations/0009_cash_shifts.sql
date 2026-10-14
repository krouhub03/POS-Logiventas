-- Migración 0009: Campos extendidos para control de turnos de caja y arqueo Z-Report
ALTER TABLE cash_sessions ADD COLUMN folio TEXT;
ALTER TABLE cash_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE cash_sessions ADD COLUMN erp_turno_id TEXT;
ALTER TABLE cash_sessions ADD COLUMN declared_cents INTEGER;
ALTER TABLE cash_sessions ADD COLUMN difference_cents INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_folio ON cash_sessions(folio);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions(status);
