import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';

import Redis from 'ioredis';

// Inicializamos la conexión (Reutiliza la instancia que ya tienes configurada)
const redis = new Redis({
    host: '127.0.0.1',
    port: 6379
});


export const userController = {
    // LISTAR
    getUsers: async (req, res) => {
        try {
            const [rows] = await pool.execute('SELECT id, username, perfilname, role, estado FROM usuarios');
            res.json(rows);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },
    createUser: async (req, res) => {
        const { username, password, perfilname, role } = req.body;

        if (!username || !password || !perfilname || !role) {
            return res.status(400).json({ message: 'Todos los campos son requeridos.' });
        }

        // --- ARQUITECTURA DE DEDUPLICACIÓN (CREATE USER LOCK) ---
        // Bloqueamos por el "username" para evitar que se intente crear en paralelo o consuma CPU de más
        const lockKey = `lock:user:create:${username}`;

        try {
            // Ponemos un bloqueo de 5 segundos (tiempo prudente para el hash + insert + select)
            const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 5);

            if (!lockAcquired) {
                console.warn(`[DEDUPLICACIÓN] Intento duplicado de crear el usuario [${username}] bloqueado.`);
                return res.status(429).json({
                    message: 'Ya se está procesando el registro de este usuario. Por favor, espere.'
                });
            }

            // --- TU LÓGICA DE NEGOCIO OPTIMIZADA ---
            // 1. Encriptar contraseña (Operación costosa para el CPU, ahora protegida)
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // 2. Insertar en la base de datos
            await pool.execute(
                'INSERT INTO usuarios (username, password, perfilname, role, estado) VALUES (?, ?, ?, ?, ?)',
                [username, hashedPassword, perfilname, role, 1]
            );

            // 3. Obtener la lista actualizada
            const [rows] = await pool.execute('SELECT id, username, perfilname, role, estado FROM usuarios');

            // --- ¡LIBERACIÓN EXITOSA! ---
            // Removemos el candado de Redis inmediatamente antes de responder
            await redis.del(lockKey);

            // CORRECCIÓN DEL BUG: Enviamos una sola respuesta limpia al cliente con status 201
            return res.status(201).json({ data: rows, message: 'Usuario creado con éxito' });

        } catch (error) {
            // Si el proceso falla, limpiamos Redis de inmediato para permitir reintentos válidos
            await redis.del(lockKey);

            // Manejo controlado si el username ya está registrado en MySQL (Clave Única)
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ message: `El nombre de usuario '${username}' ya está en uso.` });
            }

            console.error("Error en createUser:", error);
            return res.status(500).json({ message: 'Error al crear usuario', error: error.message });
        }
    },

    // ACTUALIZAR
    updateUser: async (req, res) => {
        const { id, username, perfilname, role, password } = req.body;

        try {
            let query = 'UPDATE usuarios SET username = ?, perfilname = ?, role = ?';
            let params = [username, perfilname, role];

            // Si el usuario envió una nueva contraseña, la encriptamos
            if (password && password.trim() !== "") {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt);
                query += ', password = ?';
                params.push(hashedPassword);
            }

            query += ' WHERE id = ?';
            params.push(id);

            await pool.execute(query, params);
            res.json({ message: 'Usuario actualizado' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    // ELIMINAR
    deleteUser: async (req, res) => {
        const { id } = req.params;
        try {
            await pool.execute('DELETE FROM usuarios WHERE id = ?', [id]);
            res.json({ message: 'Usuario eliminado' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
};