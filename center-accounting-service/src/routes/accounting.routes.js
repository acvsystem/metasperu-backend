import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS PARA KARDEX TIENDAS
router.post('/api/kardex/store', storeController.getKardexStore);
router.post('/api/kardex/camposlibres', storeController.postKardexCamposLibres);

// --- RUTAS PARA CUO TIENDAS
router.post('/api/cuo/store', storeController.getCuoStore);
router.post('/api/cuo/insert', storeController.postCuoInsert);

export default router;