export async function runScheduledOnce(pool, name, task, now = new Date()) {
  const minute = now.toISOString().slice(0, 16);
  const [claim] = await pool.execute('INSERT IGNORE INTO tb_center_cron_runs (job_name,run_minute,status) VALUES (?,?,?)', [name, minute, 'running']);
  if (!claim.affectedRows) return false;
  try {
    await task();
    await pool.execute('UPDATE tb_center_cron_runs SET status=? WHERE job_name=? AND run_minute=?', ['completed', name, minute]);
    return true;
  } catch (error) {
    await pool.execute('UPDATE tb_center_cron_runs SET status=? WHERE job_name=? AND run_minute=?', ['failed', name, minute]);
    throw error;
  }
}
