import { Router } from 'express';
import {
    createSession,
    registerScan,
    syncBulkScans,
    getSessionSummary,
    getSessions,
    getStores,
    getInventoryReqStore,
    postInventoryResStore,
    getAssignedSection,
    getPocketScan,
    updateEndedSession,
    updateStartSession,
    updateConteoPocket,
    postInventoryImport,
    updateCheckedRow
} from '../controllers/inventory.controller.js';

import { userController } from '../controllers/user.controller.js';
import { getSections, postSections, putSecitons, delSecitons } from '../controllers/maintenance.controller.js';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS PARA EL ADMINISTRADOR (WEB) ---
router.post('/create-session', verifyToken, createSession);
router.get('/summary/:session_code', verifyToken, getSessionSummary);
router.get('/sessions', verifyToken, getSessions);

// --- RUTAS PARA EL POCKET (DISPOSITIVO) ---
// Usada cuando hay buena conexión
router.post('/scan', verifyToken, registerScan);

// Usada para subir datos guardados en el Pocket tras estar offline
router.post('/sync-bulk', verifyToken, syncBulkScans);
router.get('/stores', verifyToken, getStores);
router.get('/pocket/scan/:session_code', verifyToken, getPocketScan);

// --- RUTAS PARA INVENTARIO DE TIENDA (WEB) ---
router.get('/request/store', verifyToken, getInventoryReqStore);
router.post('/response/store', postInventoryResStore);
router.post('/response/store/import', postInventoryImport);
router.get('/section/assigned/:session_code', verifyToken, getAssignedSection);
router.put('/ended-session', verifyToken, updateEndedSession);
router.put('/estart-session', verifyToken, updateStartSession);
router.post('/checked/row/inv', verifyToken, updateCheckedRow);

// --- RUTAS PARA MANTENIMIENTO
router.get('/api/v1/seccion', verifyToken, getSections);
router.post('/api/v1/seccion', verifyToken, postSections);
router.put('/api/v1/seccion', verifyToken, putSecitons);
router.delete('/api/v1/seccion/:seccion_id', verifyToken, delSecitons);

// --- RUTAS PARA USUARIOS
router.get('/api/v1/user', verifyToken, userController.getUsers);
router.post('/api/v1/user', verifyToken, userController.createUser);
router.put('/api/v1/user', verifyToken, userController.updateUser);
router.delete('/api/v1/user/:id', verifyToken, userController.deleteUser);

// --- RUTAS PARA TIENDAS
router.get('/api/v1/store', verifyToken, storeController.getTiendas);
router.post('/api/v1/store', verifyToken, storeController.createTienda);
router.put('/api/v1/store', verifyToken, storeController.updateTienda);
router.delete('/api/v1/store/:id', verifyToken, storeController.deleteTienda);

// --- RUTAS POCKET 
router.put('/pocket/scan', verifyToken, updateConteoPocket)

export default router;