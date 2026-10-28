-- Apply once before enabling the coordinated Center auth/service release.
CREATE TABLE IF NOT EXISTS tb_center_sessions (
  session_id CHAR(36) PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_center_sessions_user (user_id, revoked_at, expires_at),
  INDEX idx_center_sessions_expiry (expires_at)
);
CREATE TABLE IF NOT EXISTS tb_center_agents (
  agent_id VARCHAR(80) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  kind ENUM('store','backup') NOT NULL,
  store_serie VARCHAR(80) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  INDEX idx_center_agent_store (store_serie)
);
CREATE TABLE IF NOT EXISTS tb_center_cron_runs (
  job_name VARCHAR(100) NOT NULL,
  run_minute CHAR(16) NOT NULL,
  status ENUM('running','completed','failed') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_name,run_minute)
);
CREATE TABLE IF NOT EXISTS tb_center_sequences (
  sequence_name VARCHAR(80) PRIMARY KEY,
  current_value BIGINT UNSIGNED NOT NULL
);
CREATE TABLE IF NOT EXISTS tb_center_transfer_requests (
  user_id INT NOT NULL,
  request_id CHAR(36) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  code_transfer VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id,request_id)
);
