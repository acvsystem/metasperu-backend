import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = Router();

// --- RUTAS ASISTENCIA EMPLEADOS ---
router.post('/api/asistence/employes/store', storeController.callAsistenceEmployesStore);
router.post('/api/asistence/employes/store/response', storeController.postAsistenciaEmployesStore);
router.post('/api/asistence/employes/store/refresh', storeController.postRefresAsistenciaEmpleados);

// --- RUTAS REGISTRO EMPLEADOS EJB ---
router.get('/api/asistence/ejb/register/employes', storeController.callRegisterEmployesStore);
router.post('/api/asistence/ejb/register/employes/response', storeController.postEjbRegisterEmployes);

// --- PAPELETAS EMPLEADOS ---
router.get('/api/ballot/employes/store', storeController.postBallotEmployesStore);

export default router;