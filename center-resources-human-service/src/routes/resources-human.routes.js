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
router.post('/api/ballot/employes/store', storeController.postBallotEmployesStore);
router.post('/api/create/ballot/employes', storeController.postCreateBallotEmployes);
router.get('/api/type/ballot', storeController.getTypeBallot);
router.get('/api/all/ballot/employes/store/:codestore', storeController.getAllBallotEmployesStore);

// --- RUTAS PARA HORARIOS TIENDAS
router.get('/api/schedule/store', storeController.getScheduleStore);
router.post('/api/search/schedule/store', storeController.getSearchScheduleStore);
router.post('/api/register/schedule/store', storeController.getRegisterScheduleStore);
router.post('/api/update/schedule/store', storeController.postUpdateScheduleStore);
router.post('/api/one/search/schedule/store', storeController.getOneSearchScheduleStore);

// --- RUTA CONSULTA HORAS
router.post('/api/hours/works/employes', storeController.postHorusWorksEmployes);
router.post('/api/hours/works/employes/response', storeController.postHorusWorksEmployesResponse);

// --- SOLICITUDES EN BALLOT
router.post('/api/solicitude/approval/hours/works/employes', storeController.postSolicitudHoursWorksEmployes);
router.post('/api/approval/hours/works/employes', storeController.postApprovalHoursWorksEmployes);
router.get('/api/solicitude/hours/works/employes', storeController.getApprovalHoursWorksEmployes);
router.get('/api/all/solicitude/hours/works/employes', storeController.getAllApprovalHoursWorksEmployes);

export default router;