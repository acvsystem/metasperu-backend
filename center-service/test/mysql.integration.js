import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp,readFile,rmdir } from 'node:fs/promises';
import { createExportQueue } from '../../shared/center-export-jobs.mjs';
import { prepareExportDirectory,artifactPath } from '../../shared/center-export-files.mjs';
import { runExportThread } from '../../shared/center-export-runner.mjs';
import { createPermissionController } from '../../shared/center-permissions.mjs';
import { createAttendanceRequests } from '../../shared/center-attendance-requests.mjs';
import { createCenterAuthController } from '../../shared/center-auth-controller.mjs';
import { randomUUID } from 'node:crypto';
import { createTransferRegistration,createTransferHistory } from '../../shared/center-transfers.mjs';
import { purgeExpiredRecordings } from '../../shared/center-retention.mjs';
import { createUserController } from '../../shared/center-users.mjs';
import { migrateCenter } from '../../shared/center-migrations.mjs';
import { createCenterSecurity } from '../../shared/center-security.mjs';
import { createRecordingController } from '../../shared/center-recordings.mjs';

// Deliberately refuses production hosts/databases. This suite owns its disposable schema.
if(process.env.CENTER_QA_DATABASE!=='center_qa'||process.env.CENTER_QA_HOST!=='127.0.0.1') {
  throw new Error('Use exclusivamente CENTER_QA_HOST=127.0.0.1 y CENTER_QA_DATABASE=center_qa.');
}
const pool=mysql.createPool({host:'127.0.0.1',port:Number(process.env.CENTER_QA_PORT),user:'center_test',
  password:process.env.CENTER_QA_PASSWORD,database:'center_qa',connectionLimit:8});
