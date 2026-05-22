import { pool } from '../config/db.js';


import Redis from 'ioredis';

// Inicializamos la conexión (Reutiliza la instancia existente en tu archivo)
const redis = new Redis({
    host: '127.0.0.1',
    port: 6379
});


export const storeController = {

    getTiendas: async (req, res) => {
        try {
            const [rows] = await pool.execute('SELECT * FROM tiendas');
            res.json(rows);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener tiendas', error });
        }
    },
    createTienda: async (req, res) => {
        const { serie, nombre_tienda, estado } = req.body;

        if (!serie || !nombre_tienda) {
            return res.status(400).json({ message: 'La serie y el nombre de la tienda son requeridos.' });
        }

        // --- ARQUITECTURA DE DEDUPLICACIÓN (CREATE STORE LOCK) ---
        // Bloqueamos por la "serie" de la tienda para evitar que se intente crear en paralelo
        const lockKey = `lock:tienda:create:${serie}`;

        try {
            // Ponemos un bloqueo de 4 segundos (tiempo suficiente para el INSERT + SELECT de toda la tabla)
            const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 4);

            if (!lockAcquired) {
                console.warn(`[DEDUPLICACIÓN] Intento duplicado de crear la tienda con serie [${serie}] bloqueado.`);
                return res.status(429).json({
                    message: 'Ya se está procesando la creación de esta tienda. Por favor, espere.'
                });
            }

            // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
            await pool.execute(
                'INSERT INTO tiendas (serie, nombre_tienda, estado) VALUES (?, ?, ?)',
                [serie, nombre_tienda, estado || 'ACTIVO']
            );

            // Lectura pesada protegida por el candado superior
            const [rows] = await pool.execute('SELECT * FROM tiendas');

            // --- ¡LIBERACIÓN EXITOSA! ---
            // Como los datos ya se guardaron y se leyó la tabla, removemos el candado de inmediato
            await redis.del(lockKey);

            res.status(201).json({ data: rows, message: 'Tienda creada' });

        } catch (error) {
            // Si el INSERT falla por clave duplicada a nivel SQL o la base de datos se cae,
            // limpiamos Redis para dejar el sistema libre ante correcciones manuales
            await redis.del(lockKey);

            // Manejo amigable si el error es por duplicado en MySQL
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ message: `La tienda con la serie ${serie} ya existe en el sistema.` });
            }

            res.status(500).json({ message: 'Error al crear tienda', error: error.message });
        }
    },
    updateTienda: async (req, res) => {
        const { id, serie, nombre_tienda, estado } = req.body;

        console.log(serie, nombre_tienda, estado);

        if (!id || !serie || !nombre_tienda || !estado) {
            return res.status(400).json({ message: 'Todos los campos (id, serie, nombre_tienda, estado) son requeridos.' });
        }

        // --- ARQUITECTURA DE DEDUPLICACIÓN (UPDATE STORE LOCK) ---
        // Bloqueamos por el ID de la tienda para evitar condiciones de carrera en la edición
        const lockKey = `lock:tienda:update:${id}`;

        try {
            // Ponemos un bloqueo rápido de 3 segundos (suficiente para procesar el UPDATE en MySQL)
            const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

            if (!lockAcquired) {
                console.warn(`[DEDUPLICACIÓN] Intento duplicado de actualizar la tienda con ID [${id}] bloqueado.`);
                return res.status(429).json({
                    message: 'Ya se está procesando una actualización para esta tienda. Por favor, espere.'
                });
            }

            // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
            const [result] = await pool.execute(
                'UPDATE tiendas SET serie = ?, nombre_tienda = ?, estado = ? WHERE id = ?',
                [serie, nombre_tienda, estado, id]
            );

            // Validación preventiva: Si el ID enviado no existía en la BD
            if (result.affectedRows === 0) {
                await redis.del(lockKey);
                return res.status(404).json({ message: 'No se encontró la tienda especificada para actualizar.' });
            }

            // --- ¡LIBERACIÓN EXITOSA! ---
            // Como MySQL aplicó el cambio de forma segura, removemos el candado inmediatamente
            await redis.del(lockKey);

            res.json({ message: 'Tienda actualizada correctamente' });

        } catch (error) {
            // Si el proceso truena a mitad de camino, limpiamos Redis para permitir reintentos normales
            await redis.del(lockKey);

            // Controlamos si el usuario intenta cambiar la "serie" por una que ya pertenece a otra tienda
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ message: `La serie ${serie} ya está asignada a otra tienda.` });
            }

            res.status(500).json({ message: 'Error al actualizar', error: error.message });
        }
    },
    deleteTienda: async (req, res) => {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ message: 'El ID de la tienda es requerido.' });
        }

        // --- ARQUITECTURA DE DEDUPLICACIÓN (DELETE STORE LOCK) ---
        // Bloqueamos por el ID de la tienda para que ninguna otra petición intente borrarla en este milisegundo
        const lockKey = `lock:tienda:delete:${id}`;

        try {
            // Ponemos un bloqueo rápido de 3 segundos (suficiente para la eliminación en MySQL)
            const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

            if (!lockAcquired) {
                console.warn(`[DEDUPLICACIÓN] Intento duplicado de eliminar la tienda con ID [${id}] bloqueado.`);
                return res.status(429).json({
                    message: 'Ya se está procesando la eliminación de esta tienda. Por favor, espere.'
                });
            }

            // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
            // Ejecutamos el borrado físico en la base de datos
            const [result] = await pool.execute('DELETE FROM tiendas WHERE id = ?', [id]);

            // Validación preventiva: Si el ID enviado ya no existía (quizás fue borrado por otra petición previa)
            if (result.affectedRows === 0) {
                await redis.del(lockKey);
                return res.status(404).json({ message: 'La tienda no existe o ya fue eliminada.' });
            }

            // --- ¡LIBERACIÓN EXITOSA! ---
            // Como la tienda se eliminó correctamente en MySQL, removemos el candado de inmediato
            await redis.del(lockKey);

            res.json({ message: 'Tienda eliminada' });

        } catch (error) {
            // Si el DELETE falla (por ejemplo, por restricción de clave foránea / Foreign Key), 
            // limpiamos Redis para dejar el sistema libre ante correcciones manuales
            await redis.del(lockKey);

            // Manejo amigable si no se puede borrar porque tiene registros asociados (ej. escaneos o sesiones)
            if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
                return res.status(400).json({
                    message: 'No se puede eliminar la tienda porque tiene información asociada (sesiones o escaneos activos).'
                });
            }

            res.status(500).json({ message: 'Error al eliminar', error: error.message });
        }
    }
}