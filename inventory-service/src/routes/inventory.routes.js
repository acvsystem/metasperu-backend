import { Router } from 'express';
import { 
    createSession, 
    registerScan, 
    syncBulkScans, 
    getSessionSummary,
    getStores 
} from '../controllers/inventory.controller.js';
import { verifyToken } from '../middleware/auth.middleware.js';

const router = Router();

// --- RUTAS PARA EL ADMINISTRADOR (WEB) ---
router.post('/create-session', verifyToken, createSession);
router.get('/summary/:session_code', verifyToken, getSessionSummary);

// --- RUTAS PARA EL POCKET (DISPOSITIVO) ---
// Usada cuando hay buena conexión
router.post('/scan', verifyToken, registerScan); 
// Usada para subir datos guardados en el Pocket tras estar offline
router.post('/sync-bulk', verifyToken, syncBulkScans); 
router.get('/stores', verifyToken, getStores);

export default router;