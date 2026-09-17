import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';

import Redis from 'ioredis';

// Inicializamos la conexión (Reutiliza la instancia que ya tienes configurada)
const redis = new Redis({
    host: '127.0.0.1',
    port: 6379
});

/** MANTENIMIENTO SECCION */

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
    const { session_code, seccion_id } = req.body;

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
    sa.codigo_sesion = ? AND sa.seccion_id_fk = ?
GROUP BY 
    sa.seccion_id_fk, 
    sa.nombre_seccion;`,
            [session_code, seccion_id]
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
