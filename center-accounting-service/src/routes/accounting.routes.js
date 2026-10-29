import { createCenterRouter } from '../../../shared/center-router.mjs';
import { boundary } from '../config/security.js';
import { authorizeServiceAction,bindReplySocket } from '../../../shared/center-service-policy.mjs';
import { getIO } from '../config/socket.js';
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = createCenterRouter(Router);
router.use(verifyToken,bindReplySocket(getIO));


// --- RUTAS PARA KARDEX TIENDAS
router.post('/api/kardex/store', authorizeServiceAction('accounting'), storeController.getKardexStore);
router.post('/api/kardex/camposlibres', authorizeServiceAction('accounting'), storeController.postKardexCamposLibres);

// --- RUTAS PARA CUO TIENDAS
router.post('/api/cuo/store', authorizeServiceAction('accounting'), storeController.getCuoStore);
router.post('/api/cuo/insert', authorizeServiceAction('accounting'), storeController.postCuoInsert);

// --- RUTAS PARA TIPO DE CAMBIO TIENDAS
router.post('/api/exchange-rate/store', authorizeServiceAction('accounting'), storeController.getExchangeRateStore);
router.post('/api/exchange-rate/sunat', authorizeServiceAction('accounting'), storeController.postExchangeRateSunat);

// --- RUTA TIENDAS ONLINE
router.get('/api/stores/online', authorizeServiceAction('accounting'), storeController.verificationStoreConection);

export default router;