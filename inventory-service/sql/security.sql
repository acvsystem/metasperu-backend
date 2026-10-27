-- Apply once in the inventory database before deploying auth-service + inventory-service.
CREATE TABLE IF NOT EXISTS inventory_auth_sessions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    user_id BIGINT NOT NULL,
    credential_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    INDEX ix_auth_user (user_id), INDEX ix_auth_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_scan_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    scan_id BIGINT NOT NULL, session_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
    old_quantity BIGINT NOT NULL, new_quantity BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_scan_audit (scan_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_stock_imports (
    session_id BIGINT NOT NULL PRIMARY KEY,
    payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    row_count INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Fails safely if old duplicate session codes exist: resolve them before retrying.
-- Only add when no single-column unique index already covers codigo_sesion.
SET @has_unique_code = (SELECT COUNT(*) FROM (
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_sesiones' AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = 'codigo_sesion'
) AS code_indexes);
SET @ensure_unique_code = IF(@has_unique_code > 0, 'SELECT 1',
    'ALTER TABLE inventario_sesiones ADD UNIQUE KEY uq_inventory_session_code (codigo_sesion)');
PREPARE unique_code_statement FROM @ensure_unique_code;
EXECUTE unique_code_statement;
DEALLOCATE PREPARE unique_code_statement;
