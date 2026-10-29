import { Worker } from 'node:worker_threads';
export function runExportThread(job,root,{signal,createWorker=options=>new Worker(new URL('../center-service/src/workers/export-thread.js',import.meta.url),options)}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('Export interrupted'));
    const worker=createWorker({workerData:{job,root},resourceLimits:{maxOldGenerationSizeMb:256}});
    let settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(deadline);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>{void worker.terminate();finish(new Error('Export interrupted'));};
    const deadline=setTimeout(()=>{void worker.terminate();finish(new Error('Export timeout'));},5*60*1000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',message=>finish(message?.ok?undefined:new Error('Export failed')));
    worker.once('error',()=>finish(new Error('Export worker failed')));
    worker.once('exit',()=>{if(!settled)finish(new Error('Export worker exited without a result'));});
  });
}
