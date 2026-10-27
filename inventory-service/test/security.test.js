import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createInventorySecurity, requireRoles } from '../../shared/inventory-security.mjs';

const secret = 'test-only-inventory-secret-'.repeat(3);
function setup() {
  let active = true,
    revoked = false,
    role = 'pocket';
  const pool = {
    query: async (sql) => {
      if (sql.startsWith('INSERT')) return [{ affectedRows: 1 }];
      if (sql.startsWith('UPDATE')) {
        revoked = true;
        return [{ affectedRows: 1 }];
      }
      return [
        [
          ...(active && !revoked
            ? [
                {
                  id: 7,
                  username: 'test',
                  role,
                  password: 'hash',
                  credential_hash: createInventorySecurity.fingerprint('hash'),
                },
              ]
            : []),
        ],
      ];
    },
  };
  return {
    security: createInventorySecurity({ jwt, pool, secret }),
    disable: () => {
      active = false;
    },
    revoke: () => {
      revoked = true;
    },
    promote: () => {
      role = 'auditor';
    },
  };
}
test('rejects missing, expired, and center-service tokens', async () => {
  const { security } = setup();
  for (const token of [
    undefined,
    jwt.sign({ id: 7 }, secret),
    jwt.sign({ sub: '7', jti: 'x' }, secret, {
      issuer: 'inventory-auth',
      audience: 'inventory-api',
      expiresIn: -1,
    }),
  ]) {
    await assert.rejects(() => security.authenticate(token), { status: 401 });
  }
});
test('session reflects current role and rejects inactive users and revoked sessions', async () => {
  const x = setup();
  const { token } = await x.security.issue({ id: 7, password: 'hash' });
  assert.equal((await x.security.authenticate(token)).role, 'pocket');
  x.promote();
  assert.equal((await x.security.authenticate(token)).role, 'auditor');
  await x.security.revoke(token);
  await assert.rejects(() => x.security.authenticate(token), { status: 401 });
  const y = setup();
  const issued = await y.security.issue({ id: 7, password: 'hash' });
  y.disable();
  await assert.rejects(() => y.security.authenticate(issued.token), { status: 401 });
});
test('password changes invalidate existing sessions', async () => {
  const pool = {
    query: async (sql) =>
      sql.startsWith('INSERT')
        ? [{}]
        : [[{ id: 7, role: 'administrador', password: 'changed', credential_hash: 'old' }]],
  };
  const security = createInventorySecurity({ jwt, pool, secret });
  const { token } = await security.issue({ id: 7, password: 'old' });
  await assert.rejects(() => security.authenticate(token), { status: 401 });
});
test('pocket and auditor cannot invoke administrator-only maintenance', () => {
  for (const role of ['pocket', 'auditor', undefined]) {
    let called = false,
      status;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json() {},
    };
    requireRoles('administrador')({ user: { role } }, res, () => {
      called = true;
    });
    assert.equal(status, 403);
    assert.equal(called, false);
  }
});
test('session secrets must be configured and sufficiently long', () => {
  for (const bad of ['', 'short'])
    assert.throws(() => createInventorySecurity({ jwt, pool: {}, secret: bad }));
});
