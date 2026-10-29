import { randomUUID } from 'node:crypto';
export function createMailPublisher({ connect, url, timeoutMs=10000, maxInFlight=20 }) {
  let connecting, connection, channel, inFlight=0,generation=0;
  async function dispose(resources) {
    let deadline;
    try {
      await Promise.race([
        Promise.allSettled(resources.filter(Boolean).map(resource=>Promise.resolve().then(()=>resource.close()))),
        new Promise(resolve=>{deadline=setTimeout(resolve,Math.min(timeoutMs,1000));})
      ]);
    }finally{clearTimeout(deadline);}
  }
  async function close() {
    const oldChannel=channel,oldConnection=connection;
    generation++;
    channel=undefined;connection=undefined;connecting=undefined;
    await dispose([oldChannel,oldConnection]);
  }
  async function ready() {
    if(channel)return channel;
    if(!connecting){
      const attempt=generation;
      connecting=(async()=>{
      if(!url||!/^amqps?:\/\//.test(url))throw new Error('Configure AMQP_URL.');
      const created=await connect(url,{timeout:timeoutMs});
      created.on('error',()=>{});
      if(attempt!==generation){await dispose([created]);throw new Error('Conexion cancelada.');}
      connection=created;
      created.on('close',()=>{if(attempt===generation){channel=undefined;connecting=undefined;}});
      const confirmed=await created.createConfirmChannel();
      confirmed.on('error',()=>{});
      if(attempt!==generation){await dispose([confirmed,created]);throw new Error('Conexion cancelada.');}
      channel=confirmed;
      confirmed.on('close',()=>{if(attempt===generation){channel=undefined;connecting=undefined;}});
      await confirmed.assertQueue('email_queue',{durable:true});
      if(attempt!==generation)throw new Error('Conexion cancelada.');
      return confirmed;
    })().catch(async()=>{if(attempt===generation)await close();throw new Error('No se pudo conectar con la cola de correo.');});
    }
    return connecting;
  }
  return {
    async pushToEmailQueue(data) {
      if(!data?.email||!data?.subject||!data?.template)throw new Error('Correo incompleto.');
      if(inFlight>=maxInFlight)throw new Error('La cola de correo esta ocupada. Intente mas tarde.');
      const payload=Buffer.from(JSON.stringify({to:data.email,subject:data.subject,template:data.template,context:data.variables,archivo:data.archivo}));
      if(payload.length>10*1024*1024)throw new Error('Adjunto demasiado grande.');
      inFlight++;
      let timeout;
      try {
        // Bounds connect, assert, broker acknowledgement AND socket backpressure.
        await Promise.race([
          (async()=>{
            const current=await ready();
            await new Promise((resolve,reject)=>{
              let confirmed=false,drained=false;
              const cleanup=()=>{current.off('close',failed);current.off('error',failed);current.off('drain',onDrain);};
              const done=()=>{if(confirmed&&drained){cleanup();resolve();}};
              const failed=()=>{cleanup();reject(new Error('No se pudo confirmar el correo.'));};
              const onDrain=()=>{drained=true;done();};
              current.once('close',failed);current.once('error',failed);current.once('drain',onDrain);
              try {
                const writable=current.sendToQueue('email_queue',payload,{persistent:true,messageId:randomUUID(),contentType:'application/json'},
                  error=>{if(error)return failed();confirmed=true;done();});
                if(writable){drained=true;done();}
              }catch{failed();}
            });
          })(),
          new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('No se pudo confirmar el correo dentro del tiempo limite.')),timeoutMs);})
        ]);
        return {queued:true};
      }catch(error){await close();throw new Error('No se pudo confirmar el correo. Revise la cola antes de reenviar.');}
      finally{clearTimeout(timeout);inFlight--;}
    },close,
  };
}
