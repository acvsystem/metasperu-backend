import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
export const createSession = async (req, res) => {
    const { tienda_id } = req.body;
    const userId = req.user.id; // Obtenido del middleware de auth

    // Generar código único de 6 caracteres (ej: A7B2X9)
    const sessionCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    try {
        const [result] = await pool.execute(
            'INSERT INTO inventario_sesiones (codigo_sesion, tienda_id,estado, creado_por) VALUES (?, ?, ?, ?)',
            [sessionCode, tienda_id, 'ACTIVO', userId]
        );

        res.status(201).json({
            id: result.insertId,
            session_code: sessionCode,
            message: 'Sesión de inventario iniciada'
        });
    } catch (error) {
        res.status(500).json({ message: 'Error al crear sesión', error: error.message });
    }
};

export const registerScan = async (req, res) => {
    const { session_code, sku, quantity = 1 } = req.body;
    const scannedBy = req.user.id; // ID del usuario del Pocket (desde el token)

    try {
        // 1. Buscamos el ID de la sesión usando el código único
        const [session] = await pool.execute(
            'SELECT id FROM inventario_sesiones WHERE codigo_sesion = ? AND estado = "ACTIVO"',
            [session_code]
        );

        if (session.length === 0) {
            return res.status(404).json({ message: 'Sesión no encontrada o ya está cerrada' });
        }

        const sessionId = session[0].id;

        // 2. Insertamos el escaneo en la base de datos
        await pool.execute(
            'INSERT INTO inventario_escaneos (sesion_id, sku, cantidad, escaneado_por) VALUES (?, ?, ?, ?)',
            [sessionId, sku, quantity, scannedBy]
        );

        // 3. ¡MAGIA! Notificamos al Dashboard en tiempo real a través de Socket.io
        // Enviamos el aviso solo a la "sala" (room) que tiene el nombre del código de sesión
        req.io.to(session_code).emit('new-scan-received', {
            sku,
            quantity,
            scanned_at: new Date(),
            user: req.user.nombre // Para saber quién lo escaneó en el dashboard
        });

        res.status(200).json({ message: 'Producto registrado correctamente' });

    } catch (error) {
        res.status(500).json({ message: 'Error al registrar escaneo', error: error.message });
    }



};

export const syncBulkScans = async (req, res) => {

    const { session_code, scans } = req.body; // 'scans' es un array de objetos
    const userId = req.user.id;
    try {
        const [session] = await pool.execute(
            'SELECT id FROM inventario_sesiones WHERE codigo_sesion = ? AND estado = "ACTIVO"',
            [session_code]
        );

        if (session.length === 0) return res.status(404).json({ message: 'Sesión no válida' });
        const sessionId = session[0].id;

        // Preparamos los datos para una sola inserción masiva (optimización SQL)
        const values = scans.map(s => [sessionId, s.sku, s.quantity, 1, s.scanned_at]);

        await pool.query(
            'INSERT INTO inventario_escaneos (sesion_id, sku, cantidad, escaneado_por, fecha_escaneo) VALUES ?',
            [values]
        );

        // Notificamos al Dashboard que llegaron nuevos datos
        getIO().to(session_code).emit('update_totals', {
            count: scans.length,
            last_scans: scans.slice(-5) // enviamos los últimos 5 para previsualización
        });
        console.log(values);
        res.status(200).json({ message: 'Sincronización exitosa' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getSessionSummary = async (req, res) => {
    console.log(req.params);
    const { session_code } = req.params;

    try {
        const query = `
            SELECT     s.sku, 
                SUM(s.cantidad) as total_cantidad,
                MAX(s.escaneado_por) as ultimo_escaneo,
                COUNT(s.id) as veces_escaneado
            FROM inventario_escaneos s
            JOIN inventario_sesiones sess ON s.sesion_id = sess.id
            WHERE sess.codigo_sesion = ?
            GROUP BY s.sku
            ORDER BY ultimo_escaneo DESC
        `;

        const [summary] = await pool.execute(query, [session_code]);

        // También obtenemos info general de la sesión
        const [sessionInfo] = await pool.execute(
            `SELECT sess.tienda_id, t.nombre_tienda, sess.estado, sess.creado_por, usuario FROM inventario_sesiones sess
             INNER JOIN tiendas t ON t.id = sess.tienda_id
             INNER JOIN usuarios u ON u.id = sess.creado_por
             WHERE codigo_sesion = ?`,
            [session_code]
        );

        res.status(200).json({
            session: sessionInfo[0],
            products: summary
        });

    } catch (error) {
        res.status(500).json({ message: 'Error al obtener el resumen', error: error.message });
    }
};

export const getStores = async (req, res) => {
    try {
        // Seleccionamos id y nombre de la tabla tiendas
        const [rows] = await pool.query('SELECT id, serie, nombre_tienda FROM tiendas ORDER BY nombre_tienda ASC');

        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


export const getSessions = async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT s.codigo_sesion,s.tienda_id,t.nombre_tienda,s.creado_por,u.usuario,s.fecha_inicio,s.estado FROM inventario_sesiones s 
            INNER JOIN tiendas t on t.id = s.tienda_id
            INNER JOIN usuarios u on u.id = s.creado_por
            ORDER BY s.fecha_inicio DESC;
        `);

        res.json(rows);
    } catch (error) {
        res.status(500).json({
            message: 'Error al obtener las sesiones',
            error: error.message
        });
    }
};


// Listar sesiones activas para retomar
export const getActiveSessions = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.id, s.codigo_sesion, s.tienda_id,t.nombre_tienda, s.creado_por, u.usuario, 
            (SELECT COUNT(DISTINCT sku) FROM inventario_escaneos e WHERE e.id = s.id) as total_skus
            FROM inventario_sesiones s 
            INNER JOIN tiendas t on t.id = s.tienda_id
            INNER JOIN usuarios u on u.id = s.creado_por
            WHERE s.estado = 'ACTIVO' 
            ORDER BY s.creado_por DESC`
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


export const getInventoryReqStore = async (req, res) => {
    const { session_code, serie_store } = req.query;
        console.log(req.query);
    if (session_code && serie_store) {
        getIO().to(session_code).emit('req_inv_store', { session_code: session_code, serie: serie_store });

        res.status(200).json({
            success: true
        });
    } else {
        res.status(500).json({ error: "Error envio a socket" });
    }
}

export const getInventoryResStore = async (req, res) => {
    const { session_code } = req.body;
    if (session_code) {
        getIO().to(session_code).emit('res_inv_store', { session_code: session_code });
    }
}
