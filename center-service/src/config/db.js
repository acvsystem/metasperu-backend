import 'dotenv/config';
import mysql from 'mysql2/promise';
for (const key of ['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME']) {
  if (!process.env[key]) throw new Error('Falta configurar '+key);
}
export const pool = mysql.createPool({
  host:process.env.DB_HOST, port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER, password:process.env.DB_PASSWORD, database:process.env.DB_NAME,
  waitForConnections:true, connectionLimit:Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit:Number(process.env.DB_QUEUE_LIMIT || 100), connectTimeout:10000,
  enableKeepAlive:true, timezone:'Z',
});
