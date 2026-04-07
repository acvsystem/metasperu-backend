import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS PARA KARDEX TIENDAS
router.post('/api/kardex/store', storeController.getKardexStore);

export default router;