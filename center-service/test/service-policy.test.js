import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeServiceAction, bindReplySocket } from '../../shared/center-service-policy.mjs';
const res=()=>({status(n){this.code=n;return this;},json(){}});
test('unrelated query parameters cannot grant access to unscoped inventory requests',()=>{
  const response=res();let passed=false;
  authorizeServiceAction('inventory')({user:{role:'OPERACIONES',stores:['A']},method:'GET',route:{path:'/api/inventory/store/:marca/:socketId'},query:{serie:'A'}},response,()=>passed=true);
  assert.equal(passed,false);assert.equal(response.code,403);
});
test('a non-string real target cannot be disguised with an authorized query parameter',()=>{
  const response=res();let passed=false;
  authorizeServiceAction('accounting')({user:{role:'CONTABILIDAD',stores:['A']},method:'POST',route:{path:'/api/cuo/insert'},query:{serie:'A'},body:{serieStore:['B']}},response,()=>passed=true);
  assert.equal(passed,false);assert.equal(response.code,422);
});
test('an exact authorized target is accepted and an unauthorized target is rejected',()=>{
  for(const [serie,expected] of [['A',true],['B',false]]) {
    let passed=false;
    authorizeServiceAction('accounting')({user:{role:'CONTABILIDAD',stores:['A']},method:'POST',route:{path:'/api/cuo/store'},body:{serieStore:serie}},res(),()=>passed=true);
    assert.equal(passed,expected);
  }
});
test('missing and empty store scopes cannot expose country-wide employee ballots',()=>{
  for(const body of [{},{codestore:null,old_codestore:null},{codestore:'',old_codestore:''}]) {
    const response=res();let passed=false;
    authorizeServiceAction('human')({user:{role:'TIENDA',stores:['A']},method:'POST',route:{path:'/api/all/ballot/employes/store'},body},response,()=>passed=true);
    assert.equal(passed,false);assert.equal(response.code,403);
  }
});
test('a room name is never accepted as a socket ID even if it contains the requester',async()=>{
  const response=res();let passed=false;
  const io={in:()=>({fetchSockets:async()=>[{id:'real-socket',data:{principalKind:'user',principal:{id:1}}}]})};
  await bindReplySocket(()=>io)({user:{id:1},body:{socketId:'dashboards'}},response,()=>passed=true);
  assert.equal(passed,false);assert.equal(response.code,403);
});
