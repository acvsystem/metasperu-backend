import { randomUUID } from 'node:crypto';

export const centerCookie = 'center_session';
export const centerCookieOptions = { httpOnly: true, secure: true, sameSite: 'none', path: '/' };
const denied = () => Object.assign(new Error('Sesion invalida o expirada.'), { status: 401 });
export function readCenterToken(req) {
  return req.headers?.authorization?.match(/^Bearer ([^\s]+)$/)?.[1] || req.cookies?.[centerCookie];
}

// Dependencies are injected so authorization can be tested without a live database.
export function createCenterSecurity({ jwt, pool, secret }) {
  if (typeof secret !== 'string' || secret.length < 64) throw new Error('CENTER_JWT_SECRET requiere al menos 64 caracteres.');
  const options = { algorithms: ['HS256'], issuer: 'metasperu-center', audience: 'center-services' };
  async function issue(user) {
    const jti = randomUUID();
    const token = jwt.sign({ id: user.ID_LOGIN, rol: user.NIVEL }, secret,
      { algorithm: 'HS256', issuer: options.issuer, audience: options.audience, jwtid: jti, expiresIn: '8h' });
    await pool.execute('INSERT INTO tb_center_sessions (session_id,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))', [jti, user.ID_LOGIN]);
    return { token, maxAge: 8 * 3600 * 1000 };
  }
  async function authenticate(token) {
    let claims;
    try { claims = jwt.verify(token, secret, options); } catch { throw denied(); }
    if (!Number.isSafeInteger(Number(claims.id)) || !claims.jti) throw denied();
    const [[session]] = await pool.execute('SELECT user_id FROM tb_center_sessions WHERE session_id=? AND user_id=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP()', [claims.jti, claims.id]);
    if (!session) throw denied();
    const [[user]] = await pool.execute('SELECT ID_LOGIN,USUARIO,EMAIL,NIVEL,CODE_STORE,OLD_CODE_STORE FROM tb_login WHERE ID_LOGIN=?', [claims.id]);
    if (!user) throw denied();
    const [assigned] = await pool.execute(`SELECT t.SERIE_TIENDA AS serie,t.OLD_SERIE_TIENDA AS old_serie FROM tb_usuario_tiendas_asignadas a
      JOIN tb_lista_tienda t ON t.ID_TIENDA=a.ID_TIENDA_TASG WHERE a.ID_USUARIO_TASG=?`, [user.ID_LOGIN]);
    return { id: user.ID_LOGIN, username: user.USUARIO, role: user.NIVEL, rol: user.NIVEL,
      email: user.EMAIL, code_store: user.CODE_STORE, old_code_store:user.OLD_CODE_STORE, sessionId: claims.jti, expiresAt: claims.exp * 1000,
      allStores: user.NIVEL === 'SISTEMAS', stores: [...new Set([user.CODE_STORE,user.OLD_CODE_STORE, ...assigned.flatMap(row => [row.serie,row.old_serie])].filter(Boolean))] };
  }
  return { issue, authenticate,
    revoke: user => pool.execute('UPDATE tb_center_sessions SET revoked_at=UTC_TIMESTAMP() WHERE session_id=? AND user_id=?', [user.sessionId, user.id]),
    canAccessStore: (user, serie) => Boolean(user?.allStores || user?.stores?.includes(String(serie))),
  };
}

export function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next() : res.status(403).json({ message: 'No tiene permiso para realizar esta accion.' });
}
