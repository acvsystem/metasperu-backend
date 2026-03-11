import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS PARA INVENTARIO TIENDAS
router.post('/api/inventory/store', storeController.postReqInventory);
router.get('/api/inventory/store', storeController.callInventoryStore);
router.get('/api/inventory/consolidated', storeController.getConsolidatedInventory);
export default router;