import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS PARA INVENTARIO TIENDAS
router.post('/api/inventory/store', storeController.postReqInventory);
router.post('/api/inventory/send/email', storeController.postSendInventoryStoreEmail);
router.post('/api/inventory/application/inventary/email', storeController.callSendInventoryStoreEmail);
router.get('/api/inventory/store/:marca', storeController.callInventoryStore);
router.get('/api/inventory/consolidated/:marca/:serieStore', storeController.getConsolidatedInventory);
//router.post('/api/inventory/one/search', storeController.callInventoryOneStore);
export default router;