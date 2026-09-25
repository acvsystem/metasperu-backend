CREATE TABLE IF NOT EXISTS inventario_pocket_receipts (
  client_scan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  payload_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  batch_id CHAR(36) CHARACTER SET ascii NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_scan_id),
  KEY idx_pocket_receipts_session_user (session_id, user_id)
) ENGINE=InnoDB;
