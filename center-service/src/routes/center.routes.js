import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';
import { configurationController } from '../controllers/configuration.controller.js';
import { serverController } from '../controllers/server.controller.js';
const router = Router();

// ---RUTAS DASHBOARD
router.get('/api/dashboard/store/refresh', verifyToken, storeController.getDashboarRefresh);

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
router.get('/api/documentos-pendientes/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log(token);
        // Buscamos el token y verificamos que la fecha actual sea menor a la de expiración
        const [rows] = await pool.execute(
            "SELECT documentos FROM enlaces_temporales WHERE token = ? AND expiracion > NOW()",
            [token]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: "Enlace expirado o no encontrado." });
        }

        res.json(JSON.parse(rows[0].documentos));
    } catch (error) {
        res.status(500).json({ error: "Error interno." });
    }
});

export default router;