import { open } from 'node:fs/promises';
import { artifactPath,csvCell,removeOwnedArtifact } from './center-export-files.mjs';
const reports={
  transfers:{table:'tb_head_traspasos',key:'ID_TRASPASOS',first:0,columns:['CODIGO_TRASPASO','UNIDAD_SERVICIO','TIENDA_ORIGEN','TIENDA_DESTINO','CODIGO_ALM_ORIGEN','CODIGO_ALM_DESTINO','DATETIME']},
  recordings:{table:'tb_rrweb_sessions',key:'session_id',first:'',columns:['session_id','user_name','user_role','user_store','started_at','ended_at','status','event_count']},
};
export async function renderExport({pool,root,job}) {
  const spec=reports[job.kind];if(!spec)throw new Error('Invalid report');
  const filename=artifactPath(root,job.id,job.lease),file=await open(filename,'wx',0o600);
  try {
    const filter=job.kind==='transfers'?'WHERE CODIGO_TRASPASO LIKE ? OR TIENDA_ORIGEN LIKE ? OR TIENDA_DESTINO LIKE ?':'WHERE session_id LIKE ? OR user_name LIKE ? OR user_store LIKE ?';
    const values=Array(3).fill(`%${job.parameters.q||''}%`);
    const [[snapshot]]=await pool.query(`SELECT MAX(${spec.key}) AS last_id,COUNT(*) AS n FROM ${spec.table} ${filter}`,values);
    if(Number(snapshot.n)>1000000)throw Object.assign(new Error('Report too large'),{code:'EXPORT_TOO_LARGE'});
    let bytes=0,processed=0,cursor=spec.first;
    await file.write('\ufeff'+spec.columns.map(csvCell).join(',')+'\r\n');
    while(snapshot.last_id!==null) {
      const [[state]]=await pool.execute('SELECT j.status,j.lease_token,u.NIVEL AS role FROM tb_center_export_jobs j JOIN tb_login u ON u.ID_LOGIN=j.owner_user_id WHERE j.id=?',[job.id]);
      if(state?.status!=='running'||state.lease_token!==job.lease||state.role!=='SISTEMAS')throw Object.assign(new Error('Cancelled'),{code:'CANCELLED'});
      // Parentheses ensure OR filters cannot escape the cursor.
      const [batch]=await pool.query(`SELECT ${[...new Set([spec.key,...spec.columns])].join(',')} FROM ${spec.table}
        WHERE (${filter.slice(6)}) AND ${spec.key}>? AND ${spec.key}<=? ORDER BY ${spec.key} LIMIT 500`,[...values,cursor,snapshot.last_id]);
      if(!batch.length)break;
      const csv=batch.map(row=>spec.columns.map(column=>csvCell(row[column])).join(',')).join('\r\n')+'\r\n';
      bytes+=Buffer.byteLength(csv);if(bytes>100*1024*1024)throw Object.assign(new Error('Report too large'),{code:'EXPORT_TOO_LARGE'});
      await file.write(csv);processed+=batch.length;cursor=batch.at(-1)[spec.key];
      const [lease]=await pool.execute(`UPDATE tb_center_export_jobs SET processed_rows=?,progress=?,lease_until=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 60 SECOND)
        WHERE id=? AND status='running' AND lease_token=?`,[processed,Math.min(99,Math.floor(processed/Math.max(Number(snapshot.n),1)*100)),job.id,job.lease]);
      if(!lease.affectedRows)throw Object.assign(new Error('Cancelled'),{code:'CANCELLED'});
    }
    await file.close();
    const [published]=await pool.execute("UPDATE tb_center_export_jobs SET status='completed',progress=100,artifact_key=?,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?",[job.lease,job.id,job.lease]);
    if(!published.affectedRows)throw Object.assign(new Error('Cancelled'),{code:'CANCELLED'});
    return {rows:processed};
  }catch(error){
    await file.close().catch(()=>{});await removeOwnedArtifact(root,job.id,job.lease);
    await pool.execute("UPDATE tb_center_export_jobs SET status=?,error_code=?,lease_until=NULL WHERE id=? AND status='running' AND lease_token=?",[error.code==='CANCELLED'?'cancelled':'failed',error.code==='EXPORT_TOO_LARGE'?'EXPORT_TOO_LARGE':'EXPORT_FAILED',job.id,job.lease]);
    throw error;
  }
}
