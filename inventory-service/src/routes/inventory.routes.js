import { Router } from 'express';
import { getPocketPerformance } from '../controllers/pocket.controller.js';
import {
  createSession,
  registerScan,
  syncBulkScans,
  getSessionSummary,
  getSessionSummaryv2,
  getSessionStatistics,
  exportSessionSummaryCsv,
  getSessions,
  getStores,
  getInventoryReqStore,
  getInventoryStoreStatistics,
  exportInventoryStoreCsv,
  getProductsWithoutDisplay,
  getUnscannedSections,
  postInventoryResStore,
  getAssignedSection,
  getPocketScan,
  updateEndedSession,
  updateStartSession,
  updateConteoPocket,
  postInventoryImport,
  updateCheckedRow,
} from '../controllers/inventory.controller.js';

import { userController } from '../controllers/user.controller.js';
import {
  getZonasSubzonas,
  delZonas,
  delZonaEscaneos,
  importConteoSession,
  importStoreSession,
  putZonasSubzonas,
  getZonasv2,
  putZonasv2,
  postZonasv2,
  getSections,
  postSections,
  postSectionsBulk,
  assignSectionsRangeToSession,
  putSecitons,
  delSecitons,
  postSectionsCountSession,
  postSectionsGroupSession,
} from '../controllers/maintenance.controller.js';
import { verifyToken, requireRoles, verifyImportOrAdmin } from '../middleware/auth.middleware.js';
import * as chatController from '../controllers/chat.controller.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS PARA EL ADMINISTRADOR (WEB) ---
router.get(
  '/chat/contacts',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  chatController.contacts,
);
router.get(
  '/chat/:id/messages',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  chatController.messages,
);
router.post(
  '/chat/:id/messages',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  chatController.send,
);
router.post(
  '/chat/:id/read',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  chatController.read,
);
router.post(
  '/create-session',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  createSession,
);
router.get(
  '/summary/:session_code',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getSessionSummary,
);
router.get(
  '/v2/summary/:session_code/statistics',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getSessionStatistics,
);
router.get(
  '/v2/summary/:session_code',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getSessionSummaryv2,
);
router.get(
  '/v2/summary/:session_code/export/csv',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  exportSessionSummaryCsv,
);
router.get('/sessions', verifyToken, requireRoles('administrador', 'auditor'), getSessions);

// --- RUTAS PARA EL POCKET (DISPOSITIVO) ---
// Usada cuando hay buena conexión
router.post('/scan', verifyToken, requireRoles('administrador', 'auditor', 'pocket'), registerScan);

// Usada para subir datos guardados en el Pocket tras estar offline
router.post(
  '/sync-bulk',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  syncBulkScans,
);
router.get('/stores', verifyToken, requireRoles('administrador', 'auditor', 'pocket'), getStores);
router.get(
  '/pocket/scan/:session_code',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  getPocketScan,
);
router.get(
  '/pocket/performance/:session_code',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getPocketPerformance,
);

// --- RUTAS PARA INVENTARIO DE TIENDA (WEB) ---
router.get(
  '/request/store',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getInventoryReqStore,
);
router.get(
  '/request/store/statistics',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getInventoryStoreStatistics,
);
router.get(
  '/request/store/export/csv',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  exportInventoryStoreCsv,
);
router.get(
  '/request/store/products-without-display',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getProductsWithoutDisplay,
);
router.get(
  '/revision/unscanned-sections/:session_code',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getUnscannedSections,
);
router.post('/response/store', verifyImportOrAdmin, postInventoryResStore);
router.post('/response/store/import', verifyImportOrAdmin, postInventoryImport);
router.get(
  '/section/assigned/:session_code',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  getAssignedSection,
);
router.put(
  '/ended-session',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  updateEndedSession,
);
router.put(
  '/estart-session',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  updateStartSession,
);
router.put(
  '/checked/row/inv',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  updateCheckedRow,
);
//router.put('/import/extra/store', verifyToken, requireRoles('administrador', 'auditor'), impExtraStore);

// --- RUTAS PARA MANTENIMIENTO
router.get('/api/v1/seccion', verifyToken, requireRoles('administrador', 'auditor'), getSections);
router.post('/api/v1/seccion', verifyToken, requireRoles('administrador'), postSections);
router.post('/api/v1/seccion/bulk', verifyToken, requireRoles('administrador'), postSectionsBulk);
router.post(
  '/api/v1/seccion/session/bulk',
  verifyToken,
  requireRoles('administrador'),
  assignSectionsRangeToSession,
);
router.put('/api/v1/seccion', verifyToken, requireRoles('administrador'), putSecitons);
router.delete(
  '/api/v1/seccion/:seccion_id',
  verifyToken,
  requireRoles('administrador'),
  delSecitons,
);
router.post(
  '/api/v1/seccion/count/session',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  postSectionsCountSession,
);
router.post(
  '/api/v1/seccion/group/session',
  verifyToken,
  requireRoles('administrador'),
  postSectionsGroupSession,
);
router.post(
  '/api/delete/zona/escaneo',
  verifyToken,
  requireRoles('administrador'),
  delZonaEscaneos,
);
router.post(
  '/api/import/store/sesion',
  verifyToken,
  requireRoles('administrador'),
  importStoreSession,
);
router.post(
  '/api/import/conteo/sesion',
  verifyToken,
  requireRoles('administrador'),
  importConteoSession,
);

router.get(
  '/api/v2/zonas/subzonas',
  verifyToken,
  requireRoles('administrador', 'auditor'),
  getZonasSubzonas,
);
router.put('/api/v2/zonas/subzonas', verifyToken, requireRoles('administrador'), putZonasSubzonas);

router.get('/api/v2/zonas', verifyToken, requireRoles('administrador', 'auditor'), getZonasv2);
router.post('/api/v2/zonas', verifyToken, requireRoles('administrador'), postZonasv2);
router.put('/api/v2/zonas', verifyToken, requireRoles('administrador'), putZonasv2);
router.delete('/api/v2/zona/:zona_id', verifyToken, requireRoles('administrador'), delZonas);

// --- RUTAS PARA USUARIOS
router.get('/api/v1/user', verifyToken, requireRoles('administrador'), userController.getUsers);
router.post('/api/v1/user', verifyToken, requireRoles('administrador'), userController.createUser);
router.put('/api/v1/user', verifyToken, requireRoles('administrador'), userController.updateUser);
router.delete(
  '/api/v1/user/:id',
  verifyToken,
  requireRoles('administrador'),
  userController.deleteUser,
);

// --- RUTAS PARA TIENDAS
router.get('/api/v1/store', verifyToken, requireRoles('administrador'), storeController.getTiendas);
router.post(
  '/api/v1/store',
  verifyToken,
  requireRoles('administrador'),
  storeController.createTienda,
);
router.put(
  '/api/v1/store',
  verifyToken,
  requireRoles('administrador'),
  storeController.updateTienda,
);
router.delete(
  '/api/v1/store/:id',
  verifyToken,
  requireRoles('administrador'),
  storeController.deleteTienda,
);

// --- RUTAS POCKET
router.put(
  '/pocket/scan',
  verifyToken,
  requireRoles('administrador', 'auditor', 'pocket'),
  updateConteoPocket,
);

export default router;
