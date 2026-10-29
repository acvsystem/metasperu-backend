import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, editCount, importStock } from '../src/services/inventory-operations.js';
import { normalizeScans } from '../src/services/pocket-sync.js';
import { randomUUID } from 'node:crypto';

test('new scan uploads still require positive integer quantities', () => {
  for (const quantity of [0, -1, 0.5, 1000000000]) {
    assert.throws(() => normalizeScans([{ client_scan_id: randomUUID(), sku: 'A', quantity, seccion_id: 1, scanned_at: new Date().toISOString() }]), { status: 400 });
  }
});

function database(handler) {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
    query: async (sql, params) => {
      events.push(sql);
      return handler(sql, params);
    },
  };
  return { getConnection: async () => connection, events };
}
test('creating session rolls back header when assigning sections fails', async () => {
  const db = database((sql) => {
    if (sql.startsWith('SELECT')) return [[{ id: 1 }]];
    if (sql.includes('secciones_asginados')) throw Error('test failure');
    return [{ insertId: 42 }];
  });
  await assert.rejects(() =>
    createSession(
      db,
      { tienda_id: 1, assigned_section: [{ seccion_id: 1, nombre_seccion: 'A' }] },
      7,
    ),
  );
  assert.ok(db.events.includes('rollback'));
  assert.ok(!db.events.includes('commit'));
  assert.equal(db.events.at(-1), 'release');
});
test('count editing rejects fractional, out-of-range, blank and nonnumeric values before opening database', async () => {
  for (const cantidad of [-1.5, 1.5, 'no', -1000000000, 1000000000, null, '', '  ', undefined, false]) {
    await assert.rejects(() => editCount({}, { id: 1, cantidad }, { id: 7, role: 'pocket' }), {
      status: 400,
    });
  }
});

test('signed count edits persist their exact quantity and audit in the same transaction', async () => {
  for (const cantidad of [-1, '-2', -3, 0, 2, 3, -999999999, 999999999]) {
    const writes = [];
    const db = database((sql, params) => {
      if (sql.startsWith('SELECT'))
        return [[{ id: 1, sesion_id: 2, escaneado_por: 7, cantidad: 8, estado: 'ACTIVO' }]];
      writes.push({ sql, params });
      return [{}];
    });
    await editCount(db, { id: 1, cantidad }, { id: 7, role: 'pocket' });
    assert.deepEqual(writes[0].params, [Number(cantidad), 1]);
    assert.ok(writes[1].sql.includes('INSERT INTO inventory_scan_audit'));
    assert.deepEqual(writes[1].params, [1, 2, 7, 8, Number(cantidad)]);
    assert.ok(db.events.includes('commit'));
    assert.ok(!db.events.includes('rollback'));
  }
});
test('pocket cannot change another operator count and closed sessions cannot be edited', async () => {
  for (const [owner, state, status] of [
    [9, 'ACTIVO', 403],
    [7, 'FINALIZADO', 409],
  ]) {
    const db = database(() => [
      [{ id: 1, sesion_id: 2, escaneado_por: owner, cantidad: 3, estado: state }],
    ]);
    await assert.rejects(() => editCount(db, { id: 1, cantidad: -1 }, { id: 7, role: 'pocket' }), {
      status,
    });
    assert.ok(!db.events.some((s) => s.startsWith('UPDATE')));
  }
});
test('authorized count changes and old/new audit commit together', async () => {
  const db = database((sql) =>
    sql.startsWith('SELECT')
      ? [[{ id: 1, sesion_id: 2, escaneado_por: 7, cantidad: 3, estado: 'ACTIVO' }]]
      : [{}],
  );
  await editCount(db, { id: 1, cantidad: 5 }, { id: 7, role: 'pocket' });
  assert.ok(db.events.some((s) => s.includes('INSERT INTO inventory_scan_audit')));
  assert.ok(db.events.includes('commit'));
});
test('stock imports reject mixed sessions, mixed stores, and invalid quantities before database access', async () => {
  const row = { cSessionCode: 'ABC123', cCodigoTienda: '100', cStock: 10, cCodigoArticulo: 'A' };
  for (const rows of [
    [row, { ...row, cSessionCode: 'OTHER' }],
    [row, { ...row, cCodigoTienda: '200' }],
    [{ ...row, cStock: 'oops' }],
  ]) {
    await assert.rejects(() => importStock({}, rows, {}), { status: 400 });
  }
});
test('importer token is scoped to one store', async () => {
  await assert.rejects(
    () =>
      importStock({}, [{ cSessionCode: 'ABC123', cCodigoTienda: '100', cStock: 2 }], {
        store: '200',
      }),
    { status: 403 },
  );
});
test('all stock batches roll back on failure', async () => {
  let batches = 0;
  const db = database((sql) => {
    if (sql.includes('FROM inventario_sesiones'))
      return [[{ id: 1, estado: 'ACTIVO', inventario_registrado: 0, serie: '100' }]];
    if (sql.includes('FROM inventory_stock_imports')) return [[]];
    if (sql.includes('INSERT INTO inventario_store') && ++batches === 2)
      throw Error('batch failure');
    return [{ affectedRows: 1000 }];
  });
  await assert.rejects(() =>
    importStock(
      db,
      Array.from({ length: 1001 }, (_, i) => ({
        cSessionCode: 'ABC123',
        cCodigoTienda: '100',
        cStock: 1,
        cCodigoArticulo: String(i),
      })),
      {},
    ),
  );
  assert.ok(db.events.includes('rollback'));
  assert.ok(!db.events.includes('commit'));
});
