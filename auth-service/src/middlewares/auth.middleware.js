import jwt from 'jsonwebtoken';
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
export const verifyCenterToken = (req, res, next) => {
  try {
    const secret = process.env.CENTER_JWT_SECRET;
    if (!secret || secret.length < 32) throw Error();
    req.user = jwt.verify(req.headers.authorization?.replace(/^Bearer /, ''), secret, {
      algorithms: ['HS256'],
    });
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido o expirado' });
  }
};
