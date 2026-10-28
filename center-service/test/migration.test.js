import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateCenter } from '../../shared/center-migrations.mjs';

test('migration refuses duplicate recording batches before changing the schema', async () => {
  const statements=[];
  const db={execute:async(sql)=>{
    statements.push(sql);
    if(sql.includes('GET_LOCK'))return [[{locked:1}]];
    if(sql.includes('RELEASE_LOCK'))return [[{released:1}]];
    if(sql.includes('information_schema.tables'))return [[{TABLE_NAME:'tb_rrweb_event_batches'}]];
    if(sql.includes('HAVING COUNT'))return [[{session_id:'legacy',sequence_number:1}]];
    return [[]];
  }};
  await assert.rejects(migrateCenter(db),/duplicados/i);
  assert.equal(statements.some(sql=>/^(CREATE|ALTER|DELETE)/i.test(sql)),false);
  assert.ok(statements.some(sql=>sql.includes('RELEASE_LOCK')));
});
