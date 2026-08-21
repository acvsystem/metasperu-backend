import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';
import { configurationController } from '../controllers/configuration.controller.js';
import { serverController } from '../controllers/server.controller.js';
import { maintenanceController } from '../controllers/maintenance.controller.js';
import { rrwebController } from '../controllers/rrweb.controller.js'
import { reportsController } from '../controllers/report.controller.js';
import { pool } from '../config/db.js';
const router = Router();

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
    const role = req.user?.rol || req.user?.role || req.user?.nivel;
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
                id, created_at, service_name, method, original_url, route_path,
                status_code, success, duration_ms, user_id, user_name, user_role,
                ip, user_agent, error_message
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
        res.status(500).json({ message: 'Error al consultar logs de API', error: error.message });
    }
}

async function getApiLog(req, res) {
    if (!canViewApiLogs(req, res)) return;

    try {
        const [rows] = await pool.execute(
            `SELECT * FROM ${LOG_TABLE} WHERE id = ? LIMIT 1`,
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
        res.status(500).json({ message: 'Error al consultar detalle de log', error: error.message });
    }
}

router.get('/api/logs', verifyToken, listApiLogs);
router.get('/api/logs/:id', verifyToken, getApiLog);

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

// --- RUTAS INFORMES
router.get('/api/reports/informe-rendimiento', verifyToken, reportsController.infRendimiento);

export default router;
