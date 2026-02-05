// src/routes/auth.routes.js
import { Router } from 'express';
import { login, loginCenter, logout, checkSession, checkSessionCenter, logoutCenter } from '../controllers/auth.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = Router();

// Ruta pública inventory-service
router.post('/login', login);
router.get('/check-session', verifyToken, checkSession);
router.post('/logout', verifyToken, logout);

// Ruta publica center-service
router.post('/center/login', loginCenter);
router.get('/center/check-session', checkSessionCenter);
router.post('/center/logout', verifyToken, logoutCenter);

export default router;