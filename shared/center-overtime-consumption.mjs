const fail=(status,message)=>Object.assign(new Error(message),{status});
export function overtimeMinutes(value) {
  if(typeof value!=='string')return null;
  const match=/^(\d{2,3}):([0-5]\d)(?::00)?$/.exec(value);
  return match&&Number(match[1])<=838?Number(match[1])*60+Number(match[2]):null;
}
const format=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;

export async function prepareOvertimeConsumption(connection,document,details) {
  if(typeof document!=='string'||!document.trim()||!Array.isArray(details)||details.length>100)throw fail(422,'Detalle de horas extras invalido.');
  const requested=details.map(row=>({...row,minutes:overtimeMinutes(row?.hrExtraSolicitado)}));
  if(requested.some(row=>row.minutes===null))throw fail(422,'Las horas solicitadas no son validas.');
  const active=requested.filter(row=>row.minutes>0),ids=active.map(row=>row.idHrExtra);
  if(ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw fail(422,'Las horas extras seleccionadas no son validas.');
  if(!ids.length)return [];
  await lockOvertimeDocuments(connection,[document.trim()]);
  const [balances]=await connection.query('SELECT * FROM tb_hora_extra_empleado WHERE ID_HR_EXTRA IN (?) ORDER BY ID_HR_EXTRA FOR UPDATE',[ids]);
  return active.map(detail=>{
    const balance=balances.find(row=>Number(row.ID_HR_EXTRA)===detail.idHrExtra);
    if(!balance||balance.NRO_DOCUMENTO_EMPLEADO?.trim()!==document.trim())throw fail(409,'Un saldo ya no existe o no pertenece al empleado. Vuelva a consultar.');
    const remaining=overtimeMinutes(balance.HR_EXTRA_SOBRANTE),used=overtimeMinutes(balance.HR_EXTRA_SOLICITADO),accumulated=overtimeMinutes(balance.HR_EXTRA_ACUMULADO);
    if(balance.ESTADO!=='correcto'||Number(balance.APROBADO)!==1||remaining===null||used===null||accumulated===null||remaining+used!==accumulated||detail.minutes>remaining) {
      throw fail(409,'El saldo de horas extras cambio o no esta aprobado. Vuelva a consultar.');
    }
    return {idHrExtra:balance.ID_HR_EXTRA,hrExtraAcumulado:balance.HR_EXTRA_ACUMULADO,
      hrExtraSolicitado:format(detail.minutes),hrExtraSobrante:format(remaining-detail.minutes),
      totalSolicitado:format(used+detail.minutes),fecha:balance.FECHA};
  });
}
import {lockOvertimeDocuments} from './center-schedule-overtime.mjs';
