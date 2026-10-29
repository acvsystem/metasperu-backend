export function canReadHrStore(user,store) {
  return Boolean(user&&(user.allStores||user.role==='RRHH'||user.stores?.includes(store)));
}

export function scheduleStorePredicate(user) {
  if(user?.allStores||user?.role==='RRHH')return {sql:'',values:[]};
  const stores=[...new Set((user?.stores||[]).filter(value=>typeof value==='string'&&value))];
  return stores.length?{sql:` WHERE H.CODIGO_TIENDA IN (${stores.map(()=>'?').join(',')})`,values:stores}:{sql:' WHERE 1=0',values:[]};
}

export function parseBallotDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(value+'T00:00:00Z');
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value?value:null;
}

/** Lock the exact ballot requested before any write; an unrelated ID must never be updated. */
export async function lockBallotForDateChange(connection,user,{codeBallot,id_papeleta,nueva_fecha}={}) {
  if(!['SISTEMAS','RRHH'].includes(user?.role))throw Object.assign(new Error('Accion no autorizada.'),{status:403});
  if(typeof codeBallot!=='string'||!codeBallot||codeBallot.length>80||!Number.isSafeInteger(id_papeleta)||id_papeleta<1||!parseBallotDate(nueva_fecha)) {
    throw Object.assign(new Error('Papeleta o fecha invalida.'),{status:422});
  }
  const [[ballot]]=await connection.execute(`SELECT ID_HEAD_PAPELETA,CODIGO_TIENDA FROM tb_head_papeleta
    WHERE ID_HEAD_PAPELETA=? AND CODIGO_PAPELETA=? FOR UPDATE`,[id_papeleta,codeBallot]);
  if(!ballot)throw Object.assign(new Error('Papeleta no encontrada.'),{status:404});
  if(!canReadHrStore(user,ballot.CODIGO_TIENDA))throw Object.assign(new Error('Accion no autorizada.'),{status:403});
  return ballot;
}
