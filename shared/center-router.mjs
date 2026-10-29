// Express 4 does not forward rejected promises. Wrap registration through its public API.
function safe(handler) {
  if(typeof handler!=='function')return handler;
  if(handler.length===4)return function(error,req,res,next){try{Promise.resolve(handler(error,req,res,next)).catch(next);}catch(failure){next(failure);}};
  return function(req,res,next){
    try {Promise.resolve(handler(req,res,next)).catch(next);}catch(error){next(error);}
  };
}
export function createCenterRouter(Router) {
  const router=Router();
  for(const method of ['use','get','post','put','patch','delete','all']) {
    const register=router[method].bind(router);
    router[method]=(first,...rest)=>{
      if(typeof first==='string'||first instanceof RegExp||Array.isArray(first)&&first.every(value=>typeof value==='string'))return register(first,...rest.flat(Infinity).map(safe));
      return register(...[first,...rest].flat(Infinity).map(safe));
    };
  }
  return router;
}
