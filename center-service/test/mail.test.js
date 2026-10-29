import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMailPublisher } from '../../shared/center-mail.mjs';
test('an unresponsive broker times out and closes the channel without exposing connection secrets',async()=>{
  let closed=false;
  const channel=Object.assign(new EventEmitter(),{assertQueue:async()=>{},sendToQueue:()=>false,close:async()=>{closed=true;}});
  const connection=Object.assign(new EventEmitter(),{createConfirmChannel:async()=>channel,close:async()=>{}});
  const publisher=createMailPublisher({connect:async()=>connection,url:'amqp://test:private@example.invalid',timeoutMs:20});
  await assert.rejects(publisher.pushToEmailQueue({email:'qa@example.invalid',subject:'qa',template:'qa'}),error=>
    !error.message.includes('private')&&/confirmar/i.test(error.message));
  assert.ok(closed);await publisher.close();
});
test('broker shutdown cannot hang a timed-out request',async()=>{
  const channel=Object.assign(new EventEmitter(),{assertQueue:async()=>{},sendToQueue:()=>false,close:()=>new Promise(()=>{})});
  const connection=Object.assign(new EventEmitter(),{createConfirmChannel:async()=>channel,close:()=>new Promise(()=>{})});
  const publisher=createMailPublisher({connect:async()=>connection,url:'amqp://qa.invalid',timeoutMs:20});
  await Promise.race([
    assert.rejects(publisher.pushToEmailQueue({email:'qa@example.invalid',subject:'qa',template:'qa'})),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('shutdown stalled')),500))
  ]);
});
test('a connection completed after timeout cannot publish a late email',async()=>{
  let finishConnect,sent=0,closed=0;
  const channel=Object.assign(new EventEmitter(),{sendToQueue:()=>{sent++;return true;}});
  const connection=Object.assign(new EventEmitter(),{createConfirmChannel:async()=>channel,close:async()=>{closed++;}});
  const publisher=createMailPublisher({connect:()=>new Promise(resolve=>{finishConnect=resolve;}),url:'amqp://qa.invalid',timeoutMs:20});
  await assert.rejects(publisher.pushToEmailQueue({email:'qa@example.invalid',subject:'qa',template:'qa'}));
  finishConnect(connection);await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(sent,0);assert.equal(closed,1);await publisher.close();
});
