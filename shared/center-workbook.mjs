import { Worker } from 'node:worker_threads';
let active=0;
export async function buildCenterWorkbook(libraryUrl,options) {
  if(active>=2)throw Object.assign(new Error('Hay otros archivos en proceso. Intente nuevamente.'),{status:503});
  active++;
  try {
    return await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./center-workbook-worker.mjs',import.meta.url),{
        workerData:{libraryUrl,options},resourceLimits:{maxOldGenerationSizeMb:128}});
      const fail=()=>reject(new Error('No se pudo preparar el archivo. Revise el volumen del reporte.'));
      const timer=setTimeout(()=>{void worker.terminate();fail();},20000);
      worker.once('message',message=>{clearTimeout(timer);message.ok?resolve(Buffer.from(message.buffer)):fail();});
      worker.once('error',()=>{clearTimeout(timer);fail();});
      worker.once('exit',()=>{clearTimeout(timer);fail();});
    });
  }finally{active--;}
}
