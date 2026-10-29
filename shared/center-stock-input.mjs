const code=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(value);
export function validateStockLookup(req,res,next) {
  const body=req.body||{};
  const rows=req.path.endsWith('/search/barcode')?[{codigo_barra:body.codigo_barra,cantidad_solicitada:1}]:body.dataCode;
  if(!Array.isArray(rows)||!rows.length||rows.length>5000||rows.some(row=>
    !code(row?.codigo_barra)||!['string','number'].includes(typeof row?.cantidad_solicitada)||
    !Number.isFinite(Number(row.cantidad_solicitada))||Number(row.cantidad_solicitada)<=0||Number(row.cantidad_solicitada)>1000000)) {
    return res.status(422).json({message:'Revise los codigos de barras y cantidades de la consulta.'});
  }
  next();
}
