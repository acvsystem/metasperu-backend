import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
const zip = promisify(gzip), unzip = promisify(gunzip);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value);
const fail = (status, message) => Object.assign(new Error(message), { status });
const admin = req => { if (req.user?.role !== 'SISTEMAS') throw fail(403,'No tiene acceso a las grabaciones.'); };
function endpoint(handler) {
  return async (req,res) => {
    try { await handler(req,res); }
    catch(error) { res.status(error.status || 500).json({message:error.status ? error.message : 'No se pudo procesar la grabacion.'}); }
  };
}
function pageUrl(value) {
  try { const url=new URL(value);return (url.origin+url.pathname).slice(0,2000); } catch { return ''; }
}

export function createRecordingController(pool) {
  return {
    startSession: endpoint(async(req,res)=>{
      const {sessionId,pageUrl:page,userAgent}=req.body || {};
      if(!validId(sessionId)) throw fail(422,'Identificador de grabacion invalido.');
      await pool.execute(`INSERT IGNORE INTO tb_rrweb_sessions
        (session_id,owner_user_id,user_name,user_role,user_store,page_url,user_agent,status)
        VALUES (?,?,?,?,?,?,?,'recording')`,[sessionId,req.user.id,req.user.username,req.user.role,req.user.code_store || '',pageUrl(page),String(userAgent || '').slice(0,512)]);
      const [[session]]=await pool.execute('SELECT owner_user_id FROM tb_rrweb_sessions WHERE session_id=?',[sessionId]);
      if(Number(session?.owner_user_id)!==Number(req.user.id)) throw fail(403,'Grabacion no disponible.');
      res.status(201).json({sessionId});
    }),
    saveEvents: endpoint(async(req,res)=>{
      const {sessionId,sequenceNumber,events}=req.body || {};
      if(!validId(sessionId) || !Number.isSafeInteger(sequenceNumber) || sequenceNumber<1 ||
        !Array.isArray(events) || !events.length || events.length>100) throw fail(422,'Lote de eventos invalido.');
      const json=JSON.stringify(events);
      if(Buffer.byteLength(json)>1024*1024) throw fail(413,'Lote demasiado grande.');
      const hash=createHash('sha256').update(json).digest('hex');
      const compressed=(await zip(json)).toString('base64');
      const connection=await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [[session]]=await connection.execute('SELECT owner_user_id,event_count,status FROM tb_rrweb_sessions WHERE session_id=? FOR UPDATE',[sessionId]);
        if(Number(session?.owner_user_id)!==Number(req.user.id)) throw fail(403,'Grabacion no disponible.');
        const [[existing]]=await connection.execute('SELECT payload_hash FROM tb_rrweb_event_batches WHERE session_id=? AND sequence_number=?',[sessionId,sequenceNumber]);
        if(existing) {
          if(existing.payload_hash!==hash) throw fail(409,'El numero de lote ya contiene otros eventos.');
          await connection.commit();return res.json({count:events.length,duplicate:true});
        }
        if(session.status!=='recording') throw fail(409,'La grabacion ya termino.');
        if(Number(session.event_count)+events.length>100000) throw fail(413,'La grabacion alcanzo su limite.');
        await connection.execute('INSERT INTO tb_rrweb_event_batches (session_id,sequence_number,events_count,payload_gzip_base64,payload_hash) VALUES (?,?,?,?,?)',[sessionId,sequenceNumber,events.length,compressed,hash]);
        await connection.execute('UPDATE tb_rrweb_sessions SET event_count=event_count+?,last_event_at=UTC_TIMESTAMP() WHERE session_id=?',[events.length,sessionId]);
        await connection.commit();res.json({count:events.length,duplicate:false});
      } catch(error) { await connection.rollback();throw error; }
      finally { connection.release(); }
    }),
    endSession: endpoint(async(req,res)=>{
      const {sessionId}=req.body || {};
      if(!validId(sessionId)) throw fail(422,'Identificador invalido.');
      const [result]=await pool.execute("UPDATE tb_rrweb_sessions SET status='ended',ended_at=COALESCE(ended_at,UTC_TIMESTAMP()) WHERE session_id=? AND owner_user_id=?",[sessionId,req.user.id]);
      if(!result.affectedRows) throw fail(404,'Grabacion no disponible.');
      res.json({sessionId});
    }),
    listSessions: endpoint(async(req,res)=>{
      admin(req);const page=Number.isSafeInteger(Number(req.query.page)) ? Math.max(1,Math.min(10000,Number(req.query.page))) : 1;
      const limit=Number.isSafeInteger(Number(req.query.limit)) ? Math.max(1,Math.min(100,Number(req.query.limit))) : 25;
      const [rows]=await pool.query('SELECT session_id,user_name,user_role,user_store,page_url,status,event_count,started_at,ended_at,last_event_at FROM tb_rrweb_sessions ORDER BY started_at DESC,session_id DESC LIMIT ? OFFSET ?',[limit,(page-1)*limit]);
      const [[count]]=await pool.execute('SELECT COUNT(*) AS total FROM tb_rrweb_sessions');
      res.json({rows,page,limit,total:Number(count.total)});
    }),
    getSessionEvents: endpoint(async(req,res)=>{
      admin(req);const {sessionId}=req.params;
      if(!validId(sessionId)) throw fail(422,'Identificador invalido.');
      const after=Number(req.query.after || 0);
      if(!Number.isSafeInteger(after)||after<0) throw fail(422,'Cursor invalido.');
      const [batches]=await pool.query('SELECT id,payload_gzip_base64 FROM tb_rrweb_event_batches WHERE session_id=? AND id>? ORDER BY id ASC LIMIT 11',[sessionId,after]);
      const page=batches.slice(0,10),events=[];let bytes=0;
      for(const batch of page) {
        const payload=await unzip(Buffer.from(batch.payload_gzip_base64,'base64'),{maxOutputLength:1024*1024});
        bytes+=payload.length;if(bytes>8*1024*1024) throw fail(413,'Pagina demasiado grande.');
        events.push(...JSON.parse(payload));
      }
      res.json({sessionId,events,nextCursor:batches.length>10?page.at(-1).id:null});
    }),
  };
}
