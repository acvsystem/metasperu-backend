import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
import Redis from 'ioredis';
import crypto from 'crypto'; // Módulo nativo de Node.js para generar el Hash

// Inicializamos la conexión a tu Redis local
const redis = new Redis({
    host: '127.0.0.1',
    port: 6379,
    // Si tu Redis tuviera contraseña, agregarías: password: 'tu_password'
});

export const createSession = async (req, res) => {
    const { tienda_id, assigned_section } = req.body;
    const userId = req.user.id;

    // --- ARQUITECTURA DE DEDUPLICACIÓN (CREATE SESSION LOCK) ---
    // Bloqueamos por la combinación de Tienda y Usuario creador.
    // Evita que el mismo usuario abra múltiples sesiones en la misma tienda en el mismo instante.
    const lockKey = `lock:session:create:${tienda_id}:${userId}`;

    try {
        // Ponemos un bloqueo de 4 segundos. Tiempo suficiente para resolver múltiples inserts
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 4);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento de creación de sesión duplicada bloqueado para usuario ${userId} en tienda ${tienda_id}`);
            return res.status(429).json({
                message: 'Ya se está procesando una solicitud de creación de sesión. Por favor, espere.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const sessionCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const [result] = await pool.execute(
            'INSERT INTO inventario_sesiones (codigo_sesion, tienda_id, estado, creado_por) VALUES (?, ?, ?, ?)',
            [sessionCode, tienda_id, 'ACTIVO', userId]
        );

        if (assigned_section && assigned_section.length > 0) {
            // Nota de optimización: Podrías cambiar esto luego a un solo INSERT masivo, 
            // pero mantenemos tus promesas actuales ejecutándose de forma segura.
            const insertPromises = assigned_section.map((section) => {
                return pool.execute(
                    'INSERT INTO secciones_asginados (codigo_sesion, seccion_id_fk, nombre_seccion) VALUES (?, ?, ?)',
                    [
                        sessionCode,
                        section.seccion_id || null,
                        section.nombre_seccion || 'Sin Nombre'
                    ]
                );
            });

            await Promise.all(insertPromises);
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // Como todo salió bien y las inserciones terminaron, borramos el bloqueo.
        await redis.del(lockKey);

        res.status(201).json({
            id: result.insertId,
            session_code: sessionCode,
            message: 'Sesión de inventario iniciada'
        });

    } catch (error) {
        // Si la base de datos falla (por ejemplo, timeout en Promise.all), 
        // limpiamos Redis para permitir que el usuario lo intente de nuevo de forma manual.
        await redis.del(lockKey);
        console.error("Error en createSession:", error);
        res.status(500).json({ message: 'Error al crear sesión', error: error.message });
    }
};

export const registerScan = async (req, res) => {
    const { session_code, sku, quantity = 1 } = req.body;
    const scannedBy = req.user.id;

    const lockKey = `lock:scan:${session_code}:${sku}:${quantity}:${scannedBy}`;
    console.log(lockKey);
    try {
        // Ponemos un bloqueo de respaldo muy corto (500 milisegundos)
        // PX indica milisegundos en lugar de segundos (EX)
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'PX', 500);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Clon de ráfaga bloqueado para SKU: ${sku}`);
            return res.status(429).json({ message: 'Evitando duplicidad por ráfaga.' });
        }

        // 1. Validar Sesión
        const [session] = await pool.execute(
            'SELECT id FROM inventario_sesiones WHERE codigo_sesion = ? AND estado = "ACTIVO"',
            [session_code]
        );

        if (session.length === 0) {
            await redis.del(lockKey); // Liberar si falla
            return res.status(404).json({ message: 'Sesión no encontrada' });
        }

        const sessionId = session[0].id;

        // 2. Insertar en MySQL
        await pool.execute(
            'INSERT INTO inventario_escaneos (sesion_id, sku, cantidad, escaneado_por) VALUES (?, ?, ?, ?)',
            [sessionId, sku, quantity, scannedBy]
        );

        // --- ¡EL TRUCO AQUÍ! ---
        // Como MySQL ya terminó de guardar, borramos el candado de inmediato.
        // El espacio queda libre para el siguiente pistoleo en el próximo milisegundo.
        await redis.del(lockKey);

        // 3. Socket.io
        req.io.to(session_code).emit('new-scan-received', { sku, quantity, scanned_at: new Date() });

        res.status(200).json({ message: 'Producto registrado correctamente' });

    } catch (error) {
        await redis.del(lockKey); // Liberar siempre en caso de error
        res.status(500).json({ message: 'Error', error: error.message });
    }
};

