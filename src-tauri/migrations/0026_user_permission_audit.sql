-- =============================================================
-- Migración 0026: Auditoría de cambios de permisos de usuarios
-- =============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_permission_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    old_permissions TEXT NOT NULL,
    new_permissions TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    changed_by TEXT NOT NULL -- usuario o proceso que efectuó el cambio
);

-- Trigger que registra cualquier UPDATE a la columna permissions de users
CREATE TRIGGER IF NOT EXISTS trg_user_permissions_audit
AFTER UPDATE OF permissions ON users
FOR EACH ROW
BEGIN
    INSERT INTO user_permission_audit (
        user_id, old_permissions, new_permissions, changed_by
    ) VALUES (
        OLD.id,
        OLD.permissions,
        NEW.permissions,
        COALESCE(NEW.last_modified_by, 'system')
    );
END;
