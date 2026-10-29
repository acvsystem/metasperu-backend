import { createCenterRouter } from '../../../shared/center-router.mjs';
import path from 'node:path';
import { createExportController } from '../../../shared/center-export-controller.mjs';
import { bindReplySocket } from '../../../shared/center-service-policy.mjs';
import { getIO } from '../config/socket.js';
import { boundary } from '../config/security.js';
import { authorizeCenterAction } from '../../../shared/center-policy.mjs';
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';
import { configurationController } from '../controllers/configuration.controller.js';
import { serverController } from '../controllers/server.controller.js';
import { maintenanceController } from '../controllers/maintenance.controller.js';
import { rrwebController } from '../controllers/rrweb.controller.js'
import { reportsController } from '../controllers/report.controller.js';
import { pool } from '../config/db.js';
const router = createCenterRouter(Router);
// Device ingestion has a separate identity and never uses a browser session.
router.post('/api/parameters/store', boundary.requireAgent, configurationController.postParametersStore);
router.post('/api/sunat-notification', boundary.requireAgent, (req,res,next) => {
  if (req.agent.kind !== 'backup') return res.status(403).json({message:'Dispositivo no autorizado.'});
  next();
}, storeController.callNotificationSunat);
// High-entropy, expiring capability links remain read-only.
router.get('/api/documentos-pendientes/:token', storeController.callUrlTemporalComprabantes);
router.use(verifyToken, authorizeCenterAction, bindReplySocket(getIO));



const exportsController=createExportController({pool,root:process.env.CENTER_EXPORT_DIR||path.resolve('.private/exports'),enabled:process.env.EXPORTS_ENABLED==='true'});
router.post('/api/exports',exportsController.create);
router.get('/api/exports/:id',exportsController.get);
router.post('/api/exports/:id/cancel',exportsController.cancel);
router.get('/api/exports/:id/download',exportsController.download);

const LOG_TABLE = 'bd_metasperu.tb_api_logs';
const ALLOWED_LOG_SERVICES = new Set([
    'auth-service',
    'center-service',
    'inventory-service',
    'center-inventory-service',
    'center-resources-human-service',
    'center-accounting-service'
]);

function parseLogInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function parseLogJsonField(value) {
    if (!value) return null;

    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
}

function canViewApiLogs(req, res) {
    const role = req.user?.role || req.user?.rol || req.user?.nivel;
    if (role !== 'SISTEMAS') {
        res.status(403).json({ message: 'No tiene permisos para ver auditoria de APIs' });
        return false;
    }

    return true;
}

