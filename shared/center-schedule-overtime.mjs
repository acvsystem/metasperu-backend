export function dateKey(value) {
  if(value instanceof Date)return Number.isNaN(value.getTime())?null:value.toISOString().slice(0,10);
  if(typeof value!=='string')return null;
  let text=value.trim();
  const european=/^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
  if(european)text=`${european[3]}-${european[2].padStart(2,'0')}-${european[1].padStart(2,'0')}`;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
  const parsed=new Date(text+'T00:00:00Z');
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===text?text:null;
}
export const SCHEDULE_DAY_SQL=`COALESCE(
  CASE WHEN d.FECHA_NUMBER REGEXP '^[0-9]{4}-' THEN STR_TO_DATE(d.FECHA_NUMBER,'%Y-%m-%d')
    WHEN d.FECHA_NUMBER REGEXP '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}$' THEN STR_TO_DATE(d.FECHA_NUMBER,'%d-%m-%Y') END,
  CASE WHEN d.FECHA REGEXP '^[0-9]{4}-' THEN STR_TO_DATE(d.FECHA,'%Y-%m-%d')
    WHEN d.FECHA REGEXP '^[0-9]{1,2}-[0-9]{1,2}-[0-9]{4}$' THEN STR_TO_DATE(d.FECHA,'%d-%m-%Y') END)`;
const documentKey=value=>typeof value==='string'?value.trim():'';
const pair=(document,date)=>document&&date?document+'|'+date:null;

