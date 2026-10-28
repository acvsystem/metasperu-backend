import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserController } from '../../shared/center-users.mjs';
const response=()=>({code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}});
test('invalid roles and short or excessive bcrypt passwords never reach the database',async()=>{
  const controller=createUserController({pool:{getConnection(){throw Error('unexpected database access');}}});
  for(const change of [{PASSWORD:'short'},{PASSWORD:'á'.repeat(40)},{NIVEL:'ROOT'}]){
    const res=response();await controller.create({user:{role:'SISTEMAS'},body:{USUARIO:'test',EMAIL:'qa@example.invalid',
      NIVEL:'TIENDA',CODE_STORE:'QA01',DEFAULT_PAGE:'dashboard',PASSWORD:'a-long-passphrase',...change}},res);
    assert.equal(res.code,422);
  }
});
test('the last system administrator cannot be deleted and locks are released',async()=>{
  let rolledBack=false,released=false;
  const connection={beginTransaction:async()=>{},execute:async sql=>{
    if(sql.includes("NIVEL='SISTEMAS'"))return [[{ID_LOGIN:1}]];
    if(sql.startsWith('SELECT ID_LOGIN,NIVEL'))return [[{ID_LOGIN:1,NIVEL:'SISTEMAS'}]];
    throw Error('must not mutate');
  },rollback:async()=>{rolledBack=true;},release:()=>{released=true;}};
  const controller=createUserController({pool:{getConnection:async()=>connection}}),res=response();
  await controller.remove({user:{role:'SISTEMAS',id:2},body:{id:1}},res);
  assert.equal(res.code,409);assert.ok(rolledBack&&released);
});
