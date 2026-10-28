import { centerCookie,centerCookieOptions } from './center-security.mjs';
export function createCenterAuthController({pool,getSecurity,compare}) {
  async function context(principal) {
    const [menu]=await pool.execute(`SELECT m.NOMBRE_MENU AS nombre,m.RUTA AS ruta FROM tb_permiso_sistema p
      JOIN tb_menu_sistema m ON m.ID_MENU=p.ID_MENU_PS WHERE p.NIVEL=? ORDER BY m.ID_MENU`,[principal.role]);
    const [[store]]=await pool.execute('SELECT UNID_SERVICIO FROM tb_lista_tienda WHERE SERIE_TIENDA=? LIMIT 1',[principal.code_store||'']);
    return {id:principal.id,username:principal.username,role:principal.role,email:principal.email||'',
      code_store:principal.code_store||'',old_code_store:principal.old_code_store||'',unid_servicio:store?.UNID_SERVICIO||'OF',menu};
  }
  return {
    login:async(req,res)=>{
      const {username,password}=req.body||{};
      if(typeof username!=='string'||!username.trim()||username.length>100||typeof password!=='string'||!password||Buffer.byteLength(password)>72) return res.status(400).json({message:'Ingrese un usuario y contraseña validos.'});
      try {
        const [[user]]=await pool.execute('SELECT ID_LOGIN,USUARIO,PASSWORD_NW,EMAIL,NIVEL,CODE_STORE,OLD_CODE_STORE FROM tb_login WHERE USUARIO=? LIMIT 1',[username.trim()]);
        if(!user||!await compare(password,user.PASSWORD_NW))return res.status(401).json({message:'Credenciales invalidas.'});
        const profile=await context({id:user.ID_LOGIN,username:user.USUARIO,role:user.NIVEL,email:user.EMAIL,code_store:user.CODE_STORE,old_code_store:user.OLD_CODE_STORE});
        if(!profile.menu.length)return res.status(403).json({message:'La cuenta no tiene modulos asignados. Contacte al administrador.'});
        const {token,maxAge}=await getSecurity().issue(user);
        res.cookie(centerCookie,token,{...centerCookieOptions,maxAge});res.set('Cache-Control','no-store');
        const {menu,...publicUser}=profile;res.json({token,user:publicUser,menu});
      }catch{res.status(503).json({message:'El servicio de acceso no esta disponible temporalmente.'});}
    },
    check:async(req,res)=>{
      try {res.set('Cache-Control','no-store');res.json(await context(req.user));}
      catch{res.status(503).json({message:'No se pudo recuperar el perfil de la sesion.'});}
    },
    logout:async(req,res)=>{
      try {await getSecurity().revoke(req.user);res.clearCookie(centerCookie,centerCookieOptions);res.json({message:'Sesion cerrada correctamente.'});}
      catch{res.status(503).json({message:'No se pudo cerrar la sesion. Intente nuevamente.'});}
    },
  };
}
