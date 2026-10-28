import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createCenterSecurity, readCenterToken } from '../../shared/center-security.mjs';

const secret = 'test-only-'.repeat(9);
const account = { ID_LOGIN: 7, USUARIO: 'QA', NIVEL: 'TIENDA', CODE_STORE: 'A', EMAIL: '' };
function setup({ user = account, revoked = false } = {}) {
  const writes = [];
  const pool = { execute: async (sql, values) => {
    if (sql.includes('FROM tb_login')) return [[user].filter(Boolean)];
    if (sql.includes('FROM tb_center_sessions')) return [revoked ? [] : [{ user_id: 7 }]];
    if (sql.includes('tb_usuario_tiendas_asignadas')) return [[{ serie: 'B' }]];
    writes.push({ sql, values }); return [{ affectedRows: 1 }];
  } };
  return { security: createCenterSecurity({ jwt, pool, secret }), writes };
}
test('session uses current database role and assigned stores instead of token claims', async () => {
  const { security } = setup();
  const { token } = await security.issue(account);
  const principal = await security.authenticate(token);
  assert.equal(principal.role, 'TIENDA');
  assert.deepEqual(principal.stores, ['A', 'B']);
  assert.equal(security.canAccessStore(principal, 'C'), false);
});
test('revoked sessions and deleted users are rejected', async () => {
  const issued = await setup().security.issue(account);
  for (const options of [{ revoked: true }, { user: null }]) {
    await assert.rejects(setup(options).security.authenticate(issued.token), { status: 401 });
  }
});
test('old untracked tokens and tokens for a different service are rejected', async () => {
  const { security } = setup();
  for (const token of [jwt.sign({ id: 7, rol: 'SISTEMAS' }, secret), jwt.sign({ id: 7 }, 'other'.repeat(20))]) {
    await assert.rejects(security.authenticate(token), { status: 401 });
  }
});
test('logout revokes the session identifier', async () => {
  const { security, writes } = setup();
  const { token } = await security.issue(account);
  await security.revoke(await security.authenticate(token));
  assert.ok(writes.some(write => /SET revoked_at/.test(write.sql)));
});
test('tokens can be read from the httpOnly cookie or explicit bearer header', () => {
  assert.equal(readCenterToken({ headers: {}, cookies: { center_session: 'cookie' } }), 'cookie');
  assert.equal(readCenterToken({ headers: { authorization: 'Bearer explicit' }, cookies: { center_session: 'cookie' } }), 'explicit');
});
