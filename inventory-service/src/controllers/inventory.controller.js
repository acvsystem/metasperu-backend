import { pool } from '../config/db.js';

export const createSession = async (req, res) => {
    const { store_name } = req.body;
    const userId = req.user.id; // Obtenido del middleware de auth

    // Generar código único de 6 caracteres (ej: A7B2X9)
    const sessionCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    try {
        const [result] = await pool.execute(
            'INSERT INTO inventory_sessions (session_code, store_name, created_by) VALUES (?, ?, ?)',
            [sessionCode, store_name, userId]
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
        const values = scans.map(s => [sessionId, s.sku, s.quantity, userId, s.scanned_at]);

        await db.query(
            'INSERT INTO inventario_escaneos (sesion_id, sku, cantidad, escaneado_por, fecha_escaneo) VALUES ?',
            [values]
        );

        // Notificamos al Dashboard que llegaron nuevos datos
        req.io.to(session_code).emit('bulk-scan-sync', {
            count: scans.length,
            last_scans: scans.slice(-5) // enviamos los últimos 5 para previsualización
        });

        res.status(200).json({ message: 'Sincronización exitosa' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getSessionSummary = async (req, res) => {
    const { session_code } = req.params;

    try {
        const query = `
            SELECT 
                s.sku, 
                SUM(s.quantity) as total_cantidad,
                MAX(s.scanned_at) as ultimo_escaneo,
                COUNT(s.id) as veces_escaneado
            FROM inventory_scans s
            JOIN inventory_sessions sess ON s.session_id = sess.id
            WHERE sess.session_code = ?
            GROUP BY s.sku
            ORDER BY ultimo_escaneo DESC
        `;

        const [summary] = await pool.execute(query, [session_code]);

        // También obtenemos info general de la sesión
        const [sessionInfo] = await db.execute(
            'SELECT store_name, status, created_at FROM inventory_sessions WHERE session_code = ?',
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