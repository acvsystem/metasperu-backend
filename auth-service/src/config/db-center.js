import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// Creamos el pool de conexiones
const configured = [
  'CENTER_DB_HOST',
  'CENTER_DB_USER',
  'CENTER_DB_PASSWORD',
  'CENTER_DB_NAME',
].every((key) => !!process.env[key]);
export const poolCenter = configured
  ? mysql.createPool({
      host: process.env.CENTER_DB_HOST,
      port: Number(process.env.CENTER_DB_PORT || 3306),
      user: process.env.CENTER_DB_USER,
      password: process.env.CENTER_DB_PASSWORD,
      database: process.env.CENTER_DB_NAME,
      waitForConnections: true,
      connectionLimit: 10, // Máximo de conexiones simultáneas
      queueLimit: 0,
    })
  : {
      query: async () => {
        throw new Error('Configure las credenciales del servicio Center.');
      },
      getConnection: async () => {
        throw new Error('Configure las credenciales del servicio Center.');
      },
      end: async () => {},
    };
