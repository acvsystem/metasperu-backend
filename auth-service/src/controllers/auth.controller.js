import bcrypt from 'bcrypt';
import { getCenterSecurity } from '../config/center-security.js';
import { createCenterAuthController } from '../../../shared/center-auth-controller.mjs';
import { pool } from '../config/db.js';
import { poolCenter } from '../config/db-center.js';
import { security } from '../config/security.js';
import {
  inventoryCookie,
  cookieOptions,
  readSessionToken,
} from '../../../shared/inventory-security.mjs';

export const login = async (req, res) => {
  const { username, password } = req.body || {};
  if (
    typeof username !== 'string' ||
    !username.trim() ||
    username.length > 100 ||
    typeof password !== 'string' ||
    !password ||
    Buffer.byteLength(password) > 72
  ) {
    return res.status(400).json({ message: 'Ingrese un usuario y contraseña válidos.' });
  }
  try {
    const [[user]] = await pool.query(
      'SELECT id, username, perfilname, role, password, estado FROM usuarios WHERE username = ?',
      [username.trim()],
    );
    if (
      !user ||
      Number(user.estado) !== 1 ||
      !['administrador', 'auditor', 'pocket'].includes(user.role) ||
      !(await bcrypt.compare(password, user.password))
    ) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }
    const { token, maxAge } = await security.issue(user);
    res.cookie(inventoryCookie, token, { ...cookieOptions, maxAge });
    res.set('Cache-Control', 'no-store');
    res.json({
      user: { id: user.id, username: user.username, perfilname: user.perfilname, role: user.role },
    });
  } catch {
    res.status(503).json({ message: 'No se pudo iniciar sesión. Intente nuevamente.' });
  }
};
export const checkSession = (req, res) => {
  const { id, username, perfilname, role } = req.user;
  res.set('Cache-Control', 'no-store');
  res.json({ id, username, perfilname, role });
};
export const logout = async (req, res) => {
  try {
    await security.revoke(readSessionToken(req));
    res.clearCookie(inventoryCookie, cookieOptions);
    res.json({ message: 'Sesión cerrada correctamente' });
  } catch {
    res.status(503).json({ message: 'No se pudo cerrar la sesión en el servidor. Reintente.' });
  }
};

const centerAuth=createCenterAuthController({pool:poolCenter,getSecurity:getCenterSecurity,compare:bcrypt.compare});
export const loginCenter=centerAuth.login;
export const checkSessionCenter=centerAuth.check;
export const logoutCenter=centerAuth.logout;
