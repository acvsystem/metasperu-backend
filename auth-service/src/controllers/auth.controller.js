import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';


export const login = async (req, res) => {

    const { username, password } = req.body;

    try {
        // 1. Buscar usuario
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE usuario = ?', [username]);

        if (rows.length === 0) return res.status(401).json({ message: 'Credenciales inválidas' });

        const user = rows[0];

        // 2. Verificar password
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(401).json({ message: 'Credenciales inválidas' });
        
        // 3. Generar JWT
        const token = jwt.sign(
            { id: user.id, rol: user.rol },
            'una_clave_muy_segura_y_larga_123456',
            { expiresIn: '8h' }
        );

        // 4. Configurar Cookie Segura (PWA compliant)
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: 'development' === 'production',
            sameSite: 'strict',
            maxAge: 8 * 60 * 60 * 1000 // 8 horas
        });

        // 5. Notificar via Socket.io (Opcional: Registro de auditoría en tiempo real)
        //const io = getIO();
        //io.emit('user:logged', { username: user.usuario, time: new Date() });

        res.json({
            user: { id: user.id, nombre: user.nombre, rol: user.rol }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error: error });
    }
};

// Esta función se ejecuta DESPUÉS del middleware verifyToken
export const checkSession = async (req, res) => {
    try {
        // req.user viene inyectado desde el middleware
        const [rows] = await pool.query('SELECT id, usuario, nombre, rol FROM usuarios WHERE id = ?', [req.user.id]);

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