import { randomUUID,createHash } from 'node:crypto';

const failure=(status,message)=>Object.assign(new Error(message),{status});
const decode=value=>typeof value==='string'?JSON.parse(value):value;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
function encodeRows(rows) {
  if(!Array.isArray(rows)||rows.length>50000)throw failure(422,'Listado de empleados invalido.');
  const encoded=JSON.stringify(rows);
  if(Buffer.byteLength(encoded)>2*1024*1024)throw failure(413,'El resultado supera el limite. Reduzca el periodo de consulta.');
  return encoded;
}

/** The agent echoes a request ID; only its verified destination's owner may consume it. */
export function createAttendanceRequests(pool) {
  async function transaction(action) {
    const connection=await pool.getConnection();
    try{await connection.beginTransaction();const result=await action(connection);await connection.commit();return result;}
    catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  return {
    async saveRoster(owner,rows) {
      const encoded=encodeRows(rows);
      await pool.execute(`INSERT INTO tb_center_hr_rosters (owner_user_id,payload,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))
        ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)`,[owner,encoded]);
    },
    async begin(owner,socketId) {
      if(typeof socketId!=='string'||!socketId||socketId.length>100)throw failure(422,'Conexion de respuesta invalida.');
      return transaction(async connection=>{
        // Serialize admission across processes; never use a global array or random object keys.
        await connection.execute("INSERT INTO tb_center_sequences (sequence_name,current_value) VALUES ('hr-admission',0) ON DUPLICATE KEY UPDATE sequence_name=VALUES(sequence_name)");
        await connection.query('DELETE FROM tb_center_hr_requests WHERE expires_at<UTC_TIMESTAMP() LIMIT 100');
        await connection.query('DELETE FROM tb_center_hr_rosters WHERE expires_at<UTC_TIMESTAMP() LIMIT 100');
        const [[count]]=await connection.execute("SELECT COUNT(*) AS n FROM tb_center_hr_requests WHERE status='queued' AND expires_at>UTC_TIMESTAMP()");
        if(Number(count.n)>=20)throw failure(429,'Hay varias consultas de asistencia en proceso. Intente nuevamente en unos minutos.');
        const [[retained]]=await connection.execute('SELECT COUNT(*) AS n FROM tb_center_hr_requests WHERE expires_at>UTC_TIMESTAMP()');
        if(Number(retained.n)>=100)throw failure(429,'El almacenamiento temporal esta ocupado. Intente nuevamente en unos minutos.');
        const [[roster]]=await connection.execute('SELECT payload FROM tb_center_hr_rosters WHERE owner_user_id=? AND expires_at>UTC_TIMESTAMP()',[owner]);
        if(!roster)throw failure(409,'Espere a que termine de cargar la lista de empleados antes de consultar la asistencia.');
        const id=randomUUID();
        await connection.execute(`INSERT INTO tb_center_hr_requests (id,owner_user_id,socket_id,roster_snapshot,expires_at)
          VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))`,[id,owner,socketId,JSON.stringify(decode(roster.payload))]);
        return id;
      });
    },
    async context(owner,socketId,id) {
      if(!uuid(id))throw failure(422,'Solicitud invalida.');
      const [[request]]=await pool.execute(`SELECT roster_snapshot,status FROM tb_center_hr_requests
        WHERE id=? AND owner_user_id=? AND socket_id=? AND expires_at>UTC_TIMESTAMP()`,[id,owner,socketId]);
      if(!request)throw failure(404,'La consulta no existe o ha vencido.');
      return {roster:decode(request.roster_snapshot),status:request.status};
    },
    async complete(owner,socketId,id,rows) {
      const encoded=encodeRows(rows),hash=createHash('sha256').update(encoded).digest('hex');
      if(!uuid(id))throw failure(422,'Solicitud invalida.');
      return transaction(async connection=>{
        const [[request]]=await connection.execute(`SELECT status,result_hash FROM tb_center_hr_requests
          WHERE id=? AND owner_user_id=? AND socket_id=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE`,[id,owner,socketId]);
        if(!request)throw failure(404,'La consulta no existe o ha vencido.');
        if(request.status==='completed'){
          if(request.result_hash!==hash)throw failure(409,'La consulta ya fue completada con otro resultado.');
          return {duplicate:true};
        }
        await connection.execute("UPDATE tb_center_hr_requests SET status='completed',result=?,result_hash=? WHERE id=?",[encoded,hash,id]);
        return {duplicate:false};
      });
    },
    async read(owner,id) {
      if(!uuid(id))throw failure(422,'Solicitud invalida.');
      const [[request]]=await pool.execute(`SELECT status,result,roster_snapshot FROM tb_center_hr_requests
        WHERE id=? AND owner_user_id=? AND expires_at>UTC_TIMESTAMP()`,[id,owner]);
      if(!request)throw failure(404,'La consulta no existe o ha vencido.');
      if(request.status!=='completed')throw failure(409,'La asistencia todavia se esta preparando.');
      // Re-reading is safe: a lost HTTP response must not delete another user's result.
      return {rows:decode(request.result),roster:decode(request.roster_snapshot)};
    },
  };
}
