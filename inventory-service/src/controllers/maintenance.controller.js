import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
import { lockStore as redis } from '../utils/lock-store.js';

/** MANTENIMIENTO SECCION */

const normalizeName = (value = '') => value.toString().trim().toUpperCase();

const buildRangeNames = ({ prefix, start, end }) => {
    const normalizedPrefix = normalizeName(prefix).replace(/\s+/g, '');
    const startNumber = Number.parseInt(start, 10);
    const endNumber = Number.parseInt(end, 10);

    if (!normalizedPrefix || !/^[A-Z]+$/.test(normalizedPrefix)) {
        throw new Error('La letra/prefijo del rango es requerido y solo debe contener letras.');
    }

    if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber) || startNumber <= 0 || endNumber <= 0) {
        throw new Error('El inicio y fin del rango deben ser números positivos.');
    }

    if (startNumber > endNumber) {
        throw new Error('El inicio del rango no puede ser mayor al fin.');
    }

    if ((endNumber - startNumber) > 1000) {
        throw new Error('El rango máximo permitido es de 1001 subzonas por operación.');
    }

    return Array.from({ length: endNumber - startNumber + 1 }, (_, index) => `${normalizedPrefix}${startNumber + index}`);
};

const getSectionNamesFromBody = (body = {}) => {
    if (Array.isArray(body.sections) && body.sections.length) {
        return [...new Set(body.sections.map(normalizeName).filter(Boolean))];
    }

    if (body.mode === 'range') {
        return buildRangeNames(body);
    }

    const singleName = normalizeName(body.nombre_seccion || body.name);
    return singleName ? [singleName] : [];
};

const ensureSectionsExist = async (connection, names = []) => {
    const uniqueNames = [...new Set(names.map(normalizeName).filter(Boolean))];
    if (!uniqueNames.length) return { sections: [], createdCount: 0 };

    const [existingRows] = await connection.query(
        `SELECT seccion_id, nombre_seccion
         FROM secciones_escaneos
         WHERE UPPER(nombre_seccion) IN (?)`,
        [uniqueNames]
    );

    const existingNames = new Set(existingRows.map((row) => normalizeName(row.nombre_seccion)));
    const missingNames = uniqueNames.filter((name) => !existingNames.has(name));

    if (missingNames.length) {
        await connection.query(
            `INSERT INTO secciones_escaneos (nombre_seccion) VALUES ?`,
            [missingNames.map((name) => [name])]
        );
    }

    const [sectionRows] = await connection.query(
        `SELECT seccion_id, nombre_seccion
         FROM secciones_escaneos
         WHERE UPPER(nombre_seccion) IN (?)`,
        [uniqueNames]
    );

    return {
        sections: sectionRows,
        createdCount: missingNames.length
    };
};

export const getZonasv2 = async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM zonas_escaneos;
        `);

        res.json(rows);
    } catch (error) {
        res.status(500).json({
            message: 'Error al obtener las zonas',
            error: error.message
        });
    }
};

export const postZonasv2 = async (req, res) => {
    const { nombre_zona } = req.body;

    if (!nombre_zona || nombre_zona.trim() === '') {
        return res.status(400).json({ message: 'El nombre de la zona es requerido.' });
    }

    // Normalizamos el nombre (ej. "ZONA A") para evitar bypass por sutiles diferencias de espacios o mayúsculas
    const normalizedZoneName = nombre_zona.trim().toUpperCase();

    // --- ARQUITECTURA DE DEDUPLICACIÓN (CREATE ZONA LOCK) ---
    // Bloqueamos usando el nombre de la zona como identificador único en Redis
    const lockKey = `lock:zona:create:${normalizedZoneName}`;

    try {
        // Ponemos un bloqueo rápido de 3 segundos en Redis
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de crear la zona [${normalizedZoneName}] bloqueado.`);
            return res.status(429).json({
                message: 'Ya se está procesando la creación de esta zona. Por favor, espere.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        await pool.execute(
            'INSERT INTO zonas_escaneos (nombre_zona) VALUES (?)',
            [nombre_zona]
        );

        // --- ¡LIBERACIÓN EXITOSA! ---
        // Como el insert en MySQL terminó bien, removemos el candado de inmediato
        await redis.del(lockKey);

        res.status(200).json({ message: 'Zona registrada correctamente' });

    } catch (error) {
        // Si el proceso falla por pérdida de conexión a la BD u otro motivo, limpiamos Redis
        await redis.del(lockKey);

        // Manejo controlado en caso de que ya exista un índice UNIQUE en tu BD a nivel físico
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: `La zona '${nombre_zona}' ya está registrada.` });
        }

        res.status(500).json({ message: 'Error al registrar zona', error: error.message });
    }
};


