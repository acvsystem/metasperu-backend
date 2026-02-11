import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';

export const createSession = async (req, res) => {
    const { tienda_id, assigned_section } = req.body;
    const userId = req.user.id;

    const sessionCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    try {

        const [result] = await pool.execute(
            'INSERT INTO inventario_sesiones (codigo_sesion, tienda_id, estado, creado_por) VALUES (?, ?, ?, ?)',
            [sessionCode, tienda_id, 'ACTIVO', userId]
        );

        if (assigned_section && assigned_section.length > 0) {
            const insertPromises = assigned_section.map((section) => {
                return pool.execute(
                    'INSERT INTO secciones_asginados (codigo_sesion, seccion_id_fk, nombre_seccion) VALUES (?, ?, ?)',
                    [
                        sessionCode,
                        section.seccion_id || null, // Si no hay ID, mandamos null, no undefined
                        section.nombre_seccion || 'Sin Nombre'
                    ]
                );
            });

            await Promise.all(insertPromises);
        }

        res.status(201).json({
            id: result.insertId,
            session_code: sessionCode,
            message: 'Sesión de inventario iniciada'
        });

    } catch (error) {
        console.error("Error en createSession:", error);
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

        if (session.length === 0) return res.status(500).json({ error: 'Sesión no válida o finalizada' });
        const sessionId = session[0].id;

        // Preparamos los datos para una sola inserción masiva (optimización SQL)
        const values = scans.map(s => [sessionId, s.sku, s.quantity, userId, s.scanned_at, s.seccion_id]);

        await pool.query(
            'INSERT INTO inventario_escaneos (sesion_id, sku, cantidad, escaneado_por, fecha_escaneo, seccion_id) VALUES ?',
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


export const getAssignedSection = async (req, res) => {
    try {
        const { session_code } = req.params;
        const query = `
            SELECT  * FROM  secciones_asginados WHERE codigo_sesion = ?;
        `;
        const [sections] = await pool.execute(query, [session_code]);

        res.json(sections);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export const getSessionSummary = async (req, res) => {
    console.log(req.params);
    const { session_code } = req.params;

    try {
        const query = `
            SELECT    s.id, s.sku, 
                SUM(s.cantidad) as total_cantidad,
                MAX(s.escaneado_por) as ultimo_escaneo,
                COUNT(s.id) as veces_escaneado,
                s.seccion_id as seccion_id,
                u.username as usuario
            FROM inventario_escaneos s
            JOIN inventario_sesiones sess ON s.sesion_id = sess.id
            JOIN usuarios u ON s.escaneado_por = u.id
            WHERE sess.codigo_sesion = ?
            GROUP BY s.id, s.sku, seccion_id, u.username
            ORDER BY ultimo_escaneo DESC
        `;

        const [summary] = await pool.execute(query, [session_code]);

        // También obtenemos info general de la sesión
        const [sessionInfo] = await pool.execute(
            `SELECT sess.tienda_id, t.nombre_tienda, sess.estado, sess.creado_por, u.username FROM inventario_sesiones sess
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
            SELECT s.codigo_sesion,s.tienda_id,t.nombre_tienda,s.creado_por,u.username,s.fecha_inicio,s.estado FROM inventario_sesiones s 
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
            `SELECT s.id, s.codigo_sesion, s.tienda_id,t.nombre_tienda, s.creado_por, u.username, 
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
    let objResponse = { success: true };

    if (session_code && serie_store) {

        const [sesion] = await pool.execute(`SELECT * FROM inventario_sesiones WHERE codigo_sesion = ?`, [session_code]);
        const invExist = ((sesion || [])[0] || {}).inventario_registrado || 0;
        console.log('getInventoryReqStore', invExist);
        if (sesion.length && invExist == 1) {
            const [inventario_store] = await pool.execute(`SELECT * FROM inventario_store WHERE cSessionCode = ?`, [session_code]);
            objResponse['codigo_sesion'] = session_code;
            objResponse['inventario'] = inventario_store;
        } else {
            getIO().to(serie_store).emit('req_inv_store', { session_code: session_code, serie: serie_store });
        }

        res.status(200).json(objResponse);
    } else {
        res.status(500).json({ error: "Error envio a socket" });
    }
}

export const postInventoryResStore = async (req, res) => {
    const dataBody = req.body;
    if (dataBody) {
        console.log(dataBody[0]['cSessionCode']);

        const data = await dataBody.map(async (d) => {
            await pool.execute(
                `INSERT INTO inventario_store (cSessionCode,cCodigoTienda,cCodigoArticulo,cReferencia,cCodigoBarra,cDescripcion,cDepartamento,
             cSeccion,cFamilia,cSubFamilia,cTalla,cColor,cStock,cTemporada,cConteo,cTotalConteo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                [d.cSessionCode, d.cCodigoTienda, d.cCodigoArticulo, d.cReferencia, d.cCodigoBarra, d.cDescripcion, d.cDepartamento,
                d.cSeccion, d.cFamilia, d.cSubFamilia, d.cTalla, d.cColor, d.cStock, d.cTemporada, d.cConteo, d.cTotalConteo]
            );
        });

        const sesion = await pool.execute(`UPDATE inventario_sesiones SET inventario_registrado = 1 WHERE codigo_sesion = ?`,
            [dataBody[0]['cSessionCode']]
        );

        Promise.all(data, sesion);

        getIO().to(dataBody[0]['cSessionCode']).emit('res_inv_store', dataBody);
    }
}

export const getInventoryResStore = async (req, res) => {
    const dataBody = req.body;
    if (dataBody) {
        console.log(dataBody[0]['cSessionCode']);
        getIO().to(dataBody[0]['cSessionCode']).emit('res_inv_store', dataBody);
    }
}


export const getPocketScan = async (req, res) => {
    try {
        const { session_code } = req.params;
        const userId = req.user.id;

        const [promiseSession] = await pool.execute('SELECT * FROM inventario_sesiones WHERE codigo_sesion = ?', [session_code]);

        const [promisePocketScan] = await pool.execute(`SELECT cantidad as quantity,fecha_escaneo as scanned_at,seccion_id,codigo_sesion as session_code,sku,estado as synced FROM 
                inventario_escaneos ie
                INNER JOIN inventario_sesiones i ON i.id = ie.sesion_id
                WHERE sesion_id = ? and escaneado_por = ?;`, [promiseSession[0]['id'], userId]);

        res.json(promisePocketScan);
    } catch (error) {
        res.status(500).json({ message: 'Error en las consultas', error });
    }
}


export const updateEndedSession = async (req, res) => {
    const { codeSession } = req.body;

    try {
        await pool.execute(
            'UPDATE inventario_sesiones SET estado = ? WHERE codigo_sesion = ?',
            ['FINALIZADO', codeSession]
        );
        res.json({ message: 'Sesion Finalizada' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

export const updateStartSession = async (req, res) => {
    const { codeSession } = req.body;

    try {
        await pool.execute(
            'UPDATE inventario_sesiones SET estado = ? WHERE codigo_sesion = ?',
            ['ACTIVO', codeSession]
        );
        res.json({ message: 'Sesion Activada' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}

export const updateConteoPocket = async (req, res) => {
    const { id, cantidad } = req.body;

    try {
        await pool.execute(
            'UPDATE inventario_escaneos SET cantidad = ? WHERE id = ?',
            [cantidad, id]
        );
        res.json({ message: 'Conteo actualizado correctamente' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
}