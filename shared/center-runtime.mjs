import { isProcessEntrypoint } from './process-entrypoint.mjs';

export async function startCenterRuntime({moduleUrl,app,server,io,pools,mail,port,service}) {
  if(!isProcessEntrypoint(moduleUrl))return;
  try {
    // Fail before accepting traffic if the coordinated migration has not been applied.
    await pools[0].execute('SELECT session_id FROM tb_center_sessions LIMIT 0');
    await pools[0].execute('SELECT owner_user_id FROM tb_rrweb_sessions LIMIT 0');
  }catch{
    console.error(JSON.stringify({event:'startup.schema_missing',service}));
    await Promise.allSettled(pools.map(pool=>pool.end()));process.exitCode=1;return;
  }
  app.get('/health',(_req,res)=>res.json({status:'ok',service}));
  server.requestTimeout=30000;server.headersTimeout=35000;
  server.listen(Number(process.env.PORT||port),process.env.HOST||'127.0.0.1',()=>console.info(JSON.stringify({event:'service.ready',service})));
  let stopping=false;
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
    if(stopping)return;stopping=true;
    const deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();
    io.disconnectSockets(true);
    io.close(async()=>{
      await Promise.allSettled([...pools.map(pool=>pool.end()),mail.close()]);
      clearTimeout(deadline);process.exit(0);
    });
  });
}
