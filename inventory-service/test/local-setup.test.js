import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import dotenv from 'dotenv';
import { configureLocalInventory } from '../../shared/setup-inventory-local.mjs';

async function removeFixture(root) {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('inventory-env-test-'));
  await rm(root, { recursive: true, force: true });
}

test('local setup shares a strong stable key and preserves existing DB credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inventory-env-test-'));
  try {
    for (const service of ['auth-service', 'inventory-service']) {
      await mkdir(join(root, service));
      await writeFile(join(root, service, '.env'), 'NODE_ENV=development\nPORT=3306\nDB_HOST=db.example.test\nDB_USER=test\nDB_PASSWORD="test # fixture"\nDB_NAME=fixture\nJWT_SECRET=legacy-test-only\n');
    }
    await configureLocalInventory(dotenv.parse, root);
    const auth = dotenv.parse(await readFile(join(root, 'auth-service/.env')));
    const inventory = dotenv.parse(await readFile(join(root, 'inventory-service/.env')));
    assert.equal(auth.PORT, '3000'); assert.equal(inventory.PORT, '3001');
    assert.equal(auth.DB_PASSWORD, 'test # fixture'); assert.equal(inventory.DB_HOST, 'db.example.test');
    assert.equal(inventory.DB_PORT, '3306'); assert.equal(inventory.HOST, '127.0.0.1');
    assert.match(auth.INVENTORY_JWT_SECRET, /^[a-f0-9]{64}$/);
    assert.equal(auth.INVENTORY_JWT_SECRET, inventory.INVENTORY_JWT_SECRET);
    assert.notEqual(inventory.INVENTORY_IMPORT_SECRET, inventory.INVENTORY_JWT_SECRET);
    assert.ok(inventory.CORS_ORIGINS.split(',').includes('http://localhost:4200'));
    await configureLocalInventory(dotenv.parse, root);
    assert.equal(dotenv.parse(await readFile(join(root, 'auth-service/.env'))).INVENTORY_JWT_SECRET, auth.INVENTORY_JWT_SECRET);
  } finally { await removeFixture(root); }
});

test('setup refuses production files or conflicting valid keys without changing either file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inventory-env-test-'));
  try {
    for (const service of ['auth-service', 'inventory-service']) await mkdir(join(root, service));
    for (const [left, right] of [['NODE_ENV=production\n', 'NODE_ENV=development\n'], ['INVENTORY_JWT_SECRET=' + 'a'.repeat(64), 'INVENTORY_JWT_SECRET=' + 'b'.repeat(64)]]) {
      await writeFile(join(root, 'auth-service/.env'), left);
      await writeFile(join(root, 'inventory-service/.env'), right);
      await assert.rejects(() => configureLocalInventory(dotenv.parse, root));
      assert.equal(await readFile(join(root, 'auth-service/.env'), 'utf8'), left);
      assert.equal(await readFile(join(root, 'inventory-service/.env'), 'utf8'), right);
    }
  } finally { await removeFixture(root); }
});

test('setup preserves an existing quoted shared secret containing a comment marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inventory-env-test-'));
  const secret = 'a'.repeat(40) + ' # ' + 'b'.repeat(40);
  try {
    for (const service of ['auth-service', 'inventory-service']) {
      await mkdir(join(root, service));
      await writeFile(join(root, service, '.env'), 'NODE_ENV=development\nINVENTORY_JWT_SECRET=' + JSON.stringify(secret) + '\n');
    }
    await configureLocalInventory(dotenv.parse, root);
    for (const service of ['auth-service', 'inventory-service']) {
      assert.equal(dotenv.parse(await readFile(join(root, service, '.env'))).INVENTORY_JWT_SECRET, secret);
    }
  } finally { await removeFixture(root); }
});
