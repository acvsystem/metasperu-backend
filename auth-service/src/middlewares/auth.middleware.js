import { getCenterSecurity } from '../config/center-security.js';
import { readCenterToken } from '../../../shared/center-security.mjs';
import { security } from '../config/security.js';
import { readSessionToken } from '../../../shared/inventory-security.mjs';
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
// Center uses a separate database and signing key; never accepted by inventory.
export const verifyCenterToken = async (req, res, next) => {
  try {
    req.user = await getCenterSecurity().authenticate(readCenterToken(req));
    next();
  } catch (error) {
    res.status(error.status || 503).json({ message: error.status ? error.message : 'No se pudo verificar la sesion.' });
  }
};