const response=()=>({code:200,headers:{},set(name,value){this.headers[name]=value;return this;},cookie(name,value,options){this.cookieValue={name,value,options};return this;},clearCookie(name,options){this.cleared={name,options};return this;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
const user={id:1,username:'qa',role:'TIENDA',code_store:'QA01'};
const call=async(controller,method,extra={})=>{
  const res=response();await controller[method]({user,...extra},res);return res;
};

test('MySQL: additive migration, revocation and concurrent recording retries',async()=>{
  const connection=await pool.getConnection();
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS tb_login (ID_LOGIN INT PRIMARY KEY,USUARIO VARCHAR(80),
      EMAIL VARCHAR(120),NIVEL VARCHAR(30),CODE_STORE VARCHAR(80),OLD_CODE_STORE VARCHAR(80))`);
    await connection.query('CREATE TABLE IF NOT EXISTS tb_lista_tienda (ID_TIENDA INT PRIMARY KEY,SERIE_TIENDA VARCHAR(80),OLD_SERIE_TIENDA VARCHAR(80),UNID_SERVICIO VARCHAR(80))');
    await connection.query('CREATE TABLE IF NOT EXISTS tb_usuario_tiendas_asignadas (ID_USUARIO_TASG INT,ID_TIENDA_TASG INT)');
    await connection.query(`CREATE TABLE IF NOT EXISTS tb_head_traspasos (ID_TRASPASOS INT AUTO_INCREMENT PRIMARY KEY,
      CODIGO_TRASPASO VARCHAR(80),UNIDAD_SERVICIO VARCHAR(80),TIENDA_ORIGEN VARCHAR(80),TIENDA_DESTINO VARCHAR(80),
      CODIGO_ALM_ORIGEN VARCHAR(80),CODIGO_ALM_DESTINO VARCHAR(80),DATETIME DATETIME)`);
    await connection.query(`CREATE TABLE IF NOT EXISTS tb_detalle_traspasos (ID INT AUTO_INCREMENT PRIMARY KEY,
      CODIGO_BARRA VARCHAR(255),CODIGO_ARTICULO VARCHAR(255),DESCRIPCION VARCHAR(255),TALLA VARCHAR(255),COLOR VARCHAR(255),
      STOCK DECIMAL(12,2),STOCK_SOLICITADO DECIMAL(12,2),CODIGO_TRASPASO VARCHAR(80))`);
    await migrateCenter(connection);await migrateCenter(connection);
    await connection.execute('DELETE FROM tb_center_hr_requests');
    await connection.execute('DELETE FROM tb_center_hr_rosters');
    const attendance=createAttendanceRequests(pool);
    await assert.rejects(attendance.begin(1,'socket-a'),error=>error.status===409);
    await attendance.saveRoster(1,[{NUMDOC:'QA-01'}]);
    await attendance.saveRoster(2,[{NUMDOC:'QA-02'}]);
    const [requestA,requestB]=await Promise.all([attendance.begin(1,'socket-a'),attendance.begin(2,'socket-b')]);
    await attendance.saveRoster(1,[{NUMDOC:'CHANGED'}]);
    assert.deepEqual((await attendance.context(1,'socket-a',requestA)).roster,[{NUMDOC:'QA-01'}]);
    assert.deepEqual((await attendance.context(2,'socket-b',requestB)).roster,[{NUMDOC:'QA-02'}]);
    await assert.rejects(attendance.context(2,'socket-b',requestA),error=>error.status===404);
    await assert.rejects(attendance.complete(1,'wrong-socket',requestA,[]),error=>error.status===404);
    const attendanceRows=[{fecha:'2026-10-29',documento:'QA-01'}];
    const completion=await Promise.all(Array.from({length:5},()=>attendance.complete(1,'socket-a',requestA,attendanceRows)));
    assert.equal(completion.filter(result=>!result.duplicate).length,1);
    await assert.rejects(attendance.complete(1,'socket-a',requestA,[]),error=>error.status===409);
    await assert.rejects(attendance.read(2,requestA),error=>error.status===404);
    assert.deepEqual((await createAttendanceRequests(pool).read(1,requestA)).rows,attendanceRows);
    assert.deepEqual((await attendance.read(1,requestA)).roster,[{NUMDOC:'QA-01'}]);
    await connection.execute('UPDATE tb_center_hr_requests SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?',[requestA]);
    await assert.rejects(attendance.read(1,requestA),error=>error.status===404);
    for(const [name,type] of [['DEFAULT_PAGE','VARCHAR(80)'],['PASSWORD_NW','VARCHAR(100)']]) {
      const [columns]=await connection.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tb_login' AND COLUMN_NAME=?",[name]);
      if(!columns.length)await connection.query(`ALTER TABLE tb_login ADD COLUMN ${name} ${type}`);
    }
    await connection.execute("REPLACE INTO tb_login (ID_LOGIN,USUARIO,EMAIL,NIVEL,CODE_STORE,OLD_CODE_STORE) VALUES (1,'qa','qa@example.invalid','TIENDA','QA01',NULL)");
    await connection.execute("DELETE FROM tb_rrweb_sessions WHERE session_id='qa_recording_001'");
    await connection.execute('DELETE FROM tb_usuario_tiendas_asignadas WHERE ID_USUARIO_TASG=1');
    const security=createCenterSecurity({jwt,pool,secret:'qa-only-'.repeat(12)});
    const issued=await security.issue({ID_LOGIN:1,NIVEL:'TIENDA'});
    const principal=await security.authenticate(issued.token);
    assert.deepEqual(principal.stores,['QA01']);
    await security.revoke(principal);
    await assert.rejects(security.authenticate(issued.token),error=>error.status===401);

    for(const name of ['COD_ALMACEN','TIPO_TIENDA','DESCRIPCION']) {
      const [columns]=await connection.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tb_lista_tienda' AND COLUMN_NAME=?",[name]);
      if(!columns.length)await connection.query(`ALTER TABLE tb_lista_tienda ADD COLUMN ${name} VARCHAR(80)`);
    }
    await connection.execute("REPLACE INTO tb_lista_tienda (ID_TIENDA,SERIE_TIENDA,OLD_SERIE_TIENDA,UNID_SERVICIO,COD_ALMACEN,TIPO_TIENDA,DESCRIPCION) VALUES (1,'QA01',NULL,'QA','ALM01','VSBA','Primera'),(2,'QA02',NULL,'QA','ALM02','VSBA','Segunda')");
    await connection.execute("UPDATE tb_login SET NIVEL='SISTEMAS' WHERE ID_LOGIN=1");
    const issuedAgain=await security.issue({ID_LOGIN:1,NIVEL:'SISTEMAS'});
    const users=createUserController({pool,hash:async()=>'qa-hash-no-real-password'});
    const update=await call(users,'update',{user:{role:'SISTEMAS',id:1},body:{ID:1,USUARIO:'qa-admin',EMAIL:'qa@example.invalid',
      NIVEL:'SISTEMAS',CODE_STORE:'QA01',DEFAULT_PAGE:'dashboard'}});
    assert.equal(update.code,200,JSON.stringify(update));
    await assert.rejects(security.authenticate(issuedAgain.token),error=>error.status===401);
    assert.equal((await call(users,'remove',{user:{role:'SISTEMAS',id:2},body:{id:1}})).code,409);
    const listing=await call(users,'list',{user:{role:'SISTEMAS'},query:{q:'qa-admin',limit:'1'}});
    assert.equal(listing.body.rows.length,1);assert.equal(listing.body.rows[0].PASSWORD_NW,undefined);

    await connection.query('CREATE TABLE IF NOT EXISTS tb_menu_sistema (ID_MENU INT PRIMARY KEY,NOMBRE_MENU VARCHAR(80),RUTA VARCHAR(80))');
    await connection.query('CREATE TABLE IF NOT EXISTS tb_permiso_sistema (NIVEL VARCHAR(80),ID_MENU_PS INT,PRIMARY KEY(NIVEL,ID_MENU_PS))');
    await connection.execute("REPLACE INTO tb_menu_sistema VALUES (1,'QA','dashboard')");
    await connection.execute("REPLACE INTO tb_permiso_sistema VALUES ('SISTEMAS',1)");
    await connection.execute('UPDATE tb_login SET PASSWORD_NW=? WHERE ID_LOGIN=1',[await bcrypt.hash('qa-only-passphrase',12)]);
    const auth=createCenterAuthController({pool,getSecurity:()=>security,compare:bcrypt.compare});
    const logged=response();await auth.login({body:{username:'qa-admin',password:'qa-only-passphrase'}},logged);
    assert.equal(logged.code,200,JSON.stringify(logged.body));assert.ok(logged.cookieValue.options.httpOnly&&logged.cookieValue.options.secure);
    assert.equal(logged.body.user.PASSWORD_NW,undefined);assert.equal(logged.body.menu[0].ruta,'dashboard');
    const current=await security.authenticate(logged.cookieValue.value),restored=response();
    await auth.check({user:current},restored);assert.equal(restored.body.id,1);assert.equal(restored.body.menu[0].ruta,'dashboard');
    const loggedOut=response();await auth.logout({user:current},loggedOut);assert.equal(loggedOut.cleared.name,'center_session');
    await assert.rejects(security.authenticate(logged.cookieValue.value),error=>error.status===401);
    const invalid=response();await auth.login({body:{username:'qa-admin',password:'wrong-password'}},invalid);assert.equal(invalid.code,401);

    const [assignmentColumns]=await connection.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tb_usuario_tiendas_asignadas' AND COLUMN_NAME='DESCRIPCION_TIENDA'");
    if(!assignmentColumns.length)await connection.query('ALTER TABLE tb_usuario_tiendas_asignadas ADD COLUMN DESCRIPCION_TIENDA VARCHAR(120)');
    const permissions=createPermissionController(pool),beforePermission=await security.issue({ID_LOGIN:1,NIVEL:'SISTEMAS'}),assigned=response();
    await permissions.assignStores({user:{id:1,role:'SISTEMAS'},body:{ID_USUARIO:1,TIENDAS:[{id:2,nombre:'FAKE CLIENT LABEL'}]}},assigned);
    assert.equal(assigned.code,200);await assert.rejects(security.authenticate(beforePermission.token),error=>error.status===401);
    const [[actualStore]]=await pool.execute('SELECT DESCRIPCION_TIENDA FROM tb_usuario_tiendas_asignadas WHERE ID_USUARIO_TASG=1');assert.equal(actualStore.DESCRIPCION_TIENDA,'Segunda');
    const beforeMenu=await security.issue({ID_LOGIN:1,NIVEL:'SISTEMAS'}),menuChanged=response();
    await permissions.assignMenu({user:{role:'SISTEMAS'},body:{NIVEL:'SISTEMAS',MENUS:[1]}},menuChanged);assert.equal(menuChanged.code,200);
    await assert.rejects(security.authenticate(beforeMenu.token),error=>error.status===401);

    const controller=createRecordingController(pool),sessionId='qa_recording_001';
    assert.equal((await call(controller,'startSession',{body:{sessionId,pageUrl:'https://center.example/test?private=value'}})).code,201);
    const body={sessionId,sequenceNumber:1,events:[{type:1,data:{text:'masked'}}]};
    const results=await Promise.all(Array.from({length:8},()=>call(controller,'saveEvents',{body})));
    assert.ok(results.every(res=>res.code===200),JSON.stringify(results));
    assert.equal(results.filter(res=>!res.body.duplicate).length,1);
    const [[row]]=await pool.execute('SELECT event_count,page_url FROM tb_rrweb_sessions WHERE session_id=?',[sessionId]);
    assert.equal(row.event_count,1);assert.equal(row.page_url,'https://center.example/test');
    assert.equal((await call(controller,'saveEvents',{body:{...body,events:[{type:2}]}})).code,409);
    assert.equal((await call(controller,'saveEvents',{user:{...user,id:2},body})).code,403);
    assert.equal((await call(controller,'endSession',{body:{sessionId}})).code,200);
    assert.equal((await call(controller,'saveEvents',{body:{...body,sequenceNumber:2}})).code,409);
    const playback=await call(controller,'getSessionEvents',{user:{role:'SISTEMAS'},params:{sessionId},query:{}});
    assert.equal(playback.code,200);assert.deepEqual(playback.body.events,body.events);
    await connection.execute('UPDATE tb_rrweb_sessions SET started_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 90 DAY) WHERE session_id=?',[sessionId]);
    assert.equal((await purgeExpiredRecordings(pool)).deleted,1);
    const [[remaining]]=await pool.execute('SELECT COUNT(*) AS n FROM tb_rrweb_event_batches WHERE session_id=?',[sessionId]);
    assert.equal(remaining.n,0,'retention must cascade only expired sessions');

    const register=createTransferRegistration(pool),transfer={requestId:randomUUID(),origin_serie:'QA01',destination_serie:'QA02',
      unid_service:'QA',store_origin:'QA Store 1',store_destination:'QA Store 2',code_warehouse_origin:'ALM01',code_warehouse_destination:'ALM02',
      datetime:'2026-10-28 12:00:00',details:[{barcode:'123',article_code:'ART1',description:'QA',size:'',color:'',stock:10,stock_required:2}]};
    const invoke=async(body)=>{const res=response();await register({user,body},res);return res;};
    const registrations=await Promise.all(Array.from({length:5},()=>invoke(transfer)));
    assert.ok(registrations.every(res=>res.code===200),JSON.stringify(registrations));
    assert.equal(new Set(registrations.map(res=>res.body.data.code_transfer)).size,1);
    assert.equal(registrations.filter(res=>!res.body.duplicate).length,1);
    const different=await Promise.all(Array.from({length:4},()=>invoke({...transfer,requestId:randomUUID()})));
    assert.ok(different.every(res=>res.code===200),JSON.stringify(different));
    assert.equal(new Set(different.map(res=>res.body.data.code_transfer)).size,4);
    assert.equal((await invoke({...transfer,details:[{...transfer.details[0],stock_required:3}]})).code,409);
    const history=createTransferHistory(pool),historyPage=response();
    await history({user:{allStores:true},query:{limit:'2'}},historyPage);
    assert.equal(historyPage.code,200);assert.equal(historyPage.body.data.length,2);assert.ok(historyPage.body.total>=5);
    const forbidden=response();await history({user:{allStores:false,stores:['FOREIGN']},query:{}},forbidden);
    assert.equal(forbidden.body.total,0);

    const exportRoot=await mkdtemp(path.join(os.tmpdir(),'center-owned-export-qa-'));
    try {
      await prepareExportDirectory(exportRoot);
      Object.assign(process.env,{DB_HOST:'127.0.0.1',DB_PORT:process.env.CENTER_QA_PORT,DB_USER:'center_test',DB_PASSWORD:process.env.CENTER_QA_PASSWORD,DB_NAME:'center_qa'});
      const queue=createExportQueue(pool),requestId=randomUUID();
      await pool.execute("UPDATE tb_center_export_jobs SET status='cancelled' WHERE status IN ('queued','running')");
      await queue.heartbeat('exports:qa');assert.ok(await queue.workerReady());
      const created=await queue.enqueue(1,{requestId,kind:'transfers',q:'QA Store 1'});
      assert.equal((await queue.enqueue(1,{requestId,kind:'transfers',q:'QA Store 1'})).id,created.id);
      await assert.rejects(queue.enqueue(2,{requestId,kind:'transfers'}),error=>error.status===409);
      const job=await queue.claim();assert.equal(job.id,created.id);
      await runExportThread(job,exportRoot);
      const complete=await queue.find(1,created.id);assert.equal(complete.status,'completed');assert.equal(complete.progress,100);
      assert.equal(await queue.find(2,created.id),null);
      const csv=await readFile(artifactPath(exportRoot,created.id,complete.artifact_key),'utf8');
      assert.ok(csv.includes('CODIGO_TRASPASO'));assert.ok(csv.includes('QA Store 1'));
      const cancelled=await queue.enqueue(1,{kind:'recordings'}),cancelledJob=await queue.claim();
      assert.equal(cancelledJob.id,cancelled.id);await queue.cancel(1,cancelled.id);
      await assert.rejects(runExportThread(cancelledJob,exportRoot));
      assert.equal((await queue.find(1,cancelled.id)).status,'cancelled');
      await pool.execute('UPDATE tb_center_export_jobs SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id IN (?,?)',[created.id,cancelled.id]);
      await queue.prune(exportRoot);assert.equal(await queue.find(1,created.id),null);
      const admissions=await Promise.allSettled(Array.from({length:12},()=>queue.enqueue(1,{kind:'transfers'})));
      assert.equal(admissions.filter(result=>result.status==='fulfilled').length,10);
      assert.ok(admissions.filter(result=>result.status==='rejected').every(result=>result.reason.status===429));
      await pool.execute("UPDATE tb_center_export_jobs SET status='cancelled',expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE status='queued'");
      await queue.prune(exportRoot);
    } finally {await rmdir(exportRoot);}

  } finally { connection.release();await pool.end(); }
});
