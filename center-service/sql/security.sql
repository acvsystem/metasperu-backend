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
CREATE TABLE IF NOT EXISTS tb_center_export_jobs (
  id CHAR(36) PRIMARY KEY,owner_user_id INT NOT NULL,
  kind VARCHAR(40) NOT NULL,parameters JSON NOT NULL,payload_hash CHAR(64) NOT NULL,
  status ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0,processed_rows INT NOT NULL DEFAULT 0,
  lease_token CHAR(36) NULL,lease_until DATETIME NULL,artifact_key CHAR(36) NULL,
  error_code VARCHAR(40) NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  INDEX idx_center_export_queue (status,lease_until,created_at),
  INDEX idx_center_export_owner (owner_user_id,created_at)
);
CREATE TABLE IF NOT EXISTS tb_center_export_attempts (
  job_id CHAR(36) NOT NULL,artifact_key CHAR(36) NOT NULL,
  PRIMARY KEY (job_id,artifact_key),
  FOREIGN KEY (job_id) REFERENCES tb_center_export_jobs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tb_center_worker_heartbeats (
  worker_id VARCHAR(80) PRIMARY KEY,last_seen DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS tb_center_hr_rosters (
  owner_user_id INT PRIMARY KEY,payload JSON NOT NULL,expires_at DATETIME NOT NULL,
  INDEX idx_center_roster_expiry (expires_at)
);
CREATE TABLE IF NOT EXISTS tb_center_hr_requests (
  id CHAR(36) PRIMARY KEY,owner_user_id INT NOT NULL,socket_id VARCHAR(100) NOT NULL,
  status ENUM('queued','completed') NOT NULL DEFAULT 'queued',
  roster_snapshot JSON NOT NULL,result JSON NULL,result_hash CHAR(64) NULL,
  expires_at DATETIME NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_center_hr_owner (owner_user_id,expires_at),
  INDEX idx_center_hr_expiry (expires_at)
);
