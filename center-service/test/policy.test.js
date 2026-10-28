import test from 'node:test';
import assert from 'node:assert/strict';
import { centerActionAllowed } from '../../shared/center-policy.mjs';
test('a store cannot administer users, roles, HR records, recordings or logs', () => {
  const user = { role: 'TIENDA' };
  for (const path of ['/api/configuration/usuario/update','/api/maintenance/head-papeleta/1','/api/rrweb/sessions','/api/logs','/api/delete/client/x']) {
    for (const method of ['GET','POST','PUT','DELETE']) assert.equal(centerActionAllowed(user, method, path), false);
  }
});
test('store users can record their own session but cannot list recordings', () => {
  assert.equal(centerActionAllowed({ role: 'TIENDA' }, 'POST', '/api/rrweb/events'), true);
  assert.equal(centerActionAllowed({ role: 'TIENDA' }, 'GET', '/api/rrweb/sessions'), false);
});
test('unknown and anonymous operations are denied by default', () => {
  assert.equal(centerActionAllowed(null, 'GET', '/api/store'), false);
  assert.equal(centerActionAllowed({ role: 'OTHER' }, 'POST', '/api/new-admin-action'), false);
});
