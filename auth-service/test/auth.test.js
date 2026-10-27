import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import bcrypt from 'bcrypt';

Object.assign(process.env, {
  INVENTORY_JWT_SECRET: 'test-only-secret-'.repeat(8),
  CORS_ORIGINS: 'https://qa.example',
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_USER: 'test',
  DB_PASSWORD: 'test',
  DB_NAME: 'test',
});
const { pool } = await import('../src/config/db.js');
const { poolCenter } = await import('../src/config/db-center.js');
pool.getConnection = poolCenter.getConnection = async () => {
  throw Error('Unexpected DB access');
};
poolCenter.query = async () => {
  throw Error('Unexpected center access');
};
const hash = await bcrypt.hash('Test-password-123', 4);
const { fingerprint } = await import('../../shared/inventory-security.mjs');
let active = true,
  revoked = false;
pool.query = async (sql, args) => {
  if (sql.includes('WHERE username'))
    return [
      [{ id: 7, username: 'test', password: hash, estado: active ? 1 : 0, role: 'administrador' }],
    ];
  if (sql.startsWith('INSERT')) {
    revoked = false;
    return [{}];
  }
  if (sql.startsWith('UPDATE')) {
    revoked = true;
    return [{}];
  }
  if (sql.includes('INNER JOIN inventory_auth_sessions'))
    return [
      revoked || !active
        ? []
        : [
            {
              id: 7,
              username: 'test',
              password: hash,
              credential_hash: fingerprint(hash),
              role: 'administrador',
            },
          ],
    ];
  throw Error('Unexpected query');
};
const { createApp } = await import('../src/app.js');
const server = createServer(createApp());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/s2/auth`;
const headers = { Origin: 'https://qa.example', 'Content-Type': 'application/json' };
const body = JSON.stringify({ username: 'test', password: 'Test-password-123' });
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  await poolCenter.end();
});

test('login rejects inactive users and invalid input', async () => {
  active = false;
  assert.equal((await fetch(base + '/login', { method: 'POST', headers, body })).status, 401);
  active = true;
  assert.equal(
    (
      await fetch(base + '/login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ username: {}, password: [] }),
      })
    ).status,
    400,
  );
});
test('login uses a bounded HttpOnly cookie and logout invalidates that same session', async () => {
  const login = await fetch(base + '/login', { method: 'POST', headers, body });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=None', 'Max-Age=28800'])
    assert.ok(cookie.includes(flag), flag);
  const response = await login.json();
  assert.equal(response.token, undefined);
  assert.equal(response.user.password, undefined);
  const sessionCookie = cookie.split(';')[0];
  assert.equal(
    (await fetch(base + '/check-session', { headers: { ...headers, Cookie: sessionCookie } }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(base + '/logout', {
        method: 'POST',
        headers: { ...headers, Cookie: sessionCookie },
        body: '{}',
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(base + '/check-session', { headers: { ...headers, Cookie: sessionCookie } }))
      .status,
    401,
  );
});
test('login throttles repeated attempts', async () => {
  let status;
  for (let i = 0; i < 11; i++)
    status = (await fetch(base + '/login', { method: 'POST', headers, body: '{}' })).status;
  assert.equal(status, 429);
});
