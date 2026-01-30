import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';

export const userController = {
    // LISTAR
    getUsers: async (req, res) => {
        try {
            const [rows] = await pool.execute('SELECT id, usuario, nombre, rol, estado FROM usuarios');
            res.json(rows);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    // CREAR
    createUser: async (req, res) => {
        const { username, password, perfilname, role } = req.body;
        try {
            // Encriptar contraseña antes de guardar
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            await pool.execute(
                'INSERT INTO usuarios (usuario, password, nombre, rol, estado) VALUES (?, ?, ?, ?, ?)',
                [username, hashedPassword, perfilname, role, 1]
            );

            const [rows] = await pool.execute('SELECT id, usuario, nombre, rol, estado FROM usuarios');
            res.json(rows);

            res.status(201).json({ data: rows, message: 'Usuario creado con éxito' });
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    },

    // ACTUALIZAR
    updateUser: async (req, res) => {
        const { id, username, perfilname, role, password } = req.body;

        try {
            let query = 'UPDATE usuarios SET username = ?, email = ?, role = ?';
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