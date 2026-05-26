import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const toNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const pool = mysql.createPool({
    host: process.env.DB_HOST || '192.168.0.9',
    user: process.env.DB_USER || 'dbserver',
    password: process.env.DB_PASSWORD || 'J4s0nd34d$$',
    database: process.env.DB_NAME || 'bd_metasperu',
    waitForConnections: true,
    connectionLimit: toNumber(process.env.DB_CONNECTION_LIMIT, 30),
    maxIdle: toNumber(process.env.DB_MAX_IDLE, 15),
    idleTimeout: toNumber(process.env.DB_IDLE_TIMEOUT, 60000),
    queueLimit: toNumber(process.env.DB_QUEUE_LIMIT, 0),
    connectTimeout: toNumber(process.env.DB_CONNECT_TIMEOUT, 10000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

try {
    const connection = await pool.getConnection();
    console.log('Conectado a la base de datos MySQL');
    connection.release();
} catch (error) {
    console.error('Error de conexion a la base de datos:', error.message);
}
