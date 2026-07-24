import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';
import { configurationController } from '../controllers/configuration.controller.js';
import { serverController } from '../controllers/server.controller.js';
import { maintenanceController } from '../controllers/maintenance.controller.js';
import { rrwebController } from '../controllers/rrweb.controller.js';
const router = Router();

// ---RUTAS DASHBOARD
router.get('/api/dashboard/store/refresh', verifyToken, storeController.getDashboarRefresh);

// --- RUTAS RRWEB
router.post('/api/rrweb/session/start', verifyToken, rrwebController.startSession);
router.post('/api/rrweb/events', verifyToken, rrwebController.saveEvents);
router.post('/api/rrweb/session/end', verifyToken, rrwebController.endSession);
router.get('/api/rrweb/sessions', verifyToken, rrwebController.listSessions);
router.get('/api/rrweb/session/:sessionId/events', verifyToken, rrwebController.getSessionEvents);

// --- RUTAS PARA TIENDAS

router.get('/api/store', verifyToken, storeController.getTiendas);
router.post('/api/store', verifyToken, storeController.createTienda);
router.put('/api/store', verifyToken, storeController.updateTienda);
router.delete('/api/store/:id', verifyToken, storeController.deleteTienda);

// --- RUTAS PARA VERIFICACION
router.get('/api/documents/missing/:socketId', verifyToken, storeController.callDocumentsComparation);
router.get('/api/transactions/frontretail/:socketId', verifyToken, storeController.callTransactions);
router.post('/api/transactions/transfer/terminal', verifyToken, storeController.callTransferTerminal);
router.get('/api/server/comparation/documents/:socketId', verifyToken, serverController.callComparationDocumentsServer);
router.get('/api/server/documents/pending/:socketId', verifyToken, serverController.callDocumentsPendingServer);
router.get('/api/traffic/verification/:socketId', verifyToken, storeController.callTrafficVerification);

// ---RUTAS CLIENTE
router.get('/api/client/blank/:socketId', verifyToken, storeController.callClientBlank);
router.get('/api/delete/client/:socketId', verifyToken, storeController.callClientDelete);

// ---PANAMA 
router.get('/api/delete/cola/panama/:socketId', verifyToken, storeController.callDeletePanamaCola);

// ---RUTAS DE CONFIGURACION
router.post('/api/parameters/store', configurationController.postParametersStore);

// ---RUTA TEMPORAL DOCUMENTOS PENDIENTES SLACK
router.get('/api/documentos-pendientes/:token', storeController.callUrlTemporalComprabantes);

// ---RUTA CONFIGURACION PERMISO ASIGNACION TIENDA
router.post('/api/configuration/permissions/store', verifyToken, configurationController.permissionsStore);
router.get('/api/configuration/permissions/store', verifyToken, configurationController.gerPermissions);

// ---RUTA CONFIGURACION MENU PERMISO
router.get('/api/configuration/permissions/menu/:nivel', verifyToken, configurationController.gerPermissionsMenu);
router.get('/api/configuration/menu', verifyToken, configurationController.getMenu);

// ---RUTA CONFIGURACION USUARIOS
router.get('/api/configuration/usuarios', verifyToken, configurationController.getUsuarios);
router.post('/api/configuration/usuario/create', verifyToken, configurationController.getUsuariosCreate);
router.post('/api/configuration/usuario/update', verifyToken, configurationController.getUsuarioUpdate);
router.post('/api/configuration/usuario/delete', verifyToken, configurationController.delUsuariosDelete);
router.post('/api/configuration/usuarios/permissions/store', verifyToken, configurationController.gerPermissionsUserStore);
router.post('/api/configuration/usuarios/asing/permissions/store', verifyToken, configurationController.postAsigPermissionsUserStore);
router.post('/api/configuration/usuarios/asing/menu', verifyToken, configurationController.getAsingMenuUser);

// ---RUTA PARAMETROS TIENDA
router.post('/api/parameters/store/create', verifyToken, configurationController.crearParametrosTienda);
router.get('/api/parameters/store/:id?', verifyToken, configurationController.obtenerParametrosStore);
router.put('/api/parameters/store/actualizar/:id', verifyToken, configurationController.actualizarParametrosTienda);
router.delete('/api/parameters/store/eliminar/:id', verifyToken, configurationController.eliminarParametrosTienda);

// ---RUTA CLIENTES EN BLANCO
router.get('/api/parameters/clientes/blanco', verifyToken, configurationController.obtenerClientesBlanco);
router.post('/api/parameters/clientes/blanco/update', verifyToken, configurationController.actualizarClientesClear);

// ---RUTA CONFIGURACION PARAMETROS GENERALES
router.get('/api/parameters/tiempo/tolerancia', verifyToken, configurationController.getTolerancias);
router.post('/api/parameters/tiempo/tolerancia/create', verifyToken, configurationController.createTolerancia);
router.put('/api/parameters/tiempo/tolerancia/update/:id', verifyToken, configurationController.updateTolerancia);
router.delete('/api/parameters/tiempo/tolerancia/delete/:id', verifyToken, configurationController.deleteTolerancia);

// --- RUTAS MANTENIMIENTO PAPELETAS Y HORAS EXTRA
router.get('/api/maintenance/:resource', verifyToken, maintenanceController.list);
router.get('/api/maintenance/:resource/:id', verifyToken, maintenanceController.getById);
router.post('/api/maintenance/:resource', verifyToken, maintenanceController.create);
router.put('/api/maintenance/:resource/:id', verifyToken, maintenanceController.update);
router.delete('/api/maintenance/:resource/:id', verifyToken, maintenanceController.remove);

export default router;
