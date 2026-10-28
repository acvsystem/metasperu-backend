import 'dotenv/config';
import { randomBytes,createHash } from 'node:crypto';
import { mkdir,writeFile,unlink } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';

const [kind,id,store,output]=process.argv.slice(2);
if(!['store','backup'].includes(kind)||!id||!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||!output||kind==='store'&&!store) {
  throw new Error('Uso: node scripts/provision-agent.js store|backup identificador serie-o-guion ruta-absoluta/.secrets/dispositivo.token');
}
const filename=path.resolve(output);
if(!path.isAbsolute(output)||!filename.split(path.sep).includes('.secrets'))throw new Error('El destino debe ser absoluto y estar dentro de una carpeta .secrets.');
const connection=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
let written=false;
try {
  if(kind==='store') {
    const [[row]]=await connection.execute('SELECT SERIE_TIENDA FROM tb_lista_tienda WHERE SERIE_TIENDA=?',[store]);
    if(!row)throw new Error('Invalid store');
  }
  const token=randomBytes(48).toString('base64url');
  await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  await writeFile(filename,token+'\n',{flag:'wx',mode:0o600});written=true;
  await connection.execute('INSERT INTO tb_center_agents (agent_id,token_hash,kind,store_serie) VALUES (?,?,?,?)',
    [id,createHash('sha256').update(token).digest('hex'),kind,kind==='store'?store:null]);
  console.info('Dispositivo registrado. Configure CENTER_AGENT_TOKEN_FILE en ese dispositivo; el token no se muestra.');
}catch{
  if(written)await unlink(filename);
  console.error('No se registro el dispositivo. Revise el identificador, tienda y archivo de destino; no se sobrescriben credenciales existentes.');process.exitCode=1;
}finally{await connection.end();}
