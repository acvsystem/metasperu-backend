import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export function validateTransferStores(pool,{file=false}={}) {
  return async(req,res,next)=>{
    const {origin_serie:origin,destination_serie:destination}=req.body||{};
    if(typeof origin!=='string'||typeof destination!=='string'||origin===destination||origin.length>80||destination.length>80)return res.status(422).json({message:'Seleccione dos tiendas diferentes.'});
    try {
      const [rows]=await pool.execute('SELECT SERIE_TIENDA,DESCRIPCION,COD_ALMACEN,UNID_SERVICIO,TIPO_TIENDA FROM tb_lista_tienda WHERE SERIE_TIENDA IN (?,?)',[origin,destination]);
      const from=rows.find(row=>row.SERIE_TIENDA===origin),to=rows.find(row=>row.SERIE_TIENDA===destination);
      if(!from||!to||from.UNID_SERVICIO!==to.UNID_SERVICIO)return res.status(422).json({message:'Las tiendas deben existir y pertenecer a la misma unidad de servicio.'});
      Object.assign(req.body,{store_origin:from.DESCRIPCION,store_destination:to.DESCRIPCION,
        origenStore:from.DESCRIPCION,destinoStore:to.DESCRIPCION,code_warehouse_origin:from.COD_ALMACEN,
        code_warehouse_destination:to.COD_ALMACEN,unid_service:from.UNID_SERVICIO});
      if(file) {
        const group=type=>['VSBA','VSFA'].includes(type)?'VS':type==='BBW'?'BBW':null;
        if(!group(from.TIPO_TIENDA)||group(from.TIPO_TIENDA)!==group(to.TIPO_TIENDA))return res.status(422).json({message:'La ruta de transferencia no esta configurada para estas tiendas.'});
        req.body.ftpDirectorio=group(from.TIPO_TIENDA);
        if(!req.file||!/^traspaso_stock_[a-zA-Z0-9_-]+\.txt$/.test(req.file.originalname))return res.status(422).json({message:'Se requiere el archivo TXT de traspaso.'});
        const content=await readFile(req.file.path,'utf8'),lines=content.trim().split(/\r?\n/);
        if(!content.trim()||lines.length>5000||lines.some(line=>{
          const fields=line.split('|');return fields.length!==6||fields[0]!==String(from.COD_ALMACEN)||fields[1]!==String(to.COD_ALMACEN)||
            !fields[2]||fields.slice(2,5).some(value=>value.length>120||/[\x00-\x1f]/.test(value))||!Number.isFinite(Number(fields[5]))||Number(fields[5])<=0||Number(fields[5])>1000000;
        }))return res.status(422).json({message:'El contenido del traspaso no coincide con las tiendas o cantidades permitidas.'});
      }
      next();
    }catch{res.status(503).json({message:'No se pudieron validar las tiendas del traspaso.'});}
  };
}

