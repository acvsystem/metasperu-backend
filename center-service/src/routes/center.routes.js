import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS PARA TIENDAS
/*
router.get('/api/v1/store', verifyToken, storeController.getTiendas);
router.post('/api/v1/store', verifyToken, storeController.createTienda);
router.put('/api/v1/store', verifyToken, storeController.updateTienda);
router.delete('/api/v1/store/:id', verifyToken, storeController.deleteTienda);
*/
export default router;