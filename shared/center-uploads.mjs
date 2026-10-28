import { open,unlink } from 'node:fs/promises';
import path from 'node:path';

export function validSpreadsheetHeader(name,bytes) {
  if(typeof name!=='string'||!/^[\p{L}\p{N} _().-]{1,160}\.(xlsx|csv|txt)$/iu.test(name)||name.includes('..'))return false;
  if(/\.xlsx$/i.test(name))return bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04]));
  try {new TextDecoder('utf-8',{fatal:true}).decode(bytes,{stream:true});return !bytes.includes(0);}catch{return false;}
}
// Multer supplies the generated basename, never the client's original filename.
export function protectSpreadsheetUpload(root) {
  const base=path.resolve(root);
  return async(req,res,next)=>{
    const file=req.file;
    if(!file)return res.status(422).json({message:'Seleccione un archivo XLSX o CSV valido.'});
    const filename=path.resolve(file.path);
    if(path.dirname(filename)!==base||path.basename(filename)!==file.filename)return res.status(422).json({message:'Archivo temporal invalido.'});
    let cleaned=false;
    const cleanup=()=>{if(!cleaned){cleaned=true;void unlink(filename).catch(()=>{});}};
    res.once('finish',cleanup);res.once('close',cleanup);
    let handle;
    try {
      handle=await open(filename,'r');const bytes=Buffer.alloc(Math.min(file.size,4096));
      await handle.read(bytes,0,bytes.length,0);
      if(!validSpreadsheetHeader(file.originalname,bytes))return res.status(422).json({message:'El contenido no corresponde a un archivo XLSX o CSV valido.'});
      next();
    } catch {res.status(422).json({message:'No se pudo validar el archivo.'});}
    finally {await handle?.close();}
  };
}
