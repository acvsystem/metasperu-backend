import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';
import multer from 'multer';

const router = Router();
const uploadTraspasos = multer({ dest: 'uploads/traspasos' });

// --- RUTAS PARA INVENTARIO TIENDAS
router.post('/api/inventory/store', storeController.postReqInventory);
router.post('/api/inventory/send/email', storeController.postSendInventoryStoreEmail);
router.post('/api/inventory/application/inventary/email', storeController.callSendInventoryStoreEmail);
router.get('/api/inventory/store/:marca', storeController.callInventoryStore);
router.get('/api/inventory/consolidated/:marca/:serieStore', storeController.getConsolidatedInventory);
router.post('/api/inventory/one/search', storeController.callInventoryOneStore);

// --- RUTAS PARA TRASPASOS
router.post('/api/inventory/traspasos', uploadTraspasos.single('file'), storeController.callTraspasosFTP);
router.get('/api/inventory/traspasos', storeController.getTraspasos);
router.post('/api/inventory/traspasos/insert', storeController.postTraspasoBD);
export default router;