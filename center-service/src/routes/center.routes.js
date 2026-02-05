import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS PARA TIENDAS

router.get('/api/store', verifyToken, storeController.getTiendas);
router.post('/api/store', verifyToken, storeController.createTienda);
router.put('/api/store', verifyToken, storeController.updateTienda);
router.delete('/api/store/:id', verifyToken, storeController.deleteTienda);

export default router;