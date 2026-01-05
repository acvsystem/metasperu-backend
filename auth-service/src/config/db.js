import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { getIO } from './socket.js';

dotenv.config();

// Creamos el pool de conexiones
export const pool = mysql.createPool({
    host: process.env.DB_HOST || '192.168.0.9',
    user: process.env.DB_USER || 'dbserver',
    password: process.env.DB_PASSWORD || 'J4s0nd34d$$',
    database: process.env.DB_NAME || 'metasperu_bd',
    waitForConnections: true,
    connectionLimit: 10, // Máximo de conexiones simultáneas
    queueLimit: 0
});

// Verificación inicial de conexión
try {
    const connection = await pool.getConnection();
    console.log('✅ Conectado a la base de datos MySQL');
    connection.release();
} catch (error) {
    console.error('❌ Error de conexión a la base de datos:', error.message);
}