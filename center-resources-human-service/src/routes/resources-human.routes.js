import { createCenterRouter } from '../../../shared/center-router.mjs';
import { boundary } from '../config/security.js';
import { authorizeServiceAction,bindReplySocket,bindAgentReplySocket } from '../../../shared/center-service-policy.mjs';
import { getIO } from '../config/socket.js';
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';

const router = createCenterRouter(Router);
router.post('/api/asistence/employes/store/response',boundary.requireAgent,(req,res,next)=>{ if(req.agent.kind!=='backup') return res.status(403).json({message:'Dispositivo no autorizado.'});next(); },bindAgentReplySocket(getIO),storeController.postAsistenciaEmployesStore);
router.post('/api/asistence/ejb/register/employes/response',boundary.requireAgent,(req,res,next)=>{ if(req.agent.kind!=='backup') return res.status(403).json({message:'Dispositivo no autorizado.'});next(); },bindAgentReplySocket(getIO),storeController.postEjbRegisterEmployes);
router.post('/api/hours/works/employes/response',boundary.requireAgent,(req,res,next)=>{ if(req.agent.kind!=='backup') return res.status(403).json({message:'Dispositivo no autorizado.'});next(); },bindAgentReplySocket(getIO),storeController.postHorusWorksEmployesResponse);
router.use(verifyToken,bindReplySocket(getIO));


// --- RUTAS ASISTENCIA EMPLEADOS ---
router.post('/api/access/checkinout', authorizeServiceAction('human'), storeController.postAccessCheckinout);
router.post('/api/asistence/employes/store', authorizeServiceAction('human'), storeController.callAsistenceEmployesStore);

router.post('/api/asistence/employes/store/refresh', authorizeServiceAction('human'), storeController.postRefresAsistenciaEmpleados);

// --- RUTAS REGISTRO EMPLEADOS EJB ---
router.get('/api/asistence/ejb/register/employes/:socketId', authorizeServiceAction('human'),bindReplySocket(getIO), storeController.callRegisterEmployesStore);


// --- PAPELETAS EMPLEADOS ---
router.post('/api/ballot/employes/store', authorizeServiceAction('human'), storeController.postBallotEmployesStore);
router.post('/api/create/ballot/employes', authorizeServiceAction('human'), storeController.postCreateBallotEmployes);
router.get('/api/type/ballot', authorizeServiceAction('human'), storeController.getTypeBallot);
router.post('/api/all/ballot/employes/store', authorizeServiceAction('human'), storeController.getAllBallotEmployesStore);

// --- RUTAS PARA HORARIOS TIENDAS
router.get('/api/schedule/store', authorizeServiceAction('human'), storeController.getScheduleStore);
router.post('/api/search/schedule/store', authorizeServiceAction('human'), storeController.getSearchScheduleStore);
router.post('/api/register/schedule/store', authorizeServiceAction('human'), storeController.getRegisterScheduleStore);
router.post('/api/update/schedule/store', authorizeServiceAction('human'), storeController.postUpdateScheduleStore);
router.post('/api/one/search/schedule/store', authorizeServiceAction('human'), storeController.getOneSearchScheduleStore);
router.put('/api/update/date/schedule/store', authorizeServiceAction('human'), storeController.putUpdateDateScheduleStore);

// --- RUTA CONSULTA HORAS
router.post('/api/hours/works/employes', authorizeServiceAction('human'), storeController.postHorusWorksEmployes);

// --- SOLICITUDES EN BALLOT
router.post('/api/solicitude/approval/hours/works/employes', authorizeServiceAction('human'), storeController.postSolicitudHoursWorksEmployes);
router.post('/api/approval/hours/works/employes', authorizeServiceAction('human'), storeController.postApprovalHoursWorksEmployes);
router.get('/api/solicitude/hours/works/employes', authorizeServiceAction('human'), storeController.getApprovalHoursWorksEmployes);
router.get('/api/all/solicitude/hours/works/employes', authorizeServiceAction('human'), storeController.getAllApprovalHoursWorksEmployes);

export default router;
