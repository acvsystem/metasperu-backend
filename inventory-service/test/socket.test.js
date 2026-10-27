import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';

Object.assign(process.env, {
  INVENTORY_JWT_SECRET: 'test-only-secret-'.repeat(8),
  INVENTORY_IMPORT_SECRET: 'test-only-import-'.repeat(8),
  CORS_ORIGINS: 'https://qa.example',
  DB_HOST: '127.0.0.1',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  DB_NAME: 'test',
  NODE_ENV: 'test',
});
const { pool } = await import('../src/config/db.js');
const { fingerprint } = await import('../../shared/inventory-security.mjs');
let revoked = false;
pool.getConnection = async () => {
  throw Error('Unexpected DB access');
};
pool.query = async (sql, args) => {
  if (sql.startsWith('INSERT INTO inventory_auth_sessions')) return [{}];
  if (sql.includes('INNER JOIN inventory_auth_sessions'))
    return [
      revoked
        ? []
        : [
            {
              id: 7,
              username: 'test',
              role: 'pocket',
              password: 'hash',
              credential_hash: fingerprint('hash'),
            },
          ],
    ];
  if (sql.includes('FROM inventario_sesiones'))
    return [args[0] === 'ABC123' ? [{ id: 1, estado: 'ACTIVO' }] : []];
  throw Error('Unexpected query');
};
const { security } = await import('../src/config/security.js');
const { initSocket } = await import('../src/config/socket.js');
const server = createServer();
const io = initSocket(server);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const clients = [];
function client(options = {}) {
  const socket = connect(base, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { Origin: 'https://qa.example' },
    ...options,
  });
  clients.push(socket);
  return socket;
}
after(async () => {
  clients.forEach((s) => s.disconnect());
  await new Promise((resolve) => io.close(resolve));
  await pool.end();
});
test('sockets reject unauthenticated and invalid-token connections', async () => {
  for (const token of [undefined, 'invalid']) {
    const socket = client({ auth: { token } });
    const message = await new Promise((resolve, reject) => {
      socket.once('connect_error', (e) => resolve(e.message));
      socket.once('connect', () => reject(Error('Unauthorized socket connected')));
    });
    assert.match(message, /Sesión inválida/);
  }
});
test('cookie-authenticated pocket can join existing active session, not arbitrary store rooms', async () => {
  const { token } = await security.issue({ id: 7, password: 'hash' });
  const socket = client({
    extraHeaders: { Origin: 'https://qa.example', Cookie: 'inventory_session=' + token },
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  assert.deepEqual(await socket.timeout(2000).emitWithAck('join_session', 'ABC123'), {
    success: true,
  });
  assert.deepEqual(await socket.timeout(2000).emitWithAck('join_session', 'OTHER'), {
    success: false,
  });
  const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
  revoked = true;
  socket.emit('join_session', 'ABC123');
  await disconnected;
});