async function listApiLogs(req, res) {
    if (!canViewApiLogs(req, res)) return;

    const page = parseLogInteger(req.query.page, 1, 1, 100000);
    const limit = parseLogInteger(req.query.limit, 50, 10, 200);
    const offset = (page - 1) * limit;
    const where = [];
    const params = [];

    if (req.query.service && ALLOWED_LOG_SERVICES.has(req.query.service)) {
        where.push('service_name = ?');
        params.push(req.query.service);
    }

    if (req.query.method) {
        where.push('method = ?');
        params.push(String(req.query.method).toUpperCase());
    }

    if (req.query.status) {
        const status = Number.parseInt(req.query.status, 10);
        if (!Number.isNaN(status)) {
            where.push('status_code = ?');
            params.push(status);
        }
    }

    if (req.query.success === '1' || req.query.success === '0') {
        where.push('success = ?');
        params.push(Number(req.query.success));
    }

    if (req.query.usuario) {
        where.push('(user_id LIKE ? OR user_name LIKE ? OR user_role LIKE ?)');
        const usuario = `%${req.query.usuario}%`;
        params.push(usuario, usuario, usuario);
    }

    if (req.query.q) {
        where.push('(original_url LIKE ? OR error_message LIKE ?)');
        const q = `%${req.query.q}%`;
        params.push(q, q);
    }

    if (req.query.desde) {
        where.push('created_at >= ?');
        params.push(req.query.desde);
    }

    if (req.query.hasta) {
        where.push('created_at <= ?');
        params.push(req.query.hasta);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
        const [totalRows] = await pool.execute(
            `SELECT COUNT(*) total FROM ${LOG_TABLE} ${whereSql}`,
            params
        );

        const [rows] = await pool.query(
            `SELECT
                id, created_at, service_name, method, SUBSTRING_INDEX(original_url,'?',1) AS original_url, route_path,
                status_code, success, duration_ms, user_id, user_name, user_role,
                ip, user_agent, NULL AS error_message
            FROM ${LOG_TABLE}
            ${whereSql}
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        res.json({
            page,
            limit,
            total: totalRows[0]?.total || 0,
            rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error al consultar logs de API', requestId: req.requestId });
    }
}

async function getApiLog(req, res) {
    if (!canViewApiLogs(req, res)) return;

    try {
        const [rows] = await pool.execute(
            `SELECT id,created_at,service_name,method,SUBSTRING_INDEX(original_url,'?',1) AS original_url,route_path,
              status_code,success,duration_ms,user_id,user_name,user_role,ip,user_agent FROM ${LOG_TABLE} WHERE id = ? LIMIT 1`,
            [req.params.id]
        );

        if (!rows.length) {
            return res.status(404).json({ message: 'Log no encontrado' });
        }

        const log = rows[0];
        log.user_payload = parseLogJsonField(log.user_payload);
        log.request_headers = parseLogJsonField(log.request_headers);
        log.request_query = parseLogJsonField(log.request_query);
        log.request_body = parseLogJsonField(log.request_body);
        log.response_error = parseLogJsonField(log.response_error);

        res.json(log);
    } catch (error) {
        res.status(500).json({ message: 'Error al consultar detalle de log', requestId: req.requestId });
    }
}

router.get('/api/logs', listApiLogs);
router.get('/api/logs/:id', getApiLog);

// ---RUTAS DASHBOARD
router.get('/api/dashboard/store/refresh', storeController.getDashboarRefresh);

// --- RUTAS RRWEB
router.post('/api/rrweb/session/start', rrwebController.startSession);
router.post('/api/rrweb/events', rrwebController.saveEvents);
router.post('/api/rrweb/session/end', rrwebController.endSession);
router.get('/api/rrweb/sessions', rrwebController.listSessions);
router.get('/api/rrweb/session/:sessionId/events', rrwebController.getSessionEvents);

// --- RUTAS PARA TIENDAS

router.get('/api/store', storeController.getTiendas);
router.post('/api/store', storeController.createTienda);
router.put('/api/store', storeController.updateTienda);
router.delete('/api/store/:id', storeController.deleteTienda);

// --- RUTAS PARA VERIFICACION
router.get('/api/documents/missing/:socketId', storeController.callDocumentsComparation);
router.get('/api/transactions/frontretail/:socketId', storeController.callTransactions);
router.post('/api/transactions/transfer/terminal', storeController.callTransferTerminal);
router.get('/api/server/comparation/documents/:socketId', serverController.callComparationDocumentsServer);
router.get('/api/server/documents/pending/:socketId', serverController.callDocumentsPendingServer);
router.get('/api/traffic/verification/:socketId', storeController.callTrafficVerification);

// ---RUTAS CLIENTE
router.get('/api/client/blank/:socketId', storeController.callClientBlank);
router.post('/api/delete/client/:socketId', storeController.callClientDelete);

// ---PANAMA 
router.post('/api/delete/cola/panama/:socketId', storeController.callDeletePanamaCola);

// ---RUTAS DE CONFIGURACION


// ---RUTA TEMPORAL DOCUMENTOS PENDIENTES SLACK


// ---RUTA CONFIGURACION PERMISO ASIGNACION TIENDA
router.post('/api/configuration/permissions/store', configurationController.permissionsStore);
router.get('/api/configuration/permissions/store', configurationController.gerPermissions);

// ---RUTA CONFIGURACION MENU PERMISO
router.get('/api/configuration/permissions/menu/:nivel', configurationController.gerPermissionsMenu);
router.get('/api/configuration/menu', configurationController.getMenu);

// ---RUTA CONFIGURACION USUARIOS
router.get('/api/configuration/usuarios', configurationController.getUsuarios);
router.post('/api/configuration/usuario/create', configurationController.getUsuariosCreate);
router.post('/api/configuration/usuario/update', configurationController.getUsuarioUpdate);
router.post('/api/configuration/usuario/delete', configurationController.delUsuariosDelete);
router.post('/api/configuration/usuarios/permissions/store', configurationController.gerPermissionsUserStore);
router.post('/api/configuration/usuarios/asing/permissions/store', configurationController.postAsigPermissionsUserStore);
router.post('/api/configuration/usuarios/asing/menu', configurationController.getAsingMenuUser);

// ---RUTA PARAMETROS TIENDA
router.post('/api/parameters/store/create', configurationController.crearParametrosTienda);
router.get('/api/parameters/store/:id?', configurationController.obtenerParametrosStore);
router.put('/api/parameters/store/actualizar/:id', configurationController.actualizarParametrosTienda);
router.delete('/api/parameters/store/eliminar/:id', configurationController.eliminarParametrosTienda);

// ---RUTA CLIENTES EN BLANCO
router.get('/api/parameters/clientes/blanco', configurationController.obtenerClientesBlanco);
router.post('/api/parameters/clientes/blanco/update', configurationController.actualizarClientesClear);

// ---RUTA CONFIGURACION PARAMETROS GENERALES
router.get('/api/parameters/tiempo/tolerancia', configurationController.getTolerancias);
router.post('/api/parameters/tiempo/tolerancia/create', configurationController.createTolerancia);
router.put('/api/parameters/tiempo/tolerancia/update/:id', configurationController.updateTolerancia);
router.delete('/api/parameters/tiempo/tolerancia/delete/:id', configurationController.deleteTolerancia);

// --- RUTAS MANTENIMIENTO PAPELETAS Y HORAS EXTRA
router.get('/api/maintenance/:resource', maintenanceController.list);
router.get('/api/maintenance/:resource/:id', maintenanceController.getById);
router.post('/api/maintenance/:resource', maintenanceController.create);
router.put('/api/maintenance/:resource/:id', maintenanceController.update);
router.delete('/api/maintenance/:resource/:id', maintenanceController.remove);

// --- RUTAS INFORMES
router.get('/api/reports/informe-rendimiento', reportsController.infRendimiento);

// ---- RUTAS NOTIFICACIONES



export default router;
