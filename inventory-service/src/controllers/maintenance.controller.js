import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';

import Redis from 'ioredis';

// Inicializamos la conexión (Reutiliza la instancia que ya tienes configurada)
const redis = new Redis({
    host: '127.0.0.1',
    port: 6379
});

/** MANTENIMIENTO SECCION */

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
