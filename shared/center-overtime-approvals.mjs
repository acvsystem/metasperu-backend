import {lockOvertimeDocuments,dateKey,SCHEDULE_DAY_SQL} from './center-schedule-overtime.mjs';
import {enqueueNotification} from './center-notification-outbox.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const allowedStore=(user,store)=>user&&(user.allStores||user.role==='RRHH'||user.stores?.includes(store));
const defaultEmails=['itperu@metasperu.com','johnnygermano@metasperu.com','paulodosreis@metasperu.com','carlosmoron@metasperu.com'];
const asEmails=value=>value?value.split(',').map(value=>value.trim()).filter(value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)):defaultEmails;

export function createOvertimeApprovals(pool,{recipients=asEmails(process.env.CENTER_HR_NOTIFICATION_EMAILS)}={}) {
  const endpoint=action=>async(req,res)=>{
    let connection;
    try {
      connection=await pool.getConnection();await connection.beginTransaction();
      const result=await action(connection,req);await connection.commit();res.status(result.status||200).json(result.body);
    }catch(error){if(connection)await connection.rollback();res.status(error.status||500).json({success:false,message:error.status?error.message:'No se pudo procesar la autorizacion.'});}
    finally{connection?.release();}
  };
  return {
    list:async(req,res)=>{
      try {
        const user=req.user;
        if(!['SISTEMAS','RRHH','OPERACIONES','FIELDLEADER','TIENDA'].includes(user?.role))throw fail(403,'Perfil no autorizado.');
        const page=Number(req.query?.page||1),limit=Number(req.query?.limit||25);
        if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail(422,'Paginacion invalida.');
        const clauses=[],values=[];
        if(!user.allStores&&user.role!=='RRHH'){
          if(!user.stores?.length)clauses.push('1=0');
          else {clauses.push('a.CODIGO_TIENDA IN (?)');values.push(user.stores);}
        }
        if(['OPERACIONES','FIELDLEADER'].includes(user.role))clauses.push("a.NIVEL='GENERAL'");
        const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
        const [[count]]=await pool.query('SELECT COUNT(*) total FROM tb_autorizar_hr_extra a '+where,values);
        const [rows]=await pool.query(`SELECT a.*,t.DESCRIPCION,t.EMAIL FROM tb_autorizar_hr_extra a
          LEFT JOIN tb_lista_tienda t ON t.SERIE_TIENDA=a.CODIGO_TIENDA
          ${where} ORDER BY (a.APROBADO=0 AND a.RECHAZADO=0) DESC,a.FECHA DESC,a.ID_AUTH_HR_EXT DESC LIMIT ? OFFSET ?`,[...values,limit,(page-1)*limit]);
        res.json({success:true,total:Number(count.total),page,limit,data:rows.map(row=>({
          id_auth_hr_ext:row.ID_AUTH_HR_EXT,hr_extra:row.HR_EXTRA_ACOMULADO,nro_documento:row.NRO_DOCUMENTO_EMPLEADO,nombre_completo:row.NOMBRE_COMPLETO,
          estado_auth:Number(row.APROBADO)?'aprobado':Number(row.RECHAZADO)?'rechazado':'espera',fecha:row.FECHA,
          descripcion:row.DESCRIPCION||'OFICINA',id_hora_extra:row.ID_HORA_EXTRA,comentario:row.COMENTARIO,usuario_modf:row.USUARIO_MODF,store_code:row.CODIGO_TIENDA,email:row.EMAIL||''
        }))});
      }catch(error){res.status(error.status||500).json({success:false,message:error.status?error.message:'No se pudieron consultar las autorizaciones.'});}
    },
    request:endpoint(async(connection,req)=>{
      const body=req.body||{},id=body.id_hora_extra;
      if(!Number.isSafeInteger(id)||id<1||typeof body.nroDocumento!=='string'||typeof body.codigoTienda!=='string')throw fail(422,'Solicitud invalida.');
      if(!allowedStore(req.user,body.codigoTienda))throw fail(403,'Tienda no autorizada.');
      await lockOvertimeDocuments(connection,[body.nroDocumento.trim()]);
      const [[balance]]=await connection.execute('SELECT * FROM tb_hora_extra_empleado WHERE ID_HR_EXTRA=? FOR UPDATE',[id]);
      if(!balance||balance.NRO_DOCUMENTO_EMPLEADO.trim()!==body.nroDocumento.trim())throw fail(409,'El saldo ya no esta disponible para ese empleado.');
      if(!['aprobar','rechazado'].includes(balance.ESTADO)||Number(balance.APROBADO)===1)throw fail(409,'El saldo ya fue procesado.');
      const period=typeof balance.FECHA==='string'?balance.FECHA.split(' al '):[balance.FECHA];
      const start=dateKey(period[0]),end=dateKey(period[1]||period[0]);
      if(!start||!end)throw fail(409,'El periodo del saldo no es valido.');
      const [[assigned]]=await connection.query(`SELECT x.NOMBRE_COMPLETO FROM (
        SELECT w.NOMBRE_COMPLETO,h.CODIGO_TIENDA,${SCHEDULE_DAY_SQL} AS work_date FROM tb_dias_trabajo w JOIN tb_horario_property h ON h.ID_HORARIO=w.ID_TRB_HORARIO JOIN tb_dias_horario d ON d.ID_DIAS=w.ID_TRB_DIAS WHERE w.NUMERO_DOCUMENTO=?
        UNION ALL SELECT w.NOMBRE_COMPLETO,h.CODIGO_TIENDA,${SCHEDULE_DAY_SQL} AS work_date FROM tb_dias_libre w JOIN tb_horario_property h ON h.ID_HORARIO=w.ID_TRB_HORARIO JOIN tb_dias_horario d ON d.ID_DIAS=w.ID_TRB_DIAS WHERE w.NUMERO_DOCUMENTO=?
        ) x WHERE x.CODIGO_TIENDA=? AND x.work_date BETWEEN ? AND ? LIMIT 1`,[balance.NRO_DOCUMENTO_EMPLEADO,balance.NRO_DOCUMENTO_EMPLEADO,body.codigoTienda,start,end]);
      if(!assigned)throw fail(403,'No se pudo comprobar que el empleado pertenezca al horario de esa tienda.');
      const [[existing]]=await connection.execute('SELECT ID_AUTH_HR_EXT FROM tb_autorizar_hr_extra WHERE ID_HORA_EXTRA=? FOR UPDATE',[id]);
      if(existing)throw fail(409,'Ya existe una solicitud para este saldo.');
      const level=balance.OBSERVACION==='Tiene una papeleta ese dia.'?'RECURSOS HUMANOS':'GENERAL';
      const [created]=await connection.execute(`INSERT INTO tb_autorizar_hr_extra
        (ID_HORA_EXTRA,HR_EXTRA_ACOMULADO,NRO_DOCUMENTO_EMPLEADO,NOMBRE_COMPLETO,APROBADO,RECHAZADO,FECHA,CODIGO_TIENDA,NIVEL)
        VALUES (?,?,?,?,0,0,?,?,?)`,[id,balance.HR_EXTRA_ACUMULADO,balance.NRO_DOCUMENTO_EMPLEADO,assigned.NOMBRE_COMPLETO,balance.FECHA,body.codigoTienda,level]);
      await connection.execute("UPDATE tb_hora_extra_empleado SET ESTADO='espera aprobacion' WHERE ID_HR_EXTRA=?",[id]);
      await enqueueNotification(connection,'overtime-request:'+created.insertId,{email:recipients,subject:'Solicitud de autorizacion de horas extras',template:'solicitudHorasExtras',variables:{fecha:balance.FECHA,nombre:assigned.NOMBRE_COMPLETO,documento:balance.NRO_DOCUMENTO_EMPLEADO,horas:balance.HR_EXTRA_ACUMULADO,motivo:balance.OBSERVACION}});
      return {status:201,body:{success:true,message:'Solicitud registrada. Su notificacion quedo en cola.',id:created.insertId,id_hora_extra:id,estado:'espera aprobacion'}};
    }),
    decide:endpoint(async(connection,req)=>{
      const {id_auth_hrx,id_hrx,aprobado,comentario=''}=req.body||{};
      if(!['SISTEMAS','RRHH','OPERACIONES','FIELDLEADER'].includes(req.user?.role))throw fail(403,'Perfil no autorizado para aprobar.');
      if(!Number.isSafeInteger(id_auth_hrx)||id_auth_hrx<1||!Number.isSafeInteger(id_hrx)||id_hrx<1||typeof aprobado!=='boolean'||typeof comentario!=='string'||comentario.length>1000)throw fail(422,'Respuesta invalida.');
      const [[identity]]=await connection.execute('SELECT NRO_DOCUMENTO_EMPLEADO FROM tb_hora_extra_empleado WHERE ID_HR_EXTRA=?',[id_hrx]);
      if(!identity)throw fail(409,'El saldo ya no existe.');
      await lockOvertimeDocuments(connection,[identity.NRO_DOCUMENTO_EMPLEADO]);
      const [[balance]]=await connection.execute('SELECT * FROM tb_hora_extra_empleado WHERE ID_HR_EXTRA=? FOR UPDATE',[id_hrx]);
      const [[approval]]=await connection.execute('SELECT * FROM tb_autorizar_hr_extra WHERE ID_AUTH_HR_EXT=? AND ID_HORA_EXTRA=? FOR UPDATE',[id_auth_hrx,id_hrx]);
      if(!balance||!approval||approval.NRO_DOCUMENTO_EMPLEADO!==balance.NRO_DOCUMENTO_EMPLEADO)throw fail(409,'La autorizacion no corresponde al saldo.');
      if(!allowedStore(req.user,approval.CODIGO_TIENDA)||(['OPERACIONES','FIELDLEADER'].includes(req.user.role)&&approval.NIVEL!=='GENERAL'))throw fail(403,'No tiene permiso para esa autorizacion.');
      if(Number(approval.APROBADO)||Number(approval.RECHAZADO)) {
        if(Boolean(Number(approval.APROBADO))===aprobado)return {body:{success:true,message:'La respuesta ya estaba registrada.',duplicate:true}};
        throw fail(409,'La autorizacion ya tiene una respuesta.');
      }
      if(balance.ESTADO!=='espera aprobacion')throw fail(409,'El saldo ya no esta pendiente de autorizacion.');
      await connection.execute('UPDATE tb_autorizar_hr_extra SET APROBADO=?,RECHAZADO=?,COMENTARIO=?,USUARIO_MODF=? WHERE ID_AUTH_HR_EXT=?',[aprobado?1:0,aprobado?0:1,comentario,req.user.username,id_auth_hrx]);
      await connection.execute('UPDATE tb_hora_extra_empleado SET ESTADO=?,APROBADO=?,ISAPROBACION=? WHERE ID_HR_EXTRA=?',[aprobado?'correcto':'rechazado',aprobado?1:0,aprobado?0:1,id_hrx]);
      await enqueueNotification(connection,'overtime-decision:'+id_auth_hrx,{email:recipients,subject:'Respuesta de autorizacion de horas extras',template:aprobado?'aprobacionHoraExtra':'rechazoHoraExtra',variables:{tienda:approval.CODIGO_TIENDA,fecha:approval.FECHA,hrx:approval.HR_EXTRA_ACOMULADO,comentario,usuario_responsable:req.user.username}});
      return {body:{success:true,message:aprobado?'Autorizacion aprobada.':'Autorizacion rechazada.'}};
    }),
  };
}