export function createTransferRegistration(pool) {
  return async(req,res)=>{
    const body=req.body||{},details=body.details;
    if(typeof body.requestId!=='string'||!/^\w{8}(-\w{4}){3}-\w{12}$/.test(body.requestId)||
      !Array.isArray(details)||!details.length||details.length>5000||
      typeof body.datetime!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(body.datetime)||
      details.some(row=>!row||['barcode','article_code','description','size','color'].some(key=>
        !['string','number'].includes(typeof row[key])||String(row[key]).length>255)||
        !Number.isFinite(Number(row.stock))||!Number.isFinite(Number(row.stock_required))||Number(row.stock_required)<=0||Number(row.stock_required)>1000000)) {
      return res.status(422).json({message:'Revise el identificador, la fecha y los detalles del traspaso.'});
    }
    const hash=createHash('sha256').update(JSON.stringify({origin:body.origin_serie,destination:body.destination_serie,datetime:body.datetime,
      details:details.map(row=>[row.barcode,row.article_code,row.description,row.size,row.color,Number(row.stock),Number(row.stock_required)])})).digest('hex');
    let connection;
    try {
      connection=await pool.getConnection();await connection.beginTransaction();
      await connection.execute(`INSERT INTO tb_center_transfer_requests (user_id,request_id,payload_hash) VALUES (?,?,?)
        ON DUPLICATE KEY UPDATE request_id=VALUES(request_id)`,[req.user.id,body.requestId,hash]);
      const [[receipt]]=await connection.execute('SELECT payload_hash,code_transfer FROM tb_center_transfer_requests WHERE user_id=? AND request_id=? FOR UPDATE',[req.user.id,body.requestId]);
      if(receipt.payload_hash!==hash){await connection.rollback();return res.status(409).json({message:'Este identificador ya pertenece a otro traspaso.'});}
      if(receipt.code_transfer){await connection.commit();return res.json({message:'Traspaso ya registrado.',data:{code_transfer:receipt.code_transfer},duplicate:true});}
      const [[sequence]]=await connection.execute("SELECT current_value FROM tb_center_sequences WHERE sequence_name='transfers' FOR UPDATE");
      if(!sequence||Number(sequence.current_value)>=999999)throw new Error('Sequence unavailable');
      const value=Number(sequence.current_value)+1,code='T'+String(value).padStart(6,'0');
      await connection.execute("UPDATE tb_center_sequences SET current_value=? WHERE sequence_name='transfers'",[value]);
      await connection.execute(`INSERT INTO tb_head_traspasos (CODIGO_TRASPASO,UNIDAD_SERVICIO,TIENDA_ORIGEN,TIENDA_DESTINO,CODIGO_ALM_ORIGEN,CODIGO_ALM_DESTINO,DATETIME)
        VALUES (?,?,?,?,?,?,?)`,[code,body.unid_service,body.store_origin,body.store_destination,body.code_warehouse_origin,body.code_warehouse_destination,body.datetime]);
      // A bounded bulk INSERT uses one round trip, rather than one query per article.
      await connection.query(`INSERT INTO tb_detalle_traspasos (CODIGO_BARRA,CODIGO_ARTICULO,DESCRIPCION,TALLA,COLOR,STOCK,STOCK_SOLICITADO,CODIGO_TRASPASO)
        VALUES ?`,[details.map(row=>[String(row.barcode),String(row.article_code),String(row.description),String(row.size),String(row.color),Number(row.stock),Number(row.stock_required),code])]);
      await connection.execute('UPDATE tb_center_transfer_requests SET code_transfer=? WHERE user_id=? AND request_id=?',[code,req.user.id,body.requestId]);
      await connection.commit();res.json({message:'Traspaso registrado correctamente.',data:{code_transfer:code},duplicate:false});
    }catch{await connection?.rollback();res.status(503).json({message:'No se confirmo el registro. Puede reintentar con el mismo identificador.'});}
    finally{connection?.release();}
  };
}

export function createTransferHistory(pool) {
  return async(req,res)=>{
    const page=Math.min(10000,Math.max(1,parseInt(req.query.page,10)||1));
    const limit=Math.min(100,Math.max(1,parseInt(req.query.limit,10)||25));
    const q=`%${String(req.query.q||'').slice(0,120)}%`,values=[q,q,q];
    let where='WHERE (h.CODIGO_TRASPASO LIKE ? OR h.TIENDA_ORIGEN LIKE ? OR h.TIENDA_DESTINO LIKE ?)';
    if(!req.user.allStores) {
      if(!req.user.stores.length)return res.json({data:[],total:0,page,limit});
      for(const column of ['CODIGO_ALM_ORIGEN','CODIGO_ALM_DESTINO']) {
        where+=` AND EXISTS (SELECT 1 FROM tb_lista_tienda t WHERE t.COD_ALMACEN=h.${column} AND t.UNID_SERVICIO=h.UNIDAD_SERVICIO AND t.SERIE_TIENDA IN (?))`;
        values.push(req.user.stores);
      }
    }
    try {
      const [[count]]=await pool.query(`SELECT COUNT(*) AS total FROM tb_head_traspasos h ${where}`,values);
      const [rows]=await pool.query(`SELECT h.CODIGO_TRASPASO AS code_transfer,h.UNIDAD_SERVICIO AS unid_service,
        h.TIENDA_ORIGEN AS store_origin,h.TIENDA_DESTINO AS store_destination,h.CODIGO_ALM_ORIGEN AS code_warehouse_origin,
        h.CODIGO_ALM_DESTINO AS code_warehouse_destination,h.DATETIME AS datetime FROM tb_head_traspasos h ${where}
        ORDER BY h.ID_TRASPASOS DESC LIMIT ? OFFSET ?`,[...values,limit,(page-1)*limit]);
      res.json({data:rows,total:Number(count.total),page,limit});
    }catch{res.status(500).json({message:'No se pudieron cargar los traspasos.'});}
  };
}
