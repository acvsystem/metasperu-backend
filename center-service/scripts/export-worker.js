import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pool } from '../src/config/db.js';
import { createExportQueue } from '../../shared/center-export-jobs.mjs';
import { prepareExportDirectory } from '../../shared/center-export-files.mjs';
import { runExportThread } from '../../shared/center-export-runner.mjs';
import { reportCenterError } from '../../shared/center-diagnostics.mjs';

if(process.env.ENABLE_EXPORT_WORKER!=='true')throw new Error('Configure ENABLE_EXPORT_WORKER=true en el proceso trabajador.');
const root=process.env.CENTER_EXPORT_DIR;
await prepareExportDirectory(root);
const queue=createExportQueue(pool),workerId='exports:'+randomUUID(),abort=new AbortController();let stopping=false,lastPrune=0,shutdownDeadline;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  if(stopping)return;stopping=true;abort.abort();
  shutdownDeadline=setTimeout(()=>process.exit(1),15000);shutdownDeadline.unref();
});
await queue.heartbeat(workerId);
const heartbeat=setInterval(()=>void queue.heartbeat(workerId).catch(error=>reportCenterError('exports.heartbeat',error)),10000);
try {
  while(!stopping){
    try {
      const job=await queue.claim();
      if(job){
        try{await runExportThread(job,root,{signal:abort.signal});}catch{
          // On shutdown the persisted lease is reclaimed by the next worker, preserving retryability.
          if(!stopping)await pool.execute("UPDATE tb_center_export_jobs SET status='failed',error_code='EXPORT_FAILED' WHERE id=? AND status='running' AND lease_token=?",[job.id,job.lease]);
        }
      }else await delay(1000);
      if(Date.now()-lastPrune>60000){await queue.prune(root);lastPrune=Date.now();}
    }catch(error){reportCenterError('exports.worker',error);await delay(2000);}
  }
}finally{clearInterval(heartbeat);try{await pool.execute('DELETE FROM tb_center_worker_heartbeats WHERE worker_id=?',[workerId]);}finally{await pool.end();clearTimeout(shutdownDeadline);}}
