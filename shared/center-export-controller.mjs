import { createExportQueue } from './center-export-jobs.mjs';
import { artifactPath } from './center-export-files.mjs';
import { lstat } from 'node:fs/promises';
export function createExportController({pool,root,enabled}) {
  const queue=createExportQueue(pool);
  const endpoint=handler=>async(req,res)=>{
    if(req.user?.role!=='SISTEMAS')return res.status(403).json({message:'No tiene permiso para exportar estos reportes.'});
    try{await handler(req,res);}catch(error){res.status(error.status||503).json({message:error.status?error.message:'No se pudo procesar la exportacion.'});}
  };
  const visible=job=>({id:job.id,kind:job.kind,status:job.status,progress:job.progress,processedRows:job.processed_rows,
    errorCode:job.error_code,createdAt:job.created_at,expiresAt:job.expires_at,downloadReady:job.status==='completed'});
  return {
    create:endpoint(async(req,res)=>{
      if(!enabled||!await queue.workerReady())return res.status(503).json({message:'El procesador de exportaciones no esta disponible. Intente mas tarde.'});
      res.status(202).json(await queue.enqueue(req.user.id,req.body));
    }),
    get:endpoint(async(req,res)=>{
      const job=await queue.find(req.user.id,req.params.id);
      if(!job)return res.status(404).json({message:'Reporte no disponible o vencido.'});res.json(visible(job));
    }),
    cancel:endpoint(async(req,res)=>{
      await queue.cancel(req.user.id,req.params.id);const job=await queue.find(req.user.id,req.params.id);
      if(!job)return res.status(404).json({message:'Reporte no disponible.'});res.json(visible(job));
    }),
    download:endpoint(async(req,res)=>{
      const job=await queue.find(req.user.id,req.params.id);
      if(!job)return res.status(404).json({message:'Reporte no disponible o vencido.'});
      if(job.status!=='completed')return res.status(409).json({message:'El reporte aun no esta listo.'});
      const filename=artifactPath(root,job.id,job.artifact_key);
      const stat=await lstat(filename);if(!stat.isFile()||stat.isSymbolicLink())return res.status(404).json({message:'Archivo no disponible.'});
      res.download(filename,`${job.kind}-${job.id.slice(0,8)}.csv`,{headers:{'Cache-Control':'no-store','Content-Type':'text/csv; charset=utf-8'}},error=>{
        if(error&&!res.headersSent)res.status(404).json({message:'El archivo ya no esta disponible.'});
      });
    }),
  };
}
