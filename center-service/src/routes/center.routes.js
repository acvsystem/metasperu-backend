import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';
import { configurationController } from '../controllers/configuration.controller.js';

const router = Router();

// --- RUTAS PARA TIENDAS

router.get('/api/store', verifyToken, storeController.getTiendas);
router.post('/api/store', verifyToken, storeController.createTienda);
router.put('/api/store', verifyToken, storeController.updateTienda);
router.delete('/api/store/:id', verifyToken, storeController.deleteTienda);

// --- RUTAS PARA VERIFICACION
router.get('/api/documents/missing/:socketId', verifyToken, storeController.callDocumentsComparation);
router.get('/api/transactions/frontretail/:socketId', verifyToken, storeController.callTransactions);
router.get('/api/client/blank/:socketId', verifyToken, storeController.callClientBlank);

// ---RUTAS DE CONFIGURACION
router.post('/api/parameters/store', verifyToken, configurationController.postParametersStore);

export default router;