import test from 'node:test';
import assert from 'node:assert/strict';
import {canReadHrStore,scheduleStorePredicate,parseBallotDate,lockBallotForDateChange} from '../../shared/center-hr-scope.mjs';

test('schedule queries include only verified store assignments and fail closed without assignments',()=>{
  assert.deepEqual(scheduleStorePredicate({role:'TIENDA',stores:['QA01','QA02','QA01']}),{sql:' WHERE H.CODIGO_TIENDA IN (?,?)',values:['QA01','QA02']});
  assert.equal(scheduleStorePredicate({role:'TIENDA',stores:[]}).sql,' WHERE 1=0');
  assert.equal(scheduleStorePredicate({role:'RRHH'}).sql,'');
  assert.equal(canReadHrStore({role:'TIENDA',stores:['QA01']},'QA02'),false);
});
test('ballot edits reject impossible dates, mismatched IDs and unprivileged callers before writing',async()=>{
  assert.equal(parseBallotDate('2026-02-30'),null);assert.equal(parseBallotDate('2026-10-29'),'2026-10-29');
  let calls=0;const connection={execute:async(sql,values)=>{calls++;assert.match(sql,/FOR UPDATE/);assert.deepEqual(values,[1,'QA']);return [[]];}};
  const body={id_papeleta:1,codeBallot:'QA',nueva_fecha:'2026-10-29'};
  await assert.rejects(lockBallotForDateChange(connection,{role:'TIENDA',stores:['QA01']},body),error=>error.status===403);assert.equal(calls,0);
  await assert.rejects(lockBallotForDateChange(connection,{role:'RRHH'},{...body,nueva_fecha:'2026-02-30'}),error=>error.status===422);assert.equal(calls,0);
  await assert.rejects(lockBallotForDateChange(connection,{role:'RRHH'},body),error=>error.status===404);assert.equal(calls,1);
});
