import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
import { createPocketSync } from '../services/pocket-sync.js';

const sync = createPocketSync(pool, (code, scans) => getIO().to(code).emit('update_totals', {
    count: scans.length, last_scans: scans.slice(-5)
}));

export async function syncBulkScans(req, res) {
    try {
        res.json(await sync(req.body?.session_code, req.user.id, req.body?.scans));
    } catch (error) {
        console.error('Pocket sync:', error.message);
        res.status(error.status || 500).json({ error: error.status ? error.message : 'No se pudo confirmar el lote. Reintente la sincronizacion.' });
    }
}

export async function getPocketPerformance(req, res) {
    try {
        const [[user]] = await pool.query('SELECT role FROM usuarios WHERE id = ?', [req.user.id]);
        if (!['administrador', 'auditor'].includes(user?.role)) return res.status(403).json({ message: 'Acceso restringido.' });
        const [[session]] = await pool.query('SELECT id FROM inventario_sesiones WHERE codigo_sesion = ?', [req.params.session_code]);
        if (!session) return res.status(404).json({ message: 'Sesion no encontrada.' });
        const cte = `WITH ordered AS (
            SELECT id, escaneado_por AS user_id, seccion_id, sku, cantidad, fecha_escaneo,
                LAG(fecha_escaneo) OVER (PARTITION BY escaneado_por ORDER BY fecha_escaneo, id) AS previous_at,
                LAG(seccion_id) OVER (PARTITION BY escaneado_por ORDER BY fecha_escaneo, id) AS previous_section
            FROM inventario_escaneos WHERE sesion_id = ?
        ), timed AS (
            SELECT *, CASE WHEN previous_section = seccion_id AND TIMESTAMPDIFF(SECOND, previous_at, fecha_escaneo) BETWEEN 0 AND 300
                THEN TIMESTAMPDIFF(SECOND, previous_at, fecha_escaneo) ELSE 0 END AS active_seconds FROM ordered
        )`;
        const metrics = `COUNT(*) AS scans, COALESCE(SUM(t.cantidad), 0) AS units, COUNT(DISTINCT t.sku) AS unique_skus,
            DATE_FORMAT(MIN(t.fecha_escaneo), '%Y-%m-%d %H:%i:%s') AS first_scan,
            DATE_FORMAT(MAX(t.fecha_escaneo), '%Y-%m-%d %H:%i:%s') AS last_scan,
            COALESCE(TIMESTAMPDIFF(SECOND, MIN(t.fecha_escaneo), MAX(t.fecha_escaneo)), 0) AS elapsed_seconds,
            COALESCE(SUM(t.active_seconds), 0) AS active_seconds,
            COUNT(CASE WHEN t.previous_section IS NULL OR t.previous_section <> t.seccion_id THEN 1 END) AS visits`;
        const [users] = await pool.query(`${cte} SELECT t.user_id, COALESCE(u.username, CONCAT('Usuario ', t.user_id)) AS username,
            COUNT(DISTINCT t.seccion_id) AS subzones_count, ${metrics}
            FROM timed t LEFT JOIN usuarios u ON u.id = t.user_id GROUP BY t.user_id, u.username ORDER BY scans DESC`, [session.id]);
        const requestedUser = Number(req.query.userId || users[0]?.user_id || 0);
        if (!Number.isSafeInteger(requestedUser) || requestedUser < 0) return res.status(400).json({ message: 'Usuario invalido.' });
        const [sections] = requestedUser ? await pool.query(`${cte} SELECT t.seccion_id,
            sa.seccion_id_fk AS subzone_id,
            COALESCE(ze.nombre_zona, 'Sin zona') AS zone_name,
            COALESCE(sa.nombre_seccion, 'Sin subzona') AS subzone_name, ${metrics}
            FROM timed t
            LEFT JOIN secciones_asginados sa ON sa.id = t.seccion_id
            LEFT JOIN zonas_seccion zs ON zs.seccion_id_fk = sa.seccion_id_fk
            LEFT JOIN zonas_escaneos ze ON ze.zona_id = zs.zona_id_fk
            WHERE t.user_id = ?
            GROUP BY t.seccion_id, sa.seccion_id_fk, ze.nombre_zona, sa.nombre_seccion
            ORDER BY first_scan`, [session.id, requestedUser]) : [[]];
        res.json({ users, sections, selectedUserId: requestedUser, inactivitySeconds: 300 });
    } catch (error) {
        console.error('Pocket performance:', error.message);
        res.status(500).json({ message: 'No se pudo obtener el rendimiento.' });
    }
}
