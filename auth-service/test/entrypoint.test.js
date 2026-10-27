import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isProcessEntrypoint } from '../../shared/process-entrypoint.mjs';

const app = new URL('../src/app.js', import.meta.url);
const path = fileURLToPath(app);

test('starts a service invoked directly by node', () => {
  assert.equal(isProcessEntrypoint(app, { argv: ['node', path], env: {} }), true);
});

test('starts the exact service loaded through the PM2 fork wrapper', () => {
  assert.equal(isProcessEntrypoint(app, {
    argv: ['node', '/pm2/lib/ProcessContainerFork.js'],
    env: { pm_exec_path: path },
  }), true);
});

test('imported modules do not start additional servers', () => {
  const other = fileURLToPath(new URL('./auth.test.js', import.meta.url));
  assert.equal(isProcessEntrypoint(app, {
    argv: ['node', other], env: { pm_exec_path: other },
  }), false);
  assert.equal(isProcessEntrypoint(app, { argv: ['node'], env: {} }), false);
});
