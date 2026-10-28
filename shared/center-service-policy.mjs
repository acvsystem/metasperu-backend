const roles = {
  inventory: ['SISTEMAS','INVENTARIO','OPERACIONES','TIENDA','FIELDLEADER','RRHH','MARKETING'],
  human: ['SISTEMAS','RRHH','OPERACIONES','TIENDA','FIELDLEADER','MARKETING'],
  accounting: ['SISTEMAS','CONTABILIDAD'],
};
const body = key => req => { const value=req.body?.[key];if(typeof value!=='string'||!value)throw new Error('Invalid store');return value; };
const scopes = {
  inventory: {
    'POST /api/inventory/send/email': body('serie'),
    'POST /api/inventory/application/inventary/email': req => req.body?.serieStore?.map(row => row.serie),
    'POST /api/inventory/one/search': body('serieStore'),
    'GET /api/inventory/traspasos': () => [], // The query applies the principal's stores.
    'POST /api/inventory/traspasos': req => [req.body?.origin_serie,req.body?.destination_serie],
    'POST /api/inventory/traspasos/insert': req => [req.body?.origin_serie,req.body?.destination_serie],
  },
  accounting: {
    'POST /api/kardex/store': body('serieStore'),
    'POST /api/kardex/camposlibres': body('serieStore'),
    'POST /api/cuo/store': body('serieStore'),
    'POST /api/cuo/insert': body('serieStore'),
    'POST /api/exchange-rate/store': body('serieStore'),
    'POST /api/exchange-rate/sunat': () => [],
    'GET /api/stores/online': () => [], // Controller filters the response independently.
  },
  human: {
    'GET /api/type/ballot': () => [],
    'POST /api/search/schedule/store': body('code_store'),
    'POST /api/register/schedule/store': body('codigoTienda'),
    'POST /api/update/schedule/store': body('codigoTienda'),
    'POST /api/one/search/schedule/store': body('code_store'),
    'POST /api/all/ballot/employes/store': req => [req.body?.codestore,req.body?.old_codestore].filter(Boolean),
    'POST /api/create/ballot/employes': req => req.body?.empleado?.codigoTienda,
  },
};
export function authorizeServiceAction(service) {
  return (req,res,next) => {
    const user=req.user;
    if(!roles[service]?.includes(user?.role)) return res.status(403).json({message:'Accion no autorizada.'});
    // Administrative country-wide permissions are explicit; arbitrary query fields cannot grant scope.
    if(user.allStores || (service==='human' && user.role==='RRHH')) return next();
    const extractor=scopes[service]?.[req.method+' '+req.route?.path];
    if(!extractor) return res.status(403).json({message:'Esta operacion requiere permisos de administracion.'});
    let value;
    try { value=extractor(req); } catch { return res.status(422).json({message:'Tiendas invalidas.'}); }
    const values=Array.isArray(value)?value:[value];
    const globalRead=new Set(['GET /api/type/ballot','GET /api/stores/online','POST /api/exchange-rate/sunat','GET /api/inventory/traspasos']);
    if(!values.length&&!globalRead.has(req.method+' '+req.route?.path)) return res.status(403).json({message:'Seleccione al menos una tienda autorizada.'});
    if(values.some(item=>typeof item!=='string' || !item || !user.stores.includes(item))) {
      return res.status(403).json({message:'No tiene acceso a las tiendas de esta operacion.'});
    }
    next();
  };
}

export function bindReplySocket(getIO) {
  return async (req,res,next) => {
    const id=req.body?.socketId || req.body?.socket || req.query?.socket_id;
    if(!id) return next();
    try {
      const [target]=await getIO().in(String(id)).fetchSockets();
      if(typeof id!=='string' || !target || target.id!==id || target.data.principalKind!=='user' || Number(target.data.principal?.id)!==Number(req.user.id)) {
        return res.status(403).json({message:'La conexion de respuesta no pertenece a esta sesion.'});
      }
      next();
    } catch { res.status(503).json({message:'No se pudo comprobar la conexion de respuesta.'}); }
  };
}

export function bindAgentReplySocket(getIO) {
  return async(req,res,next)=>{
    const raw=req.body?.socketId??req.body?.socket;
    const id=typeof raw==='object'?raw?.socketId:raw;
    if(typeof id!=='string'||!id||id.length>100)return res.status(422).json({message:'Conexion de respuesta invalida.'});
    try {
      const [target]=await getIO().in(id).fetchSockets();
      if(!target||target.id!==id||target.data.principalKind!=='user'||!['SISTEMAS','RRHH'].includes(target.data.principal?.role))return res.status(403).json({message:'Destinatario no autorizado.'});
      req.replySocketId=id;req.replyUser=target.data.principal;
      next();
    }catch{res.status(503).json({message:'No se pudo comprobar la conexion de respuesta.'});}
  };
}
