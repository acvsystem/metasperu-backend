import path from 'node:path';
import { mkdir,lstat,unlink } from 'node:fs/promises';
export const isUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function artifactPath(root,jobId,key) {
  if(!path.isAbsolute(root)||!isUuid(jobId)||!isUuid(key))throw new Error('Invalid artifact identity');
  return path.join(root,`${jobId}.${key}.csv`);
}
export async function prepareExportDirectory(root) {
  if(!path.isAbsolute(root))throw new Error('CENTER_EXPORT_DIR debe ser absoluto.');
  await mkdir(root,{recursive:true,mode:0o700});
  const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Invalid export directory');
}
export async function removeOwnedArtifact(root,jobId,key) {
  const filename=artifactPath(root,jobId,key);
  try {const stat=await lstat(filename);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Invalid artifact');await unlink(filename);}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
export function csvCell(value) {
  if(value===null||value===undefined)return '';
  if(typeof value==='number')return Number.isFinite(value)?String(value):'';
  let text=value instanceof Date?value.toISOString():String(value);
  if(/^\s*[=+@-]/.test(text)||/^[\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
