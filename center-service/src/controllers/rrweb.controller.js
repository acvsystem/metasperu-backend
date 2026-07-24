import zlib from 'zlib';
import { pool } from '../config/db.js';

let tablesReady = false;

const ensureTables = async () => {
    if (tablesReady) return;

    await pool.execute(`
        CREATE TABLE IF NOT EXISTS tb_rrweb_sessions (
            session_id VARCHAR(64) PRIMARY KEY,
            user_name VARCHAR(120) NULL,
            user_role VARCHAR(80) NULL,
            user_store VARCHAR(80) NULL,
            page_url TEXT NULL,
            user_agent TEXT NULL,
            status ENUM('recording', 'ended') NOT NULL DEFAULT 'recording',
            event_count INT NOT NULL DEFAULT 0,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ended_at DATETIME NULL,
            last_event_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    await pool.execute(`
        CREATE TABLE IF NOT EXISTS tb_rrweb_event_batches (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            session_id VARCHAR(64) NOT NULL,
            sequence_number INT NOT NULL,
            events_count INT NOT NULL,
            payload_gzip_base64 LONGTEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_rrweb_event_batches_session (session_id, sequence_number),
            CONSTRAINT fk_rrweb_event_batches_session
                FOREIGN KEY (session_id)
                REFERENCES tb_rrweb_sessions(session_id)
                ON DELETE CASCADE
        )
    `);

    tablesReady = true;
};

const compressEvents = (events) => {
    const payload = JSON.stringify(events || []);
    return zlib.gzipSync(Buffer.from(payload, 'utf8')).toString('base64');
};

const decompressEvents = (payload) => {
    const buffer = Buffer.from(payload, 'base64');
    return JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
};

export const rrwebController = {
    startSession: async (req, res) => {
        try {
            await ensureTables();

            const { sessionId, pageUrl, userAgent, metadata } = req.body;

            if (!sessionId) {
                return res.status(400).json({ message: 'sessionId es requerido' });
            }

            await pool.execute(`
                INSERT INTO tb_rrweb_sessions
                    (session_id, user_name, user_role, user_store, page_url, user_agent, status, started_at)
                VALUES (?, ?, ?, ?, ?, ?, 'recording', NOW())
                ON DUPLICATE KEY UPDATE
                    page_url = VALUES(page_url),
                    user_agent = VALUES(user_agent),
                    status = 'recording',
                    updated_at = NOW()
            `, [
                sessionId,
                metadata?.userName || req.user?.username || null,
                metadata?.role || req.user?.role || null,
                metadata?.store || null,
                pageUrl || null,
                userAgent || null
            ]);

            res.json({ message: 'Sesion rrweb iniciada', sessionId });
        } catch (error) {
            console.error('Error iniciando sesion rrweb:', error);
            res.status(500).json({ message: 'Error al iniciar sesion rrweb', error: error.message });
        }
    },

    saveEvents: async (req, res) => {
        try {
            await ensureTables();

            const { sessionId, sequenceNumber, events } = req.body;

            if (!sessionId || !Array.isArray(events) || events.length === 0) {
                return res.status(400).json({ message: 'sessionId y events son requeridos' });
            }

            const compressedPayload = compressEvents(events);

            await pool.execute(`
                INSERT INTO tb_rrweb_sessions (session_id, status, started_at)
                VALUES (?, 'recording', NOW())
                ON DUPLICATE KEY UPDATE updated_at = NOW()
            `, [sessionId]);

            await pool.execute(`
                INSERT INTO tb_rrweb_event_batches
                    (session_id, sequence_number, events_count, payload_gzip_base64)
                VALUES (?, ?, ?, ?)
            `, [
                sessionId,
                Number(sequenceNumber) || 0,
                events.length,
                compressedPayload
            ]);

            await pool.execute(`
                UPDATE tb_rrweb_sessions
                SET event_count = event_count + ?,
                    last_event_at = NOW(),
                    updated_at = NOW()
                WHERE session_id = ?
            `, [events.length, sessionId]);

            res.json({ message: 'Eventos rrweb guardados', count: events.length });
        } catch (error) {
            console.error('Error guardando eventos rrweb:', error);
            res.status(500).json({ message: 'Error al guardar eventos rrweb', error: error.message });
        }
    },

    endSession: async (req, res) => {
        try {
            await ensureTables();

            const { sessionId } = req.body;

            if (!sessionId) {
                return res.status(400).json({ message: 'sessionId es requerido' });
            }

            await pool.execute(`
                UPDATE tb_rrweb_sessions
                SET status = 'ended',
                    ended_at = NOW(),
                    updated_at = NOW()
                WHERE session_id = ?
            `, [sessionId]);

            res.json({ message: 'Sesion rrweb finalizada', sessionId });
        } catch (error) {
            console.error('Error finalizando sesion rrweb:', error);
            res.status(500).json({ message: 'Error al finalizar sesion rrweb', error: error.message });
        }
    },

    listSessions: async (_req, res) => {
        try {
            await ensureTables();

            const [sessions] = await pool.execute(`
                SELECT session_id, user_name, user_role, user_store, page_url, status,
                    event_count, started_at, ended_at, last_event_at
                FROM tb_rrweb_sessions
                ORDER BY started_at DESC
                LIMIT 100
            `);

            res.json(sessions);
        } catch (error) {
            console.error('Error listando sesiones rrweb:', error);
            res.status(500).json({ message: 'Error al listar sesiones rrweb', error: error.message });
        }
    },

    getSessionEvents: async (req, res) => {
        try {
            await ensureTables();

            const { sessionId } = req.params;
            const [batches] = await pool.execute(`
                SELECT payload_gzip_base64
                FROM tb_rrweb_event_batches
                WHERE session_id = ?
                ORDER BY sequence_number ASC, id ASC
            `, [sessionId]);

            const events = batches.flatMap(batch => decompressEvents(batch.payload_gzip_base64));

            res.json({ sessionId, events });
        } catch (error) {
            console.error('Error obteniendo eventos rrweb:', error);
            res.status(500).json({ message: 'Error al obtener eventos rrweb', error: error.message });
        }
    }
};