export const putZonasv2 = async (req, res) => {
    const { zona_id, nombre_zona } = req.body;

    try {
        await pool.execute(
            'UPDATE zonas_escaneos SET nombre_zona = ? WHERE zona_id = ?;',
            [nombre_zona, zona_id]
        );

        res.status(200).json({ message: 'Zona actualizada correctamente' });

    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar zona', error: error.message });
    }

};

export const putZonasSubzonas = async (req, res) => {
    const { zona_escaneo_id, zona_id, seccion_id } = req.body;
    console.log('PUT ZONAS SUBZONAS - Request Body:', req.body);

    try {
        // 1. Verificar si ya existe un registro con esa seccion_id
        const [rows] = await pool.execute(
            'SELECT zona_escaneo_id FROM zonas_seccion WHERE seccion_id_fk = ? LIMIT 1',
            [seccion_id]
        );

        if (rows.length > 0) {
            // Existe → hacemos UPDATE
            await pool.execute(
                'UPDATE zonas_seccion SET zona_id_fk = ? WHERE seccion_id_fk = ?',
                [zona_id, seccion_id]
            );

            return res.status(200).json({
                message: 'Zona actualizada correctamente',
                action: 'updated'
            });
        } else {
            // No existe → hacemos INSERT
            await pool.execute(
                'INSERT INTO zonas_seccion (zona_id_fk, seccion_id_fk) VALUES (?, ?)',
                [zona_id, seccion_id]
            );

            return res.status(201).json({
                message: 'Zona creada correctamente',
                action: 'created'
            });
        }

    } catch (error) {
        console.error('Error en putZonasSubzonas:', error);
        res.status(500).json({
            message: 'Error al procesar zona',
            error: error.message
        });
    }
};

export const getZonasSubzonas = async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT zona_escaneo_id,zona_id,seccion_id,nombre_zona,nombre_seccion FROM zonas_seccion zs
            INNER JOIN zonas_escaneos ze on ze.zona_id = zs.zona_id_fk
            RIGHT JOIN secciones_escaneos se on se.seccion_id = zs.seccion_id_fk;
        `);

        res.json(rows);
    } catch (error) {
        res.status(500).json({
            message: 'Error al obtener las secciones',
            error: error.message
        });
    }
};

export const getSections = async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT seccion_id,nombre_seccion FROM secciones_escaneos;
        `);

        res.json(rows);
    } catch (error) {
        res.status(500).json({
            message: 'Error al obtener las secciones',
            error: error.message
        });
    }
};

