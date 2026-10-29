import 'dotenv/config';
import mysql from 'mysql2/promise';
for(const key of ['DEV_DB_HOST','DEV_DB_USER','DEV_DB_PASSWORD','DEV_DB_NAME']) if(!process.env[key]) throw new Error('Falta configurar '+key);
export const dev_pool=mysql.createPool({host:process.env.DEV_DB_HOST,port:Number(process.env.DEV_DB_PORT || 3306),user:process.env.DEV_DB_USER,password:process.env.DEV_DB_PASSWORD,database:process.env.DEV_DB_NAME,connectionLimit:5,queueLimit:50,waitForConnections:true});
