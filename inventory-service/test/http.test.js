import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Explicit test-only values before imports; the real .env is never consulted for credentials.
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
pool.getConnection = async () => {
  throw Error('Unexpected database access in test');
};
let role = 'administrador';
pool.query = async (sql) => {
  if (sql.startsWith('INSERT INTO inventory_auth_sessions')) return [{}];
  if (sql.includes('INNER JOIN inventory_auth_sessions'))
    return [
      [
        {
          id: 7,
          username: 'test',
          role,
          password: 'test-hash',
          credential_hash: createInventorySecurity.fingerprint('test-hash'),
        },
      ],
    ];
  if (sql.includes('FROM inventario_escaneos') && sql.includes('IN (?)')) return [[]];
  throw Error('Unexpected query: ' + sql.slice(0, 80));
};
const { createInventorySecurity } = await import('../../shared/inventory-security.mjs');
const { security } = await import('../src/config/security.js');
const { createApp } = await import('../src/app.js');
const server = createServer(createApp());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/s3/inventory`;
const { token } = await security.issue({ id: 7, password: 'test-hash' });
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('maintenance and imports require authentication, and pocket cannot administer users', async () => {
  for (const path of ['/api/v1/user', '/response/store', '/response/store/import']) {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { Origin: 'https://qa.example', 'Content-Type': 'application/json' },
      body: '[]',
    });
    assert.equal(res.status, 401, path);
  }
  role = 'pocket';
  const res = await fetch(base + '/api/v1/user', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 403);
  role = 'administrador';
});
test('cross-origin cookie actions are blocked and API responses have security headers', async () => {
  const response = await fetch(base + '/api/v1/user', {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      Cookie: 'inventory_session=' + token,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('x-powered-by'), null);
});
test('actual stock controller returns 120 rows across three 50-row pages without losing total', async () => {
  const all = Array.from({ length: 120 }, (_, i) => ({
    id: i + 1,
    cCodigoBarra: String(i + 1),
    cStock: 10,
  }));
  const seen = [];
  pool.execute = async (sql) => {
    if (sql.includes('SELECT id, inventario_registrado'))
      return [[{ id: 1, inventario_registrado: 1 }]];
    if (sql.includes('COUNT(*) AS total_rows')) return [[{ total_rows: 120, total_stock: 1200 }]];
    if (sql.includes('SUM(es.cantidad)')) return [[{ total_conteo: 0 }]];
    if (sql.includes('st.id, st.cSessionCode')) {
      const [, size, offset] = sql.match(/LIMIT (\d+) OFFSET (\d+)/);
      return [all.slice(Number(offset), Number(offset) + Number(size))];
    }
    if (sql.trim().startsWith('UPDATE')) return [{ affectedRows: 120 }];
    return [[]]; // Per-SKU and section totals are empty in this fixture.
  };
  for (const [page, count] of [
    [1, 50],
    [2, 50],
    [3, 20],
  ]) {
    const response = await fetch(
      base + `/request/store?session_code=ABC123&serie_store=100&page=${page}&pageSize=50`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.inventario.length, count);
    assert.equal(data.pagination.totalRows, 120);
    assert.equal(data.pagination.totalPages, 3);
    seen.push(...data.inventario.map((row) => row.id));
  }
  assert.deepEqual(
    seen,
    all.map((row) => row.id),
  );
});
