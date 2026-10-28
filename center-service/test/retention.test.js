import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeExpiredRecordings } from '../../shared/center-retention.mjs';
test('retention is bounded and deletes only the rows locked by this run',async()=>{
  const calls=[];let released=false;
  const connection={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>released=true,
    query:async(sql,args)=>{calls.push({sql,args});return sql.startsWith('SELECT')?[[{session_id:'expired-owned-row'}]]:[{affectedRows:1}];}};
  assert.deepEqual(await purgeExpiredRecordings({getConnection:async()=>connection}),{deleted:1});
  assert.ok(calls[0].sql.includes('SKIP LOCKED'));assert.deepEqual(calls[0].args,[30,100]);
  assert.deepEqual(calls[1].args,[['expired-owned-row']]);assert.ok(released);
  await assert.rejects(purgeExpiredRecordings({}, {days:0}),/invalida/);
});
