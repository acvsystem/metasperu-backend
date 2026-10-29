import { createHash,randomUUID } from 'node:crypto';
import { isUuid,removeOwnedArtifact } from './center-export-files.mjs';
export function validateExport(body={}) {
  if(!['transfers','recordings'].includes(body.kind)||body.q!==undefined&&(typeof body.q!=='string'||body.q.length>120))throw Object.assign(new Error('Tipo de reporte o filtro invalido.'),{status:422});
  return {kind:body.kind,parameters:{q:String(body.q||'').trim()}};
}
export function createExportQueue(pool) {
  return {
    async enqueue(owner,body) {
      const {kind,parameters}=validateExport(body),id=body.requestId||randomUUID();
      if(!isUuid(id))throw Object.assign(new Error('Identificador invalido.'),{status:422});
      const encoded=JSON.stringify(parameters),hash=createHash('sha256').update(kind+encoded).digest('hex');
      const connection=await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute("INSERT INTO tb_center_sequences (sequence_name,current_value) VALUES ('exports-admission',0) ON DUPLICATE KEY UPDATE sequence_name=VALUES(sequence_name)");
        const [[existing]]=await connection.execute('SELECT owner_user_id,payload_hash FROM tb_center_export_jobs WHERE id=? FOR UPDATE',[id]);
        if(existing){
          if(Number(existing.owner_user_id)!==Number(owner)||existing.payload_hash!==hash)throw Object.assign(new Error('Identificador ya utilizado.'),{status:409});
          await connection.commit();return {id};
        }
        const [[count]]=await connection.execute("SELECT COUNT(*) AS n FROM tb_center_export_jobs WHERE status IN ('queued','running') AND expires_at>UTC_TIMESTAMP()");
        if(count.n>=10)throw Object.assign(new Error('Hay varios reportes en proceso. Intente en unos minutos.'),{status:429});
        await connection.execute(`INSERT INTO tb_center_export_jobs (id,owner_user_id,kind,parameters,payload_hash,expires_at)
          VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))`,[id,owner,kind,encoded,hash]);
        await connection.commit();return {id};
      }catch(error){await connection.rollback();throw error;}finally{connection.release();}
    },
    async find(owner,id) {
      if(!isUuid(id))return null;
      const [[job]]=await pool.execute(`SELECT id,kind,status,progress,processed_rows,error_code,artifact_key,created_at,expires_at
        FROM tb_center_export_jobs WHERE id=? AND owner_user_id=? AND expires_at>UTC_TIMESTAMP()`,[id,owner]);
      return job||null;
    },
    async cancel(owner,id) {
      if(!isUuid(id))return;
      await pool.execute("UPDATE tb_center_export_jobs SET status='cancelled' WHERE id=? AND owner_user_id=? AND status IN ('queued','running')",[id,owner]);
    },
    async claim() {
      const connection=await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(`UPDATE tb_center_export_jobs j SET status='failed',error_code='EXPORT_RETRY_LIMIT'
          WHERE status='running' AND lease_until<UTC_TIMESTAMP()
          AND (SELECT COUNT(*) FROM tb_center_export_attempts a WHERE a.job_id=j.id)>=3`);
        const [[job]]=await connection.query(`SELECT id,owner_user_id,kind,parameters FROM tb_center_export_jobs
          WHERE (status='queued' OR (status='running' AND lease_until<UTC_TIMESTAMP())) AND expires_at>UTC_TIMESTAMP()
          ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if(!job){await connection.commit();return null;}
        const lease=randomUUID();
        await connection.execute("UPDATE tb_center_export_jobs SET status='running',lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 60 SECOND),progress=0 WHERE id=?",[lease,job.id]);
        await connection.execute('INSERT INTO tb_center_export_attempts (job_id,artifact_key) VALUES (?,?)',[job.id,lease]);
        await connection.commit();return {...job,lease,parameters:typeof job.parameters==='string'?JSON.parse(job.parameters):job.parameters};
      }catch(error){await connection.rollback();throw error;}finally{connection.release();}
    },
    async heartbeat(workerId) {
      await pool.execute(`INSERT INTO tb_center_worker_heartbeats (worker_id,last_seen) VALUES (?,UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE last_seen=UTC_TIMESTAMP()`,[workerId]);
    },
    async workerReady() {
      const [[row]]=await pool.execute("SELECT 1 AS ready FROM tb_center_worker_heartbeats WHERE worker_id LIKE 'exports:%' AND last_seen>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 SECOND) LIMIT 1");
      return Boolean(row);
    },
    async prune(root) {
      const [jobs]=await pool.query("SELECT id FROM tb_center_export_jobs WHERE expires_at<UTC_TIMESTAMP() ORDER BY expires_at LIMIT 25");
      for(const job of jobs){
        const [attempts]=await pool.execute('SELECT artifact_key FROM tb_center_export_attempts WHERE job_id=?',[job.id]);
        for(const attempt of attempts)await removeOwnedArtifact(root,job.id,attempt.artifact_key);
        await pool.execute('DELETE FROM tb_center_export_jobs WHERE id=? AND expires_at<UTC_TIMESTAMP()',[job.id]);
      }
      await pool.execute('DELETE FROM tb_center_worker_heartbeats WHERE last_seen<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY)');
    },
  };
}
