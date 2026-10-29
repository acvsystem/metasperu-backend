import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {migrateCenter} from '../../shared/center-migrations.mjs';
import {reconcileRemovedRestOvertime} from '../../shared/center-schedule-overtime.mjs';
import {prepareOvertimeConsumption} from '../../shared/center-overtime-consumption.mjs';
import {createOvertimeApprovals} from '../../shared/center-overtime-approvals.mjs';
import {deliverNotification} from '../../shared/center-notification-outbox.mjs';
if(process.env.CENTER_QA_HOST!=='127.0.0.1'||process.env.CENTER_QA_DATABASE!=='center_qa')throw new Error('Only the disposable local center_qa schema is permitted.');
const pool=mysql.createPool({host:'127.0.0.1',port:Number(process.env.CENTER_QA_PORT),user:'center_test',password:process.env.CENTER_QA_PASSWORD,database:'center_qa',connectionLimit:5});
test('rest-day reconciliation preserves consumed and referenced balances and rolls back with the schedule',async()=>{
 const connection=await pool.getConnection();
 try{
  await migrateCenter(connection);
  // These tables exist only in the disposable schema explicitly guarded above.
  for(const table of ['tb_hora_extra_empleado','tb_detalle_papeleta','tb_autorizar_hr_extra','tb_dias_libre','tb_dias_trabajo','tb_dias_horario','tb_horario_property'])await connection.query('DROP TABLE IF EXISTS '+table);
  await connection.query(`CREATE TABLE IF NOT EXISTS tb_hora_extra_empleado (ID_HR_EXTRA INT PRIMARY KEY,
   NRO_DOCUMENTO_EMPLEADO VARCHAR(80),FECHA DATE,HR_EXTRA_ACUMULADO TIME,HR_EXTRA_SOLICITADO TIME,
   HR_EXTRA_SOBRANTE TIME,ESTADO VARCHAR(40),APROBADO INT,OBSERVACION VARCHAR(120),ISAPROBACION INT DEFAULT 0)`);
  await connection.query('CREATE TABLE IF NOT EXISTS tb_detalle_papeleta (ID INT AUTO_INCREMENT PRIMARY KEY,DET_ID_HR_EXTRA INT)');
  await connection.query(`CREATE TABLE tb_autorizar_hr_extra (ID_AUTH_HR_EXT INT AUTO_INCREMENT PRIMARY KEY,ID_HORA_EXTRA INT,
    HR_EXTRA_ACOMULADO TIME,NRO_DOCUMENTO_EMPLEADO VARCHAR(80),NOMBRE_COMPLETO VARCHAR(160),APROBADO INT DEFAULT 0,RECHAZADO INT DEFAULT 0,
    FECHA DATE,CODIGO_TIENDA VARCHAR(80),NIVEL VARCHAR(40),COMENTARIO VARCHAR(1000),USUARIO_MODF VARCHAR(80))`);
  await connection.query('CREATE TABLE IF NOT EXISTS tb_dias_horario (ID_DIAS INT PRIMARY KEY,FECHA_NUMBER VARCHAR(40),FECHA VARCHAR(40))');
  await connection.query('CREATE TABLE tb_dias_libre (ID_TRB_DIAS INT,NUMERO_DOCUMENTO VARCHAR(80),ID_TRB_HORARIO INT,NOMBRE_COMPLETO VARCHAR(160))');
  await connection.query('CREATE TABLE tb_dias_trabajo LIKE tb_dias_libre');
  await connection.query('CREATE TABLE tb_horario_property (ID_HORARIO INT PRIMARY KEY,CODIGO_TIENDA VARCHAR(80))');
  await connection.execute('DELETE FROM tb_dias_libre');await connection.execute('DELETE FROM tb_dias_horario');
  await connection.query('DELETE FROM tb_detalle_papeleta');await connection.query('DELETE FROM tb_autorizar_hr_extra');
  await connection.query('DELETE FROM tb_hora_extra_empleado');await connection.query('DELETE FROM tb_center_overtime_adjustments');
  for(let id=1;id<=5;id++)await connection.execute(`INSERT INTO tb_hora_extra_empleado VALUES (?,'00123456','2026-10-28','08:00','00:00','08:00','correcto',1,'Trabajo en su dia de descanso.',0)`,[id]);
  await connection.execute("UPDATE tb_hora_extra_empleado SET ESTADO='utilizado',HR_EXTRA_SOLICITADO='08:00',HR_EXTRA_SOBRANTE='00:00' WHERE ID_HR_EXTRA=2");
  await connection.execute("UPDATE tb_hora_extra_empleado SET HR_EXTRA_SOLICITADO='01:00',HR_EXTRA_SOBRANTE='07:00' WHERE ID_HR_EXTRA=3");
  await connection.execute('INSERT INTO tb_detalle_papeleta (DET_ID_HR_EXTRA) VALUES (4)');
  await connection.execute('INSERT INTO tb_autorizar_hr_extra (ID_HORA_EXTRA) VALUES (5)');
  const change=[{document:'00123456',date:'2026-10-28'}],actor={userId:1,store:'QA01'};
  await connection.execute("INSERT INTO tb_dias_horario VALUES (1,'28-10-2026','2026-10-28')");
  await connection.execute("INSERT INTO tb_dias_libre VALUES (1,'00123456',1,'QA Employee')");
  await connection.beginTransaction();assert.deepEqual(await reconcileRemovedRestOvertime(connection,change,actor),{removed:0,preserved:1});await connection.commit();
  await connection.execute('DELETE FROM tb_dias_libre');
  await connection.beginTransaction();assert.deepEqual(await reconcileRemovedRestOvertime(connection,change,actor),{removed:1,preserved:4});await connection.rollback();
  assert.equal((await connection.query('SELECT COUNT(*) n FROM tb_hora_extra_empleado'))[0][0].n,5);
  assert.equal((await connection.query('SELECT COUNT(*) n FROM tb_center_overtime_adjustments'))[0][0].n,0);
  await connection.beginTransaction();assert.deepEqual(await reconcileRemovedRestOvertime(connection,change,actor),{removed:1,preserved:4});await connection.commit();
  assert.deepEqual((await connection.query('SELECT ID_HR_EXTRA FROM tb_hora_extra_empleado ORDER BY ID_HR_EXTRA'))[0].map(row=>row.ID_HR_EXTRA),[2,3,4,5]);
  const [[audit]]=await connection.query('SELECT * FROM tb_center_overtime_adjustments');assert.equal(audit.overtime_id,1);assert.equal(audit.store_serie,'QA01');
  await connection.beginTransaction();const next=await prepareOvertimeConsumption(connection,'00123456',[{idHrExtra:3,hrExtraSolicitado:'02:00',hrExtraSobrante:'00:00'}]);
  assert.equal(next[0].hrExtraSobrante,'05:00');assert.equal(next[0].totalSolicitado,'03:00');
  await assert.rejects(prepareOvertimeConsumption(connection,'DIFFERENT',[{idHrExtra:3,hrExtraSolicitado:'01:00'}]),error=>error.status===409);
  await assert.rejects(prepareOvertimeConsumption(connection,'00123456',[{idHrExtra:2,hrExtraSolicitado:'01:00'}]),error=>error.status===409);
  await assert.rejects(prepareOvertimeConsumption(connection,'00123456',[{idHrExtra:3,hrExtraSolicitado:'08:00'}]),error=>error.status===409);
  await connection.rollback();
  const response=()=>({code:200,status(n){this.code=n;return this;},json(value){this.body=value;}});
  const approvals=createOvertimeApprovals(pool,{recipients:['qa@example.invalid']}),actorUser={id:1,role:'RRHH',username:'VERIFIED',allStores:true,stores:[]};
  await connection.execute("INSERT INTO tb_horario_property VALUES (1,'QA01')");
  await connection.execute("INSERT INTO tb_dias_trabajo VALUES (1,'00123456',1,'QA Employee')");
  await connection.execute("UPDATE tb_hora_extra_empleado SET ESTADO='aprobar',APROBADO=0 WHERE ID_HR_EXTRA=3");
  await connection.execute('DELETE FROM tb_center_notification_outbox');
  const missing=response();await approvals.request({user:actorUser,body:{id_hora_extra:1,nroDocumento:'00123456',codigoTienda:'QA01'}},missing);assert.equal(missing.code,409);
  const requested=response();await approvals.request({user:actorUser,body:{id_hora_extra:3,nroDocumento:'00123456',codigoTienda:'QA01',nombreCompleto:'FAKE',horasAcumuladas:'99:00'}},requested);
  assert.equal(requested.code,201,JSON.stringify(requested));
  const [[stored]]=await connection.execute('SELECT * FROM tb_autorizar_hr_extra WHERE ID_AUTH_HR_EXT=?',[requested.body.id]);
  assert.equal(stored.NOMBRE_COMPLETO,'QA Employee');assert.equal(stored.HR_EXTRA_ACOMULADO,'08:00:00');
  const wrong=response();await approvals.decide({user:actorUser,body:{id_auth_hrx:stored.ID_AUTH_HR_EXT,id_hrx:2,aprobado:true}},wrong);assert.equal(wrong.code,409);
  const decided=response();await approvals.decide({user:actorUser,body:{id_auth_hrx:stored.ID_AUTH_HR_EXT,id_hrx:3,aprobado:true,usuario:'SPOOFED'}},decided);assert.equal(decided.code,200);
  const [[updated]]=await connection.execute('SELECT USUARIO_MODF FROM tb_autorizar_hr_extra WHERE ID_AUTH_HR_EXT=?',[stored.ID_AUTH_HR_EXT]);assert.equal(updated.USUARIO_MODF,'VERIFIED');
  const repeat=response();await approvals.decide({user:actorUser,body:{id_auth_hrx:stored.ID_AUTH_HR_EXT,id_hrx:3,aprobado:true}},repeat);assert.equal(repeat.body.duplicate,true);
  const [[messages]]=await connection.execute('SELECT COUNT(*) AS n FROM tb_center_notification_outbox');assert.equal(messages.n,2);
  const [emailColumns]=await connection.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tb_lista_tienda' AND COLUMN_NAME='EMAIL'");
  if(!emailColumns.length)await connection.query('ALTER TABLE tb_lista_tienda ADD COLUMN EMAIL VARCHAR(120)');
  await connection.execute("INSERT INTO tb_autorizar_hr_extra (ID_HORA_EXTRA,CODIGO_TIENDA,NIVEL) VALUES (999,'QA02','GENERAL')");
  const listing=response();await approvals.list({user:{role:'OPERACIONES',stores:['QA01']},query:{page:'1',limit:'1'}},listing);
  assert.equal(listing.code,200,JSON.stringify(listing));assert.equal(listing.body.total,1);assert.equal(listing.body.data.length,1);assert.equal(listing.body.data[0].store_code,'QA01');
  await deliverNotification(pool,{pushToEmailQueue:async()=>{throw Error('simulated broker failure');}});
  const [[pending]]=await connection.execute("SELECT COUNT(*) AS n FROM tb_center_notification_outbox WHERE status='pending'");assert.equal(pending.n,2);
  await connection.execute('UPDATE tb_center_notification_outbox SET next_attempt=UTC_TIMESTAMP()');
  let published=0;await deliverNotification(pool,{pushToEmailQueue:async message=>{assert.ok(message.messageId);published++;}});assert.equal(published,1);
 }finally{connection.release();await pool.end();}
});
