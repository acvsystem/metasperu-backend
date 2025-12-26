import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { getIO } from './socket.js';

dotenv.config();
const io = getIO();

// Creamos el pool de conexiones
export const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'metasperu_bd',
    waitForConnections: true,
    connectionLimit: 10, // Máximo de conexiones simultáneas
    queueLimit: 0
});

// Verificación inicial de conexión
try {
    const connection = await pool.getConnection();
    io.emit('database:conected', { conected: true, messsage: 'Conectado a la base de datos MySQL', date: new Date() });
    console.log('✅ Conectado a la base de datos MySQL');
    connection.release();
} catch (error) {
    io.emit('database:error', { error: true, messsage: error.message, date: new Date() });
    console.error('❌ Error de conexión a la base de datos:', error.message);
}