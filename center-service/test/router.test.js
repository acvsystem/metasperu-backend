import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createCenterRouter } from '../../shared/center-router.mjs';
import { centerErrorHandler } from '../../shared/center-http.mjs';
test('an asynchronous controller failure reaches the error boundary and the service keeps serving',async()=>{
  const app=express(),router=createCenterRouter(express.Router);
  router.use((_req,_res,next)=>next());
  router.get('/failed',async()=>{await Promise.resolve();throw Error('private database details');});
  router.get('/ok',async(_req,res)=>res.json({ok:true}));app.use(router);app.use(centerErrorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const origin='http://127.0.0.1:'+server.address().port,failed=await fetch(origin+'/failed');
    assert.equal(failed.status,500);assert.ok(!(await failed.text()).includes('private'));
    assert.equal((await fetch(origin+'/ok')).status,200);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
