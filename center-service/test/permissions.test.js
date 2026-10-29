import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionController } from '../../shared/center-permissions.mjs';
const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;}});
test('invalid assignments cannot erase existing permissions and systems retains a module',async()=>{
  const controller=createPermissionController({getConnection(){throw Error('must not query');}});
  for(const [method,body,code] of [['assignStores',{ID_USUARIO:1,TIENDAS:[{id:'invalid'}]},422],['assignStores',{ID_USUARIO:1,TIENDAS:{}},422],['assignMenu',{NIVEL:'SISTEMAS',MENUS:[]},409]]){
    const res=response();await controller[method]({user:{role:'SISTEMAS'},body},res);assert.equal(res.code,code);
  }
});
