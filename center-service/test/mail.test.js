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