export function findRemovedRestDays(previousRows,datos) {
  const working=new Set(),resting=new Set();
  for(const item of Array.isArray(datos)?datos:[]) {
    const dates=new Map((item.dias||[]).map(day=>[String(day.id),dateKey(day.fecha)]));
    const collect=(rows,target)=>{
      for(const row of rows||[])for(const employee of row.trabajadores||[]) {
        const key=pair(documentKey(employee.nro_documento),dates.get(String(row.id_dia)));
        if(key)target.add(key);
      }
    };
    collect((item.filasTrabajo||[]).flatMap(row=>row.celdas||[]),working);
    collect(item.filaLibres,resting);
  }
  const removed=new Map();
  for(const previous of previousRows||[]) {
    const document=documentKey(previous.NUMERO_DOCUMENTO),date=dateKey(previous.FECHA_NUMBER)||dateKey(previous.FECHA);
    const key=pair(document,date);
    if(key&&working.has(key)&&!resting.has(key))removed.set(key,{document,date});
  }
  return [...removed.values()];
}
function seconds(value) {
  if(typeof value!=='string')return null;
  const time=/^(\d{2,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  return time&&Number(time[1])<=838?Number(time[1])*3600+Number(time[2])*60+Number(time[3]||0):null;
}
export function isUnusedOvertime(row,{hasBallot,hasAuthorization}={}) {
  const status=typeof row?.ESTADO==='string'?row.ESTADO.trim().toLowerCase():'';
  const accumulated=seconds(row?.HR_EXTRA_ACUMULADO),remaining=seconds(row?.HR_EXTRA_SOBRANTE);
  return hasBallot===false&&hasAuthorization===false&&['aprobar','correcto','espera aprobacion','rechazado'].includes(status)&&
    seconds(row?.HR_EXTRA_SOLICITADO)===0&&accumulated!==null&&accumulated>0&&remaining===accumulated;
}
export function canRemoveScheduleOvertime(row,references) {
  return row?.OBSERVACION==='Trabajo en su dia de descanso.'&&isUnusedOvertime(row,references);
}

export function scheduleDocuments(datos) {
  const documents=new Set();
  for(const item of datos||[]) {
    const groups=[...(item.filaLibres||[]),...(item.filasTrabajo||[]).flatMap(row=>row.celdas||[])];
    for(const group of groups)for(const employee of group.trabajadores||[]) {
      const document=documentKey(employee.nro_documento);if(document)documents.add(document);
    }
  }
  return [...documents];
}
export async function lockOvertimeDocuments(connection,documents) {
  const keys=[...new Set(documents.filter(Boolean).map(document=>'overtime:'+createHash('sha256').update(document).digest('hex').slice(0,48)))].sort();
  if(keys.length>1000)throw Object.assign(new Error('El horario supera el limite de empleados.'),{status:422});
  if(keys.length)await connection.query('INSERT INTO tb_center_sequences (sequence_name,current_value) VALUES ? ON DUPLICATE KEY UPDATE sequence_name=VALUES(sequence_name)',[keys.map(key=>[key,0])]);
}
export async function hasCurrentRestDay(connection,document,date) {
  const [rows]=await connection.execute(`SELECT dl.NUMERO_DOCUMENTO FROM tb_dias_libre dl
    INNER JOIN tb_dias_horario d ON d.ID_DIAS=dl.ID_TRB_DIAS
    WHERE dl.NUMERO_DOCUMENTO=? AND DATE_FORMAT(${SCHEDULE_DAY_SQL},'%Y-%m-%d')=? LIMIT 1 FOR SHARE`,[document,date]);
  return rows.length>0;
}

export async function reconcileRemovedRestOvertime(connection,changes,{userId,store}) {
  let removed=0,preserved=0;
  await lockOvertimeDocuments(connection,changes.map(change=>change.document));
  for(const change of changes) {
    // The legacy overtime table has no store provenance. A rest day elsewhere must preserve the balance.
    if(await hasCurrentRestDay(connection,change.document,change.date)){preserved++;continue;}
    const [rows]=await connection.execute(`SELECT h.*,
      EXISTS(SELECT 1 FROM tb_detalle_papeleta d WHERE d.DET_ID_HR_EXTRA=h.ID_HR_EXTRA) AS has_ballot,
      EXISTS(SELECT 1 FROM tb_autorizar_hr_extra a WHERE a.ID_HORA_EXTRA=h.ID_HR_EXTRA) AS has_authorization
      FROM tb_hora_extra_empleado h WHERE h.NRO_DOCUMENTO_EMPLEADO=?
      AND h.FECHA>=? AND h.FECHA<DATE_ADD(?,INTERVAL 1 DAY)
      AND h.OBSERVACION='Trabajo en su dia de descanso.' FOR UPDATE`,[change.document,change.date,change.date]);
    for(const row of rows) {
      const eligible=canRemoveScheduleOvertime(row,{hasBallot:Boolean(row.has_ballot),hasAuthorization:Boolean(row.has_authorization)});
      if(!eligible){preserved++;continue;}
      // Keep the original balance in an audit record in the same transaction as the schedule change.
      await connection.execute(`INSERT INTO tb_center_overtime_adjustments
        (overtime_id,owner_user_id,store_serie,employee_document,work_date,previous_balance,reason)
        VALUES (?,?,?,?,?,?,?)`,[row.ID_HR_EXTRA,userId,store,change.document,change.date,JSON.stringify(row),'rest_day_changed_to_work']);
      const [result]=await connection.execute(`DELETE h FROM tb_hora_extra_empleado h
        WHERE h.ID_HR_EXTRA=? AND LOWER(TRIM(h.ESTADO))<>'utilizado'
        AND TIME_TO_SEC(h.HR_EXTRA_SOLICITADO)=0
        AND TIME_TO_SEC(h.HR_EXTRA_SOBRANTE)=TIME_TO_SEC(h.HR_EXTRA_ACUMULADO)
        AND NOT EXISTS(SELECT 1 FROM tb_detalle_papeleta d WHERE d.DET_ID_HR_EXTRA=h.ID_HR_EXTRA)
        AND NOT EXISTS(SELECT 1 FROM tb_autorizar_hr_extra a WHERE a.ID_HORA_EXTRA=h.ID_HR_EXTRA)`,[row.ID_HR_EXTRA]);
      if(result.affectedRows!==1)throw new Error('No se pudo conciliar el saldo de horas extras.');
      removed++;
    }
  }
  return {removed,preserved};
}
import {createHash} from 'node:crypto';
