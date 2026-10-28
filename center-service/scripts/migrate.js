import 'dotenv/config';
import mysql from 'mysql2/promise';
import { migrateCenter } from '../../shared/center-migrations.mjs';

const connection=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
try { await migrateCenter(connection);console.info('Migracion Center v1 completada.'); }
catch { console.error('No se completo la migracion. Revisar el preflight con el administrador; no activar la version.');process.exitCode=1; }
finally { await connection.end(); }
