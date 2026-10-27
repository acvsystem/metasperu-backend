import { createHash, randomUUID } from 'node:crypto';

export const fail = (status, message) => Object.assign(new Error(message), { status });
export const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
export const inventoryCookie = 'inventory_session';
export const cookieOptions = { httpOnly: true, secure: true, sameSite: 'none', path: '/' };

// Kept outside service bootstraps so authentication can be tested without opening a database.
export function createInventorySecurity({ jwt, pool, secret }) {
  if (typeof secret !== 'string' || secret.length < 64)
    throw new Error('INVENTORY_JWT_SECRET debe tener al menos 64 caracteres.');
  const options = { algorithms: ['HS256'], issuer: 'inventory-auth', audience: 'inventory-api' };
  function decode(token) {
    try {
      const claims = jwt.verify(token, secret, options);
      if (!claims.sub || !claims.jti || !Number.isSafeInteger(claims.exp)) throw new Error();
      return claims;
    } catch {
      throw fail(401, 'Sesión inválida o expirada. Ingrese nuevamente.');
    }
  }
  return {
    async issue(user) {
      const jti = randomUUID();
      const token = jwt.sign({}, secret, {
        algorithm: 'HS256',
        issuer: options.issuer,
        audience: options.audience,
        subject: String(user.id),
        jwtid: jti,
        expiresIn: '8h',
      });
      await pool.query(
        `INSERT INTO inventory_auth_sessions (id, user_id, credential_hash, expires_at)
                VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))`,
        [jti, user.id, fingerprint(user.password)],
      );
      return { token, maxAge: 8 * 60 * 60 * 1000 };
    },
    async authenticate(token) {
      const claims = decode(token);
      const [[user]] = await pool.query(
        `SELECT u.id, u.username, u.perfilname, u.role, u.password, s.credential_hash
                FROM usuarios u INNER JOIN inventory_auth_sessions s ON s.user_id = u.id
                WHERE s.id = ? AND u.id = ? AND u.estado = 1 AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP()`,
        [claims.jti, claims.sub],
      );
      if (
        !user ||
        fingerprint(user.password) !== user.credential_hash ||
        !['administrador', 'auditor', 'pocket'].includes(user.role)
      ) {
        throw fail(401, 'Sesión inválida o expirada. Ingrese nuevamente.');
      }
      return {
        id: user.id,
        username: user.username,
        perfilname: user.perfilname,
        role: user.role,
        sessionId: claims.jti,
      };
    },
    async revoke(token) {
      const claims = decode(token);
      await pool.query(
        'UPDATE inventory_auth_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ?',
        [claims.jti, claims.sub],
      );
      return claims.jti;
    },
  };
}
createInventorySecurity.fingerprint = fingerprint;

export function readSessionToken(req) {
  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return (
    req.cookies?.[inventoryCookie] ||
    (req.headers?.cookie || '')
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${inventoryCookie}=`))
      ?.slice(inventoryCookie.length + 1)
  );
}

export const requireRoles =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return res.status(403).json({ message: 'No tiene permisos para esta acción.' });
    next();
  };

export function createOriginPolicy(value = '') {
  const origins = new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (!origins.size) throw new Error('Configure CORS_ORIGINS con las URL exactas del frontend.');
  for (const origin of origins)
    if (new URL(origin).origin !== origin) throw new Error('Origen CORS inválido.');
  return {
    accepts: (origin) => !origin || origins.has(origin),
    cors: (origin, callback) => callback(null, !origin || origins.has(origin)),
    protect: (req, res, next) => {
      // CORS alone does not stop a cross-origin form POST carrying cookies.
      if (
        (req.headers.origin && !origins.has(req.headers.origin)) ||
        (!req.headers.origin && req.headers['sec-fetch-site'] === 'cross-site') ||
        (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
          !req.headers.origin &&
          !req.headers.authorization)
      ) {
        return res.status(403).json({ message: 'Origen no permitido.' });
      }
      next();
    },
  };
}
