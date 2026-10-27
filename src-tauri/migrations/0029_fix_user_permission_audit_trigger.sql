-- =============================================================
-- Migración 0029: Corrección de columna last_modified_by y trigger
-- de auditoría de permisos de usuarios (trg_user_permissions_audit)
-- =============================================================

ALTER TABLE users ADD COLUMN last_modified_by TEXT DEFAULT 'system';

DROP TRIGGER IF EXISTS trg_user_permissions_audit;

CREATE TRIGGER trg_user_permissions_audit
AFTER UPDATE OF permissions ON users
FOR EACH ROW
WHEN OLD.permissions IS NOT NEW.permissions
BEGIN
    INSERT INTO user_permission_audit (
        user_id, old_permissions, new_permissions, changed_by
    ) VALUES (
        OLD.id,
        COALESCE(OLD.permissions, '[]'),
        COALESCE(NEW.permissions, '[]'),
        COALESCE(NEW.last_modified_by, 'system')
    );
END;