export const syncBulkScans = async (req, res) => {
    const { session_code, scans } = req.body; // 'scans' es un array de objetos
    const userId = req.user.id;

    if (!scans || scans.length === 0) {
        return res.status(400).json({ error: 'No se proporcionaron datos para escanear.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (REDIS LOCK) ---
    // 1. Convertimos el array de escaneos a un string único y generamos su Hash MD5
    const scansString = JSON.stringify(scans);
    const scansHash = crypto.createHash('md5').update(scansString).digest('hex');

    // 2. Creamos la clave de bloqueo única para esta ráfaga
    const lockKey = `lock:sync:${session_code}:${scansHash}`;


    try {
        // 3. Intentamos adquirir el bloqueo atómico en Redis.
        // 'NX' = Solo si no existe. 'EX' 5 = Expira automáticamente en 5 segundos.
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 5);
        console.log(lockAcquired);
        if (!lockAcquired) {
            // Si otra petición idéntica ya tomó el candado en este mismo milisegundo, la descartamos.
            console.warn(`[DEDUPLICACIÓN] Petición duplicada bloqueada para la sesión: ${session_code}`);
            return res.status(429).json({
                error: 'Esta solicitud ya está siendo procesada. Evitando registros duplicados.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [session] = await pool.execute(
            'SELECT id FROM inventario_sesiones WHERE codigo_sesion = ? AND estado = "ACTIVO"',
            [session_code]
        );

        if (session.length === 0) {
            // Si la sesión no es válida, liberamos el candado inmediatamente para no bloquear futuros envíos buenos
            await redis.del(lockKey);
            return res.status(500).json({ error: 'Sesión no válida o finalizada' });
        }

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

        console.log(`[EXITO] Guardados ${scans.length} escaneos para la sesión ${session_code}`);
        res.status(200).json({ message: 'Sincronización exitosa' });

    } catch (error) {
        // Si el proceso truena a mitad de camino por culpa de la base de datos o socket, 
        // borramos el candado de Redis para que la app móvil/malla pueda reintentar de inmediato.
        await redis.del(lockKey);
        console.error('Error crítico en syncBulkScans:', error);
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
        if (sesion.length && invExist) {
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

export const postInventoryImport = async (req, res) => {

    try {
        const dataBody = req.body;
        let mensaje = 'Inventario Registrado';
        if (dataBody) {
            console.log(dataBody[0]['cSessionCode']);

            const [getSesion] = await pool.execute(`SELECT * FROM inventario_sesiones WHERE codigo_sesion = ?`, [session_code]);
            const invExist = ((getSesion || [])[0] || {}).inventario_registrado || 0;

            if (!invExist) {
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
            } else {
                mensaje = 'Esta sesion ya tiene un inventario registrado.'
            }

            res.json({ message: mensaje });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error en las consultas', error });
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

    if (!codeSession) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (CLOSE SESSION LOCK) ---
    // Bloqueamos usando el código de la sesión para que nadie más intente alterarla en este milisegundo
    const lockKey = `lock:session:close:${codeSession}`;

    try {
        // Ponemos un bloqueo de 3 segundos
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de finalizar la sesión bloqueado: ${codeSession}`);
            return res.status(429).json({
                message: 'La sesión ya está siendo finalizada por otra solicitud en curso.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [result] = await pool.execute(
            'UPDATE inventario_sesiones SET estado = ? WHERE codigo_sesion = ?',
            ['FINALIZADO', codeSession]
        );

        // Opcional: Si el UPDATE no afectó a ninguna fila (ej. el código no existía)
        if (result.affectedRows === 0) {
            await redis.del(lockKey);
            return res.status(404).json({ message: 'No se encontró la sesión especificada.' });
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // Como el estado cambió correctamente en MySQL, liberamos el candado inmediatamente
        await redis.del(lockKey);

        res.json({ message: 'Sesion Finalizada' });

    } catch (error) {
        // Si el motor de base de datos falla, limpiamos Redis para no dejar la sesión "congelada"
        await redis.del(lockKey);
        res.status(500).json({ message: error.message });
    }
};

export const updateStartSession = async (req, res) => {
    const { codeSession } = req.body;

    if (!codeSession) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (START SESSION LOCK) ---
    // Bloqueamos usando el código de la sesión para evitar que múltiples hilos alteren el estado en paralelo
    const lockKey = `lock:session:start:${codeSession}`;

    try {
        // Ponemos un bloqueo rápido de 3 segundos
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de activar la sesión bloqueado: ${codeSession}`);
            return res.status(429).json({
                message: 'La sesión ya está siendo activada por otra solicitud en curso.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [result] = await pool.execute(
            'UPDATE inventario_sesiones SET estado = ? WHERE codigo_sesion = ?',
            ['ACTIVO', codeSession]
        );

        // Validación preventiva: Si el código de sesión enviado no existía en la BD
        if (result.affectedRows === 0) {
            await redis.del(lockKey);
            return res.status(404).json({ message: 'No se encontró la sesión especificada.' });
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // El estado en MySQL cambió a 'ACTIVO' correctamente, liberamos el candado de inmediato
        await redis.del(lockKey);

        res.json({ message: 'Sesion Activada' });

    } catch (error) {
        // En caso de un fallo en el motor de base de datos, limpiamos el lock para permitir reintentos manuales
        await redis.del(lockKey);
        res.status(500).json({ message: error.message });
    }
}


export const updateConteoPocket = async (req, res) => {
    const { id, cantidad } = req.body;

    if (!id || cantidad === undefined) {
        return res.status(400).json({ message: 'El ID del escaneo y la cantidad son requeridos.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (UPDATE COUNT LOCK) ---
    // Bloqueamos por el ID del registro de escaneo específico para evitar colisiones en el mismo segundo
    const lockKey = `lock:scan:update:${id}`;

    try {
        // Ponemos un bloqueo ultracorto de 3 segundos
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de actualizar conteo bloqueado para el ID: ${id}`);
            return res.status(429).json({
                message: 'Ya se está procesando una actualización para este registro. Por favor, espere.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [result] = await pool.execute(
            'UPDATE inventario_escaneos SET cantidad = ? WHERE id = ?',
            [cantidad, id]
        );

        // Validación preventiva: Si el ID enviado no existía en la BD
        if (result.affectedRows === 0) {
            await redis.del(lockKey);
            return res.status(404).json({ message: 'No se encontró el registro de escaneo especificado.' });
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // Como MySQL aplicó el cambio con éxito, borramos el candado de inmediato
        await redis.del(lockKey);

        res.json({ message: 'Conteo actualizado correctamente' });

    } catch (error) {
        // En caso de que falle la base de datos, limpiamos el lock para permitir reintentos legítimos
        await redis.del(lockKey);
        res.status(500).json({ message: error.message });
    }
};

export const updateCheckedRow = async (req, res) => {
    const { id, checked } = req.body;

    if (id === undefined || checked === undefined) {
        return res.status(400).json({ message: 'El ID y el estado checked son requeridos.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (ROW CHECK LOCK) ---
    // Bloqueamos por el ID de la fila específica para evitar actualizaciones paralelas en la misma celda
    const lockKey = `lock:store:check:${id}`;

    try {
        // Ponemos un bloqueo ultracorto de 2 segundos (tiempo más que suficiente para un UPDATE simple)
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 2);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de cambiar check bloqueado para el ID: ${id}`);
            return res.status(429).json({
                message: 'Se está procesando un cambio para esta fila. Por favor, espere.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [result] = await pool.execute(
            'UPDATE inventario_store SET checking = ? WHERE id = ?',
            [checked, id]
        );

        // Validación preventiva: Si el ID enviado no existía en la tabla
        if (result.affectedRows === 0) {
            await redis.del(lockKey);
            return res.status(404).json({ message: 'No se encontró el registro especificado.' });
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // El cambio se aplicó correctamente en MySQL, removemos el candado de inmediato
        await redis.del(lockKey);

        res.json({ message: 'Check Registrado' });

    } catch (error) {
        // En caso de error en la base de datos, limpiamos Redis para permitir reintentos normales
        await redis.del(lockKey);
        res.status(500).json({ message: error.message });
    }
};