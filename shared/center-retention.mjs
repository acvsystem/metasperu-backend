// Each run is bounded; deleting parents cascades only their recording batches.
export async function purgeExpiredRecordings(pool,{days=30,batchSize=100}={}) {
  if(!Number.isInteger(days)||days<7||days>365||!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw new Error('Retencion invalida.');
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows]=await connection.query(`SELECT session_id FROM tb_rrweb_sessions
      WHERE started_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY)
      AND (status='ended' OR COALESCE(last_event_at,started_at)<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY))
      ORDER BY started_at,session_id LIMIT ? FOR UPDATE SKIP LOCKED`,[days,batchSize]);
    if(rows.length)await connection.query('DELETE FROM tb_rrweb_sessions WHERE session_id IN (?)',[rows.map(row=>row.session_id)]);
    await connection.commit();return {deleted:rows.length};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