export const postSections = async (req, res) => {
    const { nombre_seccion } = req.body;

    if (!nombre_seccion || nombre_seccion.trim() === '') {
        return res.status(400).json({ message: 'El nombre de la sección es requerido.' });
    }

    // Normalizamos el nombre (ej. "ZONA A") para evitar bypass por sutiles diferencias de espacios o mayúsculas
    const normalizedSectionName = nombre_seccion.trim().toUpperCase();

    // --- ARQUITECTURA DE DEDUPLICACIÓN (CREATE SECTION LOCK) ---
    // Bloqueamos usando el nombre de la sección como identificador único en Redis
    const lockKey = `lock:section:create:${normalizedSectionName}`;

    try {
        // Ponemos un bloqueo rápido de 3 segundos en Redis
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de crear la sección [${normalizedSectionName}] bloqueado.`);
            return res.status(429).json({
                message: 'Ya se está procesando la creación de esta sección. Por favor, espere.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        await pool.execute(
            'INSERT INTO secciones_escaneos (nombre_seccion) VALUES (?)',
            [nombre_seccion]
        );

        // --- ¡LIBERACIÓN EXITOSA! ---
        // Como el insert en MySQL terminó bien, removemos el candado de inmediato
        await redis.del(lockKey);

        res.status(200).json({ message: 'Seccion registrada correctamente' });

    } catch (error) {
        // Si el proceso falla por pérdida de conexión a la BD u otro motivo, limpiamos Redis
        await redis.del(lockKey);

        // Manejo controlado en caso de que ya exista un índice UNIQUE en tu BD a nivel físico
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: `La sección '${nombre_seccion}' ya está registrada.` });
        }

        res.status(500).json({ message: 'Error al registrar seccion', error: error.message });
    }
};

export const postSectionsBulk = async (req, res) => {
    let sectionNames = [];

    try {
        sectionNames = getSectionNamesFromBody(req.body);
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }

    if (!sectionNames.length) {
        return res.status(400).json({ message: 'Debe indicar una subzona o un rango válido.' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        const result = await ensureSectionsExist(connection, sectionNames);
        await connection.commit();

        return res.status(200).json({
            message: `Subzonas procesadas correctamente. Creadas: ${result.createdCount}. Existentes: ${sectionNames.length - result.createdCount}.`,
            total: sectionNames.length,
            created: result.createdCount,
            existing: sectionNames.length - result.createdCount,
            sections: result.sections
        });
    } catch (error) {
        await connection.rollback();
        return res.status(500).json({ message: 'Error al registrar subzonas', error: error.message });
    } finally {
        connection.release();
    }
};

export const assignSectionsRangeToSession = async (req, res) => {
    const sessionCode = normalizeName(req.body?.session_code || req.body?.codigo_sesion);
    let sectionNames = [];

    if (!sessionCode) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    try {
        sectionNames = getSectionNamesFromBody(req.body);
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }

    if (!sectionNames.length) {
        return res.status(400).json({ message: 'Debe indicar una subzona o un rango válido.' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [sessionRows] = await connection.execute(
            `SELECT id, codigo_sesion FROM inventario_sesiones WHERE codigo_sesion = ?`,
            [sessionCode]
        );

        if (!sessionRows.length) {
            await connection.rollback();
            return res.status(404).json({ message: 'Sesión no encontrada.' });
        }

        const { sections, createdCount } = await ensureSectionsExist(connection, sectionNames);
        const [assignedRows] = await connection.execute(
            `SELECT seccion_id_fk
             FROM secciones_asginados
             WHERE codigo_sesion = ?`,
            [sessionCode]
        );
        const assignedIds = new Set(assignedRows.map((row) => Number(row.seccion_id_fk)));
        const rowsToInsert = sections
            .filter((section) => !assignedIds.has(Number(section.seccion_id)))
            .map((section) => [sessionCode, section.seccion_id, section.nombre_seccion]);

        if (rowsToInsert.length) {
            await connection.query(
                `INSERT INTO secciones_asginados (codigo_sesion, seccion_id_fk, nombre_seccion) VALUES ?`,
                [rowsToInsert]
            );
        }

        await connection.commit();

        return res.status(200).json({
            message: `Subzonas asignadas correctamente. Asignadas: ${rowsToInsert.length}. Ya asignadas: ${sections.length - rowsToInsert.length}.`,
            total: sectionNames.length,
            created: createdCount,
            assigned: rowsToInsert.length,
            alreadyAssigned: sections.length - rowsToInsert.length
        });
    } catch (error) {
        await connection.rollback();
        return res.status(500).json({ message: 'Error al asignar subzonas a la sesión', error: error.message });
    } finally {
        connection.release();
    }
};

export const delZonas = async (req, res) => {
    const { zona_id } = req.params;

    try {
        await pool.execute(
            'DELETE FROM zonas_escaneos WHERE zona_id = ?;',
            [zona_id]
        );

        res.status(200).json({ message: 'Zona eliminada correctamente' });

    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar zona', error: error.message });
    }

};


export const putSecitons = async (req, res) => {
    const { seccion_id, nombre_seccion } = req.body;

    try {
        await pool.execute(
            'UPDATE secciones_escaneos SET nombre_seccion = ? WHERE seccion_id = ?;',
            [nombre_seccion, seccion_id]
        );

        res.status(200).json({ message: 'Seccion actualizada correctamente' });

    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar seccion', error: error.message });
    }

};

export const importConteoSession = async (req, res) => {
    const { session_code, items } = req.body;
    const userIdToken = req.user?.id;

    if (!session_code) {
        return res.status(400).json({ message: 'Falta session_code' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'No se recibieron items para importar' });
    }

    if (items.length > 50000) {
        return res.status(400).json({
            message: 'Máximo 50.000 registros por importación. Divide el archivo.'
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Validar sesión
        const [sessionRows] = await connection.execute(
            `SELECT id, codigo_sesion, estado
             FROM inventario_sesiones
             WHERE codigo_sesion = ?`,
            [session_code]
        );

        if (sessionRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Sesión no encontrada' });
        }

        const sesionId = sessionRows[0].id;

        // 2. Subzonas de ESTA sesión: nombre_seccion → id (secciones_asginados)
        const [seccionesRows] = await connection.execute(
            `SELECT id, nombre_seccion
             FROM secciones_asginados
             WHERE codigo_sesion = ?`,
            [session_code]
        );

        const seccionByName = new Map();
        for (const s of seccionesRows) {
            const key = (s.nombre_seccion || '').toString().trim().toUpperCase();
            if (key) seccionByName.set(key, s.id);
        }

        // 3. Usuarios: username → id
        const [usuariosRows] = await connection.execute(
            `SELECT id, username FROM usuarios`
        );

        const userByName = new Map();
        for (const u of usuariosRows) {
            const key = (u.username || '').toString().trim().toUpperCase();
            if (key) userByName.set(key, u.id);
        }

        // 4. Armar filas
        const values = [];
        const errores = [];
        const fechaAhora = new Date(); // siempre fecha de hoy

        for (let i = 0; i < items.length; i++) {
            const item = items[i] || {};

            const sku = (item.sku ?? item.cCodigoBarra ?? item.codigo_barra ?? '')
                .toString()
                .trim();

            const cantidad = Number(item.cantidad ?? item.quantity ?? item.qty ?? 0);

            // subzona (nombre) → seccion_id
            const subzonaNombre = (
                item.subzona ??
                item.nombre_seccion ??
                item.seccion ??
                ''
            )
                .toString()
                .trim()
                .toUpperCase();

            let seccionId = null;
            if (subzonaNombre) {
                seccionId = seccionByName.get(subzonaNombre) ?? null;
                if (seccionId == null) {
                    errores.push({
                        index: i,
                        sku,
                        error: `Subzona no encontrada en la sesión: "${subzonaNombre}"`
                    });
                    continue;
                }
            }

            // usuario (username) → escaneado_por
            const usuarioNombre = (
                item.usuario ??
                item.username ??
                ''
            )
                .toString()
                .trim()
                .toUpperCase();

            let escaneadoPor = userIdToken ?? null;
            if (usuarioNombre) {
                const uid = userByName.get(usuarioNombre);
                if (uid == null) {
                    errores.push({
                        index: i,
                        sku,
                        error: `Usuario no encontrado: "${usuarioNombre}"`
                    });
                    continue;
                }
                escaneadoPor = uid;
            }

            if (!sku) {
                errores.push({ index: i, error: 'sku vacío' });
                continue;
            }
            if (!Number.isFinite(cantidad) || cantidad <= 0) {
                errores.push({ index: i, sku, error: 'cantidad inválida' });
                continue;
            }

            values.push([
                sesionId,
                sku,
                cantidad,
                escaneadoPor,
                fechaAhora,
                seccionId
            ]);
        }

        if (values.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                message: 'Ningún item válido para importar',
                errores
            });
        }

        // 5. Insert masivo por lotes
        const BATCH = 1000;
        let insertados = 0;

        for (let i = 0; i < values.length; i += BATCH) {
            const batch = values.slice(i, i + BATCH);
            await connection.query(
                `INSERT INTO inventario_escaneos
                    (sesion_id, sku, cantidad, escaneado_por, fecha_escaneo, seccion_id)
                 VALUES ?`,
                [batch]
            );
            insertados += batch.length;
        }

        await connection.commit();

        try {
            getIO().to(session_code).emit('update_totals', {
                count: insertados,
                source: 'import_conteo',
                last_scans: items.slice(-5)
            });
        } catch (socketErr) {
            console.warn('Socket emit falló (import ok):', socketErr.message);
        }

        return res.status(200).json({
            message: 'Importación de conteo exitosa',
            session_code,
            sesion_id: sesionId,
            insertados,
            omitidos: errores.length,
            errores: errores.slice(0, 50)
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error en importConteoSession:', error);
        return res.status(500).json({
            message: 'Error al importar conteo',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

export const importStoreSession = async (req, res) => {
    const { sessionCode, items } = req.body;

    // Validaciones
    if (!sessionCode) {
        return res.status(400).json({ message: 'Falta el sessionCode' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'No se recibieron items para importar' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const sql = `
            INSERT INTO inventario_store (
                cSessionCode,
                codigo_sesion,
                cCodigoTienda,
                cCodigoArticulo,
                cReferencia,
                cCodigoBarra,
                cCodigoBarra2,
                cCodigoBarra3,
                cDescripcion,
                cDepartamento,
                cSeccion,
                cFamilia,
                cSubFamilia,
                cTalla,
                cColor,
                cEsencia,
                cStyleDescription,
                cStock,
                cTemporada,
                cConteo,
                cTotalConteo,
                checking
            ) VALUES ?
        `;

        // Preparar los valores
        const values = items.map(item => [
            sessionCode,                          // cSessionCode
            sessionCode,                          // codigo_sesion
            item.cCodigoTienda || null,
            item.cCodigoArticulo || null,
            item.cReferencia || null,
            item.cCodigoBarra || null,
            item.cCodigoBarra2 || null,
            item.cCodigoBarra3 || null,
            item.cDescripcion || null,
            item.cDepartamento || null,
            item.cSeccion || null,
            item.cFamilia || null,
            item.cSubFamilia || null,
            item.cTalla || null,
            item.cColor || null,
            item.cEsencia || null,
            item.cStyleDescription || null,
            Number(item.cStock) || 0,
            item.cTemporada || '',
            Number(item.cConteo) || 0,
            Number(item.cTotalConteo) || 0,
            item.checking ?? 0
        ]);

        const BATCH = 1000;
        let insertedRows = 0;

        for (let i = 0; i < values.length; i += BATCH) {
            const batch = values.slice(i, i + BATCH);
            const [result] = await connection.query(sql, [batch]);
            insertedRows += result.affectedRows || batch.length;
        }

        await connection.execute(
            `UPDATE inventario_sesiones SET inventario_registrado = 1 WHERE codigo_sesion = ?`,
            [sessionCode]
        );

        await connection.commit();

        res.status(201).json({
            message: `Inventario importado correctamente - ${insertedRows} registros`,
            insertedRows,
            sessionCode
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error al importar inventario:', error);
        res.status(500).json({
            message: 'Error al importar el inventario',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

export const delZonaEscaneos = async (req, res) => {
    const { session_code, seccion_id } = req.body;

    // Validación básica
    if (!session_code || !seccion_id) {
        return res.status(400).json({
            message: 'Faltan session_code o seccion_id'
        });
    }

    try {
        // 1. Buscar el id de la sesión a partir del código
        const [sesiones] = await pool.execute(
            `SELECT id FROM inventario_sesiones 
             WHERE codigo_sesion = ?`,
            [session_code]
        );

        if (sesiones.length === 0) {
            return res.status(404).json({
                message: 'No se encontró ninguna sesión con ese código'
            });
        }

        const sesion_id = sesiones[0].id;

        // 2. Eliminar los registros de escaneos
        const [result] = await pool.execute(
            `DELETE FROM inventario_escaneos 
             WHERE sesion_id = ? AND seccion_id = ?`,
            [sesion_id, seccion_id]
        );

        res.status(200).json({
            message: 'Registros eliminados correctamente',
            affectedRows: result.affectedRows,
            sesion_id: sesion_id
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Error al eliminar los registros',
            error: error.message
        });
    }
};

export const delSecitons = async (req, res) => {
    const { seccion_id } = req.params;

    try {
        await pool.execute(
            'DELETE FROM secciones_escaneos WHERE seccion_id = ?;',
            [seccion_id]
        );

        res.status(200).json({ message: 'Seccion eliminada correctamente' });

    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar seccion', error: error.message });
    }

};

export const postSectionsCountSession = async (req, res) => {
    const { session_code, seccion_id } = req.body || {};
    const sectionId = Number(seccion_id);
    if (typeof session_code !== 'string' || !session_code.trim() ||
        !Number.isSafeInteger(sectionId) || sectionId <= 0) {
        return res.status(400).json({ message: 'Indique una sesion y una seccion validas.' });
    }

    try {
        const [rows] = await pool.execute(
            `SELECT 
    sa.seccion_id_fk, 
    sa.nombre_seccion,
    SUM(ie.cantidad) AS total_cantidad
FROM 
    secciones_asginados sa
INNER JOIN 
     inventario_escaneos ie ON ie.seccion_id = sa.id
WHERE 
    sa.codigo_sesion = ? AND sa.seccion_id_fk = ?
GROUP BY 
    sa.seccion_id_fk, 
    sa.nombre_seccion;`,
            [session_code.trim(), sectionId]
        );

        res.json(rows);

    } catch (error) {
        res.status(500).json({ message: 'Error al consultar', error: error.message });
    }

}

export const postSectionsGroupSession = async (req, res) => {
    const { session_code } = req.body;

    try {
        const [rows] = await pool.execute(
            `SELECT 
    sa.seccion_id_fk, 
    sa.nombre_seccion,
    SUM(ie.cantidad) AS total_cantidad
FROM 
    secciones_asginados sa
INNER JOIN 
    inventario_escaneos ie ON ie.seccion_id = sa.seccion_id_fk
WHERE 
    sa.codigo_sesion = ? 
GROUP BY 
    sa.seccion_id_fk, 
    sa.nombre_seccion;`,
            [session_code]
        );

        res.json(rows);

    } catch (error) {
        res.status(500).json({ message: 'Error al consultar', error: error.message });
    }
}
