import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import { createInventorySecurity } from '../../shared/inventory-security.mjs';
import { createSession, editCount, importStock } from '../src/services/inventory-operations.js';

const container = 'inventory-security-qa-20261026';
const label = execFileSync(
  'docker',
  ['inspect', '--format', '{{index .Config.Labels "codex.task"}}', container],
  { encoding: 'utf8' },
).trim();
assert.equal(label, 'inventory-security-qa', 'Refuse to test any other container');
const env = await readFile(process.argv[2], 'utf8');
const password = env.match(/^MYSQL_ROOT_PASSWORD=(.+)$/m)?.[1];
const port = Number(
  execFileSync('docker', ['port', container, '3306/tcp'], { encoding: 'utf8' })
    .trim()
    .split(':')
    .at(-1),
);
const options = {
  host: '127.0.0.1',
  port,
  user: 'root',
  password,
  database: 'inventory_qa',
  multipleStatements: true,
};
let ready;
for (let i = 0; i < 60; i++) {
  try {
    ready = await mysql.createConnection(options);
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
if (!ready) throw Error('Isolated MySQL not ready');
await ready.end();
const pool = mysql.createPool(options);
const servers = [],
  otherPools = [];
try {
  await pool.query(await readFile(new URL('./mysql-schema.sql', import.meta.url), 'utf8'));
  const migration = await readFile(new URL('../sql/security.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  await pool.query(migration); // Migration must be repeatable without dropping application data.
  await pool.query(
    "INSERT INTO tiendas VALUES (1,'100','ACTIVO'); INSERT INTO secciones_escaneos VALUES (1,'A1')",
  );
  const hash = await bcrypt.hash('Integration-test-password', 4);
  await pool.query(
    "INSERT INTO usuarios (id,username,password,perfilname,role,estado) VALUES (1,'admin',?,'QA','administrador',1),(2,'pocket',?,'QA','pocket',1)",
    [hash, hash],
  );
  const body = { tienda_id: 1, assigned_section: [{ seccion_id: 1, nombre_seccion: 'A1' }] };
  await pool.query(
    "CREATE TRIGGER reject_section BEFORE INSERT ON secciones_asginados FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA rollback'",
  );
  await assert.rejects(() => createSession(pool, body, 1));
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM inventario_sesiones'))[0][0].n, 0);
  await pool.query('DROP TRIGGER reject_section');
  const session = await createSession(pool, body, 1);
  assert.match(session.session_code, /^[A-Z0-9]{6}$/);
  await pool.query(
    "CREATE TRIGGER reject_stock BEFORE INSERT ON inventario_store FOR EACH ROW BEGIN IF NEW.cCodigoArticulo = 'FAIL' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA rollback'; END IF; END",
  );
  const row = {
    cSessionCode: session.session_code,
    cCodigoTienda: '100',
    cStock: 10,
    cCodigoBarra: 'SKU1',
    cCodigoArticulo: 'A',
  };
  const batch = Array.from({ length: 1001 }, (_, i) => ({
    ...row,
    cCodigoArticulo: i === 1000 ? 'FAIL' : String(i),
  }));
  await assert.rejects(() => importStock(pool, batch, {}));
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM inventario_store'))[0][0].n, 0);
  assert.equal(
    (await pool.query('SELECT inventario_registrado FROM inventario_sesiones'))[0][0]
      .inventario_registrado,
    0,
  );
  await pool.query('DROP TRIGGER reject_stock');
  const rows = Array.from({ length: 120 }, (_, i) => ({
    ...row,
    cCodigoArticulo: String(i),
    cCodigoBarra: 'SKU' + i,
  }));
  const uploads = await Promise.all([importStock(pool, rows, {}), importStock(pool, rows, {})]);
  assert.deepEqual(
    uploads.map((r) => r.insertedRows).sort((a, b) => a - b),
    [0, 120],
  );
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM inventario_store'))[0][0].n, 120);
  const [scan] = await pool.query(
    'INSERT INTO inventario_escaneos (sesion_id,sku,cantidad,escaneado_por,seccion_id) VALUES (?, ?, 3, 2, 1)',
    [session.id, 'SKU0'],
  );
  await pool.query("CREATE TRIGGER reject_audit BEFORE INSERT ON inventory_scan_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'QA rollback'");
  await assert.rejects(() => editCount(pool, { id: scan.insertId, cantidad: 5 }, { id: 2, role: 'pocket' }));
  assert.equal((await pool.query('SELECT cantidad FROM inventario_escaneos WHERE id = ?', [scan.insertId]))[0][0].cantidad, 3);
  await pool.query('DROP TRIGGER reject_audit');
  await editCount(pool, { id: scan.insertId, cantidad: 5 }, { id: 2, role: 'pocket' });
  assert.equal(
    (await pool.query('SELECT old_quantity,new_quantity FROM inventory_scan_audit'))[0][0]
      .new_quantity,
    5,
  );
  const secret = 'isolated-test-secret-'.repeat(8);
  const security = createInventorySecurity({ jwt, pool, secret });
  const issued = await security.issue({ id: 1, password: hash });
  assert.equal((await security.authenticate(issued.token)).role, 'administrador');
  await security.revoke(issued.token);
  await assert.rejects(() => security.authenticate(issued.token), { status: 401 });
  console.log(
    'PASS MySQL 8.4: repeatable migration, session rollback, stock batch rollback, concurrent import deduplication, scan audit, revocation.',
  );

  // Exercise real HTTP controllers against only this isolated database.
  Object.assign(process.env, {
    DB_HOST: '127.0.0.1',
    DB_PORT: String(port),
    DB_USER: 'root',
    DB_PASSWORD: password,
    DB_NAME: 'inventory_qa',
    INVENTORY_JWT_SECRET: secret,
    CORS_ORIGINS: 'https://qa.example',
    NODE_ENV: 'test',
  });
  const { pool: inventoryPool } = await import('../src/config/db.js');
  otherPools.push(inventoryPool);
  const { createApp } = await import('../src/app.js');
  const http = createServer(createApp());
  servers.push(http);
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { token } = await security.issue({ id: 1, password: hash });
  const ids = [];
  for (const page of [1, 2, 3]) {
    const url = `http://127.0.0.1:${http.address().port}/s3/inventory/request/store?session_code=${session.session_code}&serie_store=100&page=${page}&pageSize=50`;
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.pagination.totalRows, 120);
    ids.push(...data.inventario.map((r) => r.id));
  }
  assert.equal(ids.length, 120);
  assert.equal(new Set(ids).size, 120);
  console.log('PASS real HTTP + MySQL: 120 distinct products across 50/50/20 pages.');
  const { pool: authPool } = await import('../../auth-service/src/config/db.js'); otherPools.push(authPool);
  const { poolCenter } = await import('../../auth-service/src/config/db-center.js'); otherPools.push(poolCenter);
  const { createApp: createAuthApp } = await import('../../auth-service/src/app.js');
  const authHttp = createServer(createAuthApp()); servers.push(authHttp);
  await new Promise(resolve => authHttp.listen(0, '127.0.0.1', resolve));
  const authBase = `http://127.0.0.1:${authHttp.address().port}/s2/auth`;
  const headers = { Origin: 'https://qa.example', 'Content-Type': 'application/json' };
  const login = await fetch(authBase + '/login', { method: 'POST', headers, body: JSON.stringify({ username: 'admin', password: 'Integration-test-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const inventoryUrl = `http://127.0.0.1:${http.address().port}/s3/inventory/request/store?session_code=${session.session_code}&serie_store=100&page=2&pageSize=50`;
  assert.equal((await fetch(inventoryUrl, { headers: { ...headers, Cookie: cookie } })).status, 200);
  await pool.query("UPDATE usuarios SET role='pocket' WHERE id=1");
  assert.equal((await fetch(inventoryUrl, { headers: { ...headers, Cookie: cookie } })).status, 403);
  await pool.query("UPDATE usuarios SET role='administrador' WHERE id=1");
  assert.equal((await fetch(authBase + '/logout', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: '{}' })).status, 200);
  assert.equal((await fetch(inventoryUrl, { headers: { ...headers, Cookie: cookie } })).status, 401);
  console.log('PASS real auth + inventory + MySQL: login across services, current role enforced, logout revocation effective.');
} finally {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  for (const other of otherPools) await other.end();
  await pool.end();
}
