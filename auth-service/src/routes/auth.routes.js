// src/routes/auth.routes.js
import { Router } from 'express';
import { login, logout, checkSession } from '../controllers/auth.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = Router();

// Ruta pública
router.post('/login', login);

// Rutas protegidas (Requieren cookie válida)
router.get('/check-session', verifyToken, checkSession);
router.post('/logout', verifyToken, logout);

export default router;