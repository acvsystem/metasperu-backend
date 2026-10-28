CREATE TABLE IF NOT EXISTS tb_rrweb_sessions (
 session_id VARCHAR(64) PRIMARY KEY, owner_user_id INT NULL,
 user_name VARCHAR(120) NULL, user_role VARCHAR(80) NULL, user_store VARCHAR(80) NULL,
 page_url TEXT NULL,user_agent TEXT NULL,
 status ENUM('recording','ended') NOT NULL DEFAULT 'recording',event_count INT NOT NULL DEFAULT 0,
 started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,ended_at DATETIME NULL,last_event_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX idx_rrweb_retention (started_at),INDEX idx_rrweb_owner (owner_user_id,started_at)
);
CREATE TABLE IF NOT EXISTS tb_rrweb_event_batches (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,session_id VARCHAR(64) NOT NULL,
 sequence_number INT NOT NULL,events_count INT NOT NULL,payload_gzip_base64 LONGTEXT NOT NULL,
 payload_hash CHAR(64) NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_rrweb_sequence (session_id,sequence_number),
 CONSTRAINT fk_rrweb_event_batches_session FOREIGN KEY (session_id) REFERENCES tb_rrweb_sessions(session_id) ON DELETE CASCADE
);
