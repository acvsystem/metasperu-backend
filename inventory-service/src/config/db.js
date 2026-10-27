import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
  if (!process.env[key]) throw new Error('Falta configurar ' + key);
}

// Creamos el pool de conexiones
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10, // Máximo de conexiones simultáneas
  queueLimit: 0,
});
