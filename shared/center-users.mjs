const roles=new Set(['SISTEMAS','MARKETING','OPERACIONES','FIELDLEADER','RRHH','CONTABILIDAD','TIENDA','INVENTARIO']);
const fail=(status,message)=>Object.assign(new Error(message),{status});
function userInput(body,creating) {
  const {USUARIO,EMAIL,NIVEL,CODE_STORE,DEFAULT_PAGE,PASSWORD}=body||{};
  if(typeof USUARIO!=='string'||!/^[\p{L}\p{N}_.@ -]{4,80}$/u.test(USUARIO.trim())||
    typeof EMAIL!=='string'||EMAIL.length>120||!/^\S+@\S+\.\S+$/.test(EMAIL)||!roles.has(NIVEL)||
    typeof CODE_STORE!=='string'||CODE_STORE.length>80||!CODE_STORE.trim()||
    typeof DEFAULT_PAGE!=='string'||!/^\/?[a-z0-9-]{1,80}$/.test(DEFAULT_PAGE))throw fail(422,'Revise usuario, correo, perfil, tienda y pagina inicial.');
  if(creating||PASSWORD!==undefined&&PASSWORD!=='') {
    if(typeof PASSWORD!=='string'||PASSWORD.length<12||Buffer.byteLength(PASSWORD)>72)throw fail(422,'La contraseña debe tener al menos 12 caracteres y un maximo de 72 bytes.');
  }
  return {USUARIO:USUARIO.trim(),EMAIL:EMAIL.trim(),NIVEL,CODE_STORE:CODE_STORE.trim(),DEFAULT_PAGE,PASSWORD};
}
const idOf=value=>{const id=Number(value);if(!Number.isSafeInteger(id)||id<1)throw fail(422,'Usuario invalido.');return id;};
export function createUserController({pool,hash}) {
  const endpoint=handler=>async(req,res)=>{
    try {if(req.user?.role!=='SISTEMAS')throw fail(403,'No tiene permiso para administrar usuarios.');await handler(req,res);}
    catch(error){res.status(error.code==='ER_DUP_ENTRY'?409:error.status||500).json({message:error.code==='ER_DUP_ENTRY'?'El nombre de usuario ya existe.':error.status?error.message:'No se pudo guardar el usuario.'});}
  };
  async function transaction(action) {
    const connection=await pool.getConnection();
    try {await connection.beginTransaction();const result=await action(connection);await connection.commit();return result;}
    catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  async function targetLocked(connection,id,nextRole) {
    // Consistent lock order serializes concurrent attempts to remove/demote administrators.
    const [admins]=await connection.execute("SELECT ID_LOGIN FROM tb_login WHERE NIVEL='SISTEMAS' ORDER BY ID_LOGIN FOR UPDATE");
    const [[target]]=await connection.execute('SELECT ID_LOGIN,NIVEL FROM tb_login WHERE ID_LOGIN=? FOR UPDATE',[id]);
    if(!target)throw fail(404,'El usuario ya no existe.');
    if(target.NIVEL==='SISTEMAS'&&nextRole!=='SISTEMAS'&&admins.length<=1)throw fail(409,'Debe conservar al menos un usuario de SISTEMAS.');
  }
  async function validateStore(connection,serie) {
    const [[store]]=await connection.execute('SELECT ID_TIENDA FROM tb_lista_tienda WHERE SERIE_TIENDA=? LIMIT 1',[serie]);
    if(!store)throw fail(422,'La tienda seleccionada no existe.');
  }
  return {
    list:endpoint(async(req,res)=>{
      const limit=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||25));
      const page=Math.min(10000,Math.max(1,parseInt(req.query.page,10)||1));
      const q=String(req.query.q||'').slice(0,120),where='WHERE USUARIO LIKE ? OR EMAIL LIKE ? OR NIVEL LIKE ?';
      const filter=Array(3).fill(`%${q}%`);
      const [[count]]=await pool.execute(`SELECT COUNT(*) AS total FROM tb_login ${where}`,filter);
      const [rows]=await pool.query(`SELECT ID_LOGIN,USUARIO,EMAIL,NIVEL,DEFAULT_PAGE,CODE_STORE FROM tb_login ${where}
        ORDER BY USUARIO,ID_LOGIN LIMIT ? OFFSET ?`,[...filter,limit,(page-1)*limit]);
      res.json({rows,total:Number(count.total),page,limit});
    }),
    create:endpoint(async(req,res)=>{
      const user=userInput(req.body,true),password=await hash(user.PASSWORD);
      const id=await transaction(async connection=>{
        await validateStore(connection,user.CODE_STORE);
        const [result]=await connection.execute('INSERT INTO tb_login (USUARIO,EMAIL,NIVEL,DEFAULT_PAGE,CODE_STORE,PASSWORD_NW) VALUES (?,?,?,?,?,?)',
          [user.USUARIO,user.EMAIL,user.NIVEL,user.DEFAULT_PAGE,user.CODE_STORE,password]);return result.insertId;
      });res.status(201).json({id,message:'Usuario creado correctamente.'});
    }),
    update:endpoint(async(req,res)=>{
      const id=idOf(req.body?.ID),user=userInput(req.body,false),password=user.PASSWORD?await hash(user.PASSWORD):null;
      await transaction(async connection=>{
        await targetLocked(connection,id,user.NIVEL);await validateStore(connection,user.CODE_STORE);
        await connection.execute(`UPDATE tb_login SET USUARIO=?,EMAIL=?,NIVEL=?,DEFAULT_PAGE=?,CODE_STORE=?${password?',PASSWORD_NW=?':''} WHERE ID_LOGIN=?`,
          [user.USUARIO,user.EMAIL,user.NIVEL,user.DEFAULT_PAGE,user.CODE_STORE,...(password?[password]:[]),id]);
        await connection.execute('UPDATE tb_center_sessions SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND revoked_at IS NULL',[id]);
      });res.json({message:'Usuario actualizado. Sus sesiones anteriores se han cerrado.'});
    }),
    remove:endpoint(async(req,res)=>{
      const id=idOf(req.body?.id);
      if(id===Number(req.user.id))throw fail(409,'No puede eliminar su propia cuenta.');
      await transaction(async connection=>{
        await targetLocked(connection,id,null);
        await connection.execute('UPDATE tb_center_sessions SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND revoked_at IS NULL',[id]);
        await connection.execute('DELETE FROM tb_usuario_tiendas_asignadas WHERE ID_USUARIO_TASG=?',[id]);
        await connection.execute('DELETE FROM tb_login WHERE ID_LOGIN=?',[id]);
      });res.json({message:'Usuario eliminado correctamente.'});
    }),
  };
}
