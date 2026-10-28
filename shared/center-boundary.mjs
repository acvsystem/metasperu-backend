import { createHash } from 'node:crypto';
import { createCenterSecurity, readCenterToken } from './center-security.mjs';

export function createCenterBoundary({ jwt, pool, secret }) {
  const security = createCenterSecurity({ jwt, pool, secret });
  async function agent(token) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 512) throw Object.assign(new Error(), { status: 401 });
    const [[row]] = await pool.execute('SELECT a.agent_id,a.kind,a.store_serie,t.UNID_SERVICIO AS brand FROM tb_center_agents a LEFT JOIN tb_lista_tienda t ON t.SERIE_TIENDA=a.store_serie WHERE a.token_hash=? AND a.active=1', [createHash('sha256').update(token).digest('hex')]);
    if (!row) throw Object.assign(new Error(), { status: 401 });
    return { id: row.agent_id, kind: row.kind, store: row.store_serie, brand: row.brand };
  }
  async function authenticate(req, res, next) {
    try {
      req.user = await security.authenticate(readCenterToken(req));
      next();
    } catch (error) {
      res.status(error.status || 503).json({ message: error.status ? 'Sesion invalida o expirada.' : 'Servicio temporalmente no disponible.' });
    }
  }
  function requireAgent(req, res, next) {
    agent(req.headers['x-center-agent']).then(identity => { req.agent = identity; next(); },
      error => res.status(error.status || 503).json({ message: 'No se pudo autenticar el dispositivo.' }));
  }
  // An explicitly selected store is checked independently of the client's role/menu.
  function storeScope(getStore) {
    return (req, res, next) => {
      const serie = getStore(req);
      if (serie && security.canAccessStore(req.user, serie)) return next();
      return res.status(403).json({ message: 'No tiene acceso a esta tienda.' });
    };
  }
  return { security, agent, authenticate, requireAgent, storeScope };
}
