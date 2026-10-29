const roles=new Set(['SISTEMAS','MARKETING','OPERACIONES','FIELDLEADER','RRHH','CONTABILIDAD','TIENDA','INVENTARIO']);
const fail=(status,message)=>Object.assign(new Error(message),{status});
function ids(values){
  if(!Array.isArray(values)||values.length>1000||values.some(id=>!Number.isSafeInteger(id)||id<1))throw fail(422,'Seleccione identificadores validos.');
  return [...new Set(values)];
}
export function createPermissionController(pool){
  const endpoint=handler=>async(req,res)=>{
    if(req.user?.role!=='SISTEMAS')return res.status(403).json({message:'Accion no autorizada.'});
    try{await handler(req,res);}catch(error){res.status(error.status||500).json({message:error.status?error.message:'No se pudieron actualizar los permisos.'});}
  };
  async function transaction(action){
    const connection=await pool.getConnection();
    try{await connection.beginTransaction();await action(connection);await connection.commit();}
    catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  return {
    assignStores:endpoint(async(req,res)=>{
      const user=req.body?.ID_USUARIO,selected=ids(Array.isArray(req.body?.TIENDAS)?req.body.TIENDAS.map(row=>row?.id):undefined);
      if(!Number.isSafeInteger(user)||user<1)throw fail(422,'Usuario invalido.');
      await transaction(async connection=>{
        const [[target]]=await connection.execute('SELECT ID_LOGIN FROM tb_login WHERE ID_LOGIN=? FOR UPDATE',[user]);
        if(!target)throw fail(404,'El usuario ya no existe.');
        const [stores]=selected.length?await connection.query('SELECT ID_TIENDA,DESCRIPCION FROM tb_lista_tienda WHERE ID_TIENDA IN (?)',[selected]):[[]];
        if(stores.length!==selected.length)throw fail(422,'Una tienda seleccionada ya no existe.');
        await connection.execute('DELETE FROM tb_usuario_tiendas_asignadas WHERE ID_USUARIO_TASG=?',[user]);
        if(stores.length)await connection.query('INSERT INTO tb_usuario_tiendas_asignadas (ID_USUARIO_TASG,ID_TIENDA_TASG,DESCRIPCION_TIENDA) VALUES ?',[stores.map(store=>[user,store.ID_TIENDA,store.DESCRIPCION])]);
        await connection.execute('UPDATE tb_center_sessions SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND revoked_at IS NULL',[user]);
      });res.json({message:'Tiendas asignadas. El usuario debe volver a iniciar sesion.'});
    }),
    assignMenu:endpoint(async(req,res)=>{
      const {NIVEL,MENUS}=req.body||{},selected=ids(MENUS);
      if(!roles.has(NIVEL))throw fail(422,'Perfil invalido.');
      if(NIVEL==='SISTEMAS'&&!selected.length)throw fail(409,'SISTEMAS debe conservar al menos un modulo.');
      await transaction(async connection=>{
        // Lock the role's accounts in a stable order to serialize changes for the same role.
        await connection.execute('SELECT ID_LOGIN FROM tb_login WHERE NIVEL=? ORDER BY ID_LOGIN FOR UPDATE',[NIVEL]);
        const [menus]=selected.length?await connection.query('SELECT ID_MENU FROM tb_menu_sistema WHERE ID_MENU IN (?)',[selected]):[[]];
        if(menus.length!==selected.length)throw fail(422,'Un modulo seleccionado ya no existe.');
        await connection.execute('DELETE FROM tb_permiso_sistema WHERE NIVEL=?',[NIVEL]);
        if(selected.length)await connection.query('INSERT INTO tb_permiso_sistema (ID_MENU_PS,NIVEL) VALUES ?',[selected.map(id=>[id,NIVEL])]);
        await connection.execute('UPDATE tb_center_sessions s JOIN tb_login u ON u.ID_LOGIN=s.user_id SET s.revoked_at=UTC_TIMESTAMP() WHERE u.NIVEL=? AND s.revoked_at IS NULL',[NIVEL]);
      });res.json({message:'Permisos actualizados. Las cuentas del perfil deben volver a iniciar sesion.'});
    }),
    storeSettings:endpoint(async(req,res)=>{
      const rows=req.body,selected=ids(Array.isArray(rows)?rows.map(row=>row?.id):undefined);
      if(rows.some(row=>['horarioPermiso','papeletaPermiso','avisosTraffic'].some(key=>![true,false,0,1].includes(row[key]))))throw fail(422,'Permisos invalidos.');
      await transaction(async connection=>{
        if(!selected.length)return;
        const [stores]=await connection.query('SELECT ID_TIENDA FROM tb_lista_tienda WHERE ID_TIENDA IN (?) ORDER BY ID_TIENDA FOR UPDATE',[selected]);
        if(stores.length!==selected.length)throw fail(422,'Una tienda seleccionada ya no existe.');
        await connection.query(`INSERT INTO tb_configuracion_horario_pap (ID_TIENDA_HP,IS_FREE_HORARIO,IS_FREE_PAPELETA,IS_ALERT_TRAFFIC_COUNTER)
          VALUES ? ON DUPLICATE KEY UPDATE IS_FREE_HORARIO=VALUES(IS_FREE_HORARIO),IS_FREE_PAPELETA=VALUES(IS_FREE_PAPELETA),IS_ALERT_TRAFFIC_COUNTER=VALUES(IS_ALERT_TRAFFIC_COUNTER)`,
          [rows.map(row=>[row.id,Number(row.horarioPermiso),Number(row.papeletaPermiso),Number(row.avisosTraffic)])]);
      });res.json({message:'Configuracion guardada correctamente.'});
    }),
  };
}
