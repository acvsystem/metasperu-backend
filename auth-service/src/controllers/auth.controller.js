import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { poolCenter } from '../config/db-center.js';
import { getIO } from '../config/socket.js';


export const login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ message: 'Credenciales inválidas' });

        const user = rows[0];
        console.log(password, user.password);
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ message: 'Credenciales inválidas' });

        const token = jwt.sign(
            { id: user.id, rol: user.rol },
            'una_clave_muy_segura_y_larga_123456',
            { expiresIn: '8h' }
        );

        // --- CAMBIO AQUÍ ---
        // Ya no dependemos de la cookie, pero puedes dejarla si quieres soporte híbrido.
        // Importante: En producción 'secure' debe ser true.
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: true, // Forzar true si usas HTTPS/Cloudflare
            sameSite: 'none',
            maxAge: 8 * 60 * 60 * 1000
        });

        // ENVIAR EL TOKEN EN EL JSON
        res.json({
            token: token, // <--- ESTO ES LO QUE LEERÁ ANGULAR
            user: { id: user.id, username: user.username, role: user.role }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error: error.message });
    }
};

// Esta función se ejecuta DESPUÉS del middleware verifyToken
export const checkSession = async (req, res) => {
    try {
        // req.user viene inyectado desde el middleware
        const [rows] = await pool.query('SELECT id, username, perfilname, role FROM usuarios WHERE id = ?', [req.user.id]);

        if (rows.length === 0) return res.status(404).json({ message: 'Usuario no existe' });

        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Error verificando sesión' });
    }
};

export const logout = (req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: 'Sesión cerrada correctamente' });
};


export const loginCenter = async (req, res) => {
    const { username, password } = req.body;

    try {
        const [rows] = await poolCenter.query('SELECT * FROM tb_login WHERE usuario = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ message: 'Credenciales inválidas' });

        const user = rows[0];
        console.log(user);
        const validPassword = await bcrypt.compare(password, user.PASSWORD_NW);
        if (!validPassword) return res.status(401).json({ message: 'Credenciales inválidas' });
        
        const token = jwt.sign(
            { id: user.id_login, rol: user.nivel },
            'una_clave_muy_segura_y_larga_123456',
            { expiresIn: '8h' }
        );

        // --- CAMBIO AQUÍ ---
        // Ya no dependemos de la cookie, pero puedes dejarla si quieres soporte híbrido.
        // Importante: En producción 'secure' debe ser true.
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: true, // Forzar true si usas HTTPS/Cloudflare
            sameSite: 'none',
            maxAge: 8 * 60 * 60 * 1000
        });

        // ENVIAR EL TOKEN EN EL JSON
        res.json({
            token: token, // <--- ESTO ES LO QUE LEERÁ ANGULAR
            user: { id: user.id_login, username: user.usuario, role: user.nivel }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error: error.message });
    }
};

export const checkSessionCenter = async (req, res) => {
    try {
        // req.user viene inyectado desde el middleware
        const [rows] = await poolCenter.query('SELECT id_login, usuario, email, nivel FROM usuarios WHERE id_login = ?', [req.user.id]);

        if (rows.length === 0) return res.status(404).json({ message: 'Usuario no existe' });

        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: 'Error verificando sesión' });
    }
};

export const logoutCenter = (req, res) => {
    res.clearCookie('auth_token');
    res.json({ message: 'Sesión cerrada correctamente' });
};
