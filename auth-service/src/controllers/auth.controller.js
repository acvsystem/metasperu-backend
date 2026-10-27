import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
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

export const loginCenter = async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await poolCenter.query(
      `SELECT ID_LOGIN,PASSWORD_NW,USUARIO,DEFAULT_PAGE,TB_LOGIN.NIVEL,NOMBRE_MENU,RUTA,TB_LOGIN.EMAIL,OLD_CODE_STORE,CODE_STORE,TB_LISTA_TIENDA.UNID_SERVICIO
                FROM bd_metasperu.TB_PERMISO_SISTEMA
                INNER JOIN bd_metasperu.TB_MENU_SISTEMA ON bd_metasperu.TB_MENU_SISTEMA.ID_MENU = TB_PERMISO_SISTEMA.ID_MENU_PS
                INNER JOIN bd_metasperu.TB_LOGIN ON bd_metasperu.TB_LOGIN.NIVEL = TB_PERMISO_SISTEMA.NIVEL
                LEFT JOIN bd_metasperu.TB_LISTA_TIENDA ON  bd_metasperu.TB_LISTA_TIENDA.SERIE_TIENDA = TB_LOGIN.CODE_STORE WHERE usuario = ?`,
      [username],
    );
    if (rows.length === 0) return res.status(401).json({ message: 'Credenciales inválidas' });

    const user = rows[0];

    const validPassword = await bcrypt.compare(password, user.PASSWORD_NW);
    if (!validPassword) return res.status(401).json({ message: 'Credenciales inválidas' });

    const token = jwt.sign({ id: user.ID_LOGIN, rol: user.NIVEL }, process.env.CENTER_JWT_SECRET, {
      expiresIn: '8h',
      algorithm: 'HS256',
    });

    res.cookie('center_session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 8 * 60 * 60 * 1000,
    });

    res.json({
      token: token,
      user: {
        username: user.USUARIO,
        role: user.NIVEL,
        dafault_page: user.DEAFULT_PAGE,
        email: user.EMAIL,
        old_code_store: user.OLD_CODE_STORE,
        code_store: user.CODE_STORE,
        unid_servicio: user.UNID_SERVICIO,
      },
      menu: rows.map((r) => ({ nombre: r.NOMBRE_MENU, ruta: r.RUTA })),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error en el servidor' });
  }
};

export const checkSessionCenter = async (req, res) => {
  try {
    // req.user viene inyectado desde el middleware
    const [rows] = await poolCenter.query(
      'SELECT ID_LOGIN, USUARIO, EMAIL, NIVEL FROM tb_login WHERE ID_LOGIN = ?',
      [req.user.id],
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Usuario no existe' });

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error verificando sesión' });
  }
};

export const logoutCenter = (req, res) => {
  res.clearCookie('center_session', cookieOptions);
  res.json({ message: 'Sesión cerrada correctamente' });
};
