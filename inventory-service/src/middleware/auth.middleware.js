import jwt from 'jsonwebtoken';
import { security } from '../config/security.js';
import { readSessionToken, requireRoles } from '../../../shared/inventory-security.mjs';
export { requireRoles };
export const verifyToken = async (req, res, next) => {
  try {
    req.user = await security.authenticate(readSessionToken(req));
    next();
  } catch (error) {
    res
      .status(error.status || 503)
      .json({ message: error.status ? error.message : 'No se pudo verificar la sesión.' });
  }
};
export function verifyImporter(token) {
  const secret = process.env.INVENTORY_IMPORT_SECRET;
  if (!secret || secret.length < 64) throw Error('Importador no configurado.');
  const claims = jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: 'inventory-importer',
    audience: 'inventory-import',
  });
  if (
    claims.kind !== 'store-import' ||
    typeof claims.store !== 'string' ||
    !claims.store ||
    !claims.exp
  )
    throw Error('Importador inválido.');
  return { store: claims.store, expiresAt: claims.exp };
}
export const verifyImportOrAdmin = async (req, res, next) => {
  const token = readSessionToken(req);
  try {
    req.importScope = verifyImporter(token);
    return next();
  } catch {
    /* Interactive import needs an administrator session. */
  }
  return verifyToken(req, res, () => requireRoles('administrador')(req, res, next));
};
