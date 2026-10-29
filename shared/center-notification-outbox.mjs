import {randomUUID} from 'node:crypto';

export async function enqueueNotification(connection,key,payload) {
  await connection.execute(`INSERT INTO tb_center_notification_outbox (id,event_key,payload)
    VALUES (?,?,?) ON DUPLICATE KEY UPDATE event_key=VALUES(event_key)`,[randomUUID(),key,JSON.stringify(payload)]);
}
export async function deliverNotification(pool,publisher) {
  const connection=await pool.getConnection();let job;
  try {
    await connection.beginTransaction();
    [[job]]=await connection.query(`SELECT id,payload FROM tb_center_notification_outbox
      WHERE ((status='pending' AND next_attempt<=UTC_TIMESTAMP()) OR (status='sending' AND lease_until<UTC_TIMESTAMP()))
      AND attempts<10 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if(job)await connection.execute("UPDATE tb_center_notification_outbox SET status='sending',attempts=attempts+1,lease_token=?,lease_until=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 60 SECOND) WHERE id=?",[job.lease=randomUUID(),job.id]);
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  if(!job)return false;
  try {
    const payload=typeof job.payload==='string'?JSON.parse(job.payload):job.payload;
    await publisher.pushToEmailQueue({...payload,messageId:job.id});
    await pool.execute("UPDATE tb_center_notification_outbox SET status='sent',completed_at=UTC_TIMESTAMP() WHERE id=? AND lease_token=?",[job.id,job.lease]);
  }catch {
    await pool.execute(`UPDATE tb_center_notification_outbox SET status=IF(attempts>=10,'failed','pending'),
      next_attempt=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE) WHERE id=? AND lease_token=?`,[job.id,job.lease]);
  }
  return true;
}
