import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordingController } from '../../shared/center-recordings.mjs';
const response = () => ({code:200, status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
test('another user cannot append to a recording and the transaction rolls back', async()=>{
  let rolledBack=false,inserted=false,released=false;
  const connection={beginTransaction:async()=>{},execute:async sql=>{
    if(sql.startsWith('SELECT owner'))return [[{owner_user_id:99}]];inserted=true;return [[]];
  },rollback:async()=>rolledBack=true,release:()=>released=true};
  const controller=createRecordingController({getConnection:async()=>connection});const res=response();
  await controller.saveEvents({user:{id:1},body:{sessionId:'recording_123',sequenceNumber:1,events:[{type:1}]}},res);
  assert.equal(res.code,403);assert.equal(inserted,false);assert.ok(rolledBack&&released);
});
test('a store cannot list or replay recordings',async()=>{
  const controller=createRecordingController({execute:()=>{throw Error('must not query');}});
  for(const method of ['listSessions','getSessionEvents']){
    const res=response();await controller[method]({user:{role:'TIENDA'}},res);assert.equal(res.code,403);
  }
});
test('oversized and malformed batches are rejected before database work',async()=>{
  const controller=createRecordingController({});
  for(const events of [[],Array(101).fill({type:1}),[{data:'x'.repeat(1024*1024)}]]){
    const res=response();await controller.saveEvents({body:{sessionId:'recording_123',sequenceNumber:1,events},user:{id:1}},res);
    assert.ok([413,422].includes(res.code));
  }
});
