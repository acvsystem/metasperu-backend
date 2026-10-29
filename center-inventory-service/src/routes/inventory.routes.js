import { createCenterRouter } from '../../../shared/center-router.mjs';
import {validateStockLookup} from '../../../shared/center-stock-input.mjs';
import { validateTransferStores } from '../../../shared/center-transfers.mjs';
import { pool } from '../config/db.js';
import { protectSpreadsheetUpload } from '../../../shared/center-uploads.mjs';
import { boundary } from '../config/security.js';
import { authorizeServiceAction,bindReplySocket } from '../../../shared/center-service-policy.mjs';
import { getIO } from '../config/socket.js';
import { Router } from 'express';
import { verifyToken } from '../middleware/auth.middleware.js';
import { storeController } from '../controllers/store.controller.js';
import multer from 'multer';

const router = createCenterRouter(Router);
router.post('/api/inventory/store',boundary.requireAgent,(req,res,next)=>{
 const rows=req.body?.stockData;
 if(req.agent.kind!=='store'||!Array.isArray(rows)||!rows.length||rows.length>5000||rows.some(row=>String(row.cCodigoTienda)!==req.agent.store)) return res.status(422).json({message:'Lote de inventario no autorizado.'});
 req.body.marca=req.agent.brand;next();
},storeController.postReqInventory);

router.use(verifyToken,bindReplySocket(getIO));

const uploadTraspasos = multer({ dest: 'uploads/traspasos',limits:{fileSize:5*1024*1024,files:1},fileFilter:(_req,file,cb)=>cb(null,/\.(xlsx|csv|txt)$/i.test(file.originalname)) });

// --- RUTAS PARA INVENTARIO TIENDAS

router.post('/api/inventory/send/email', authorizeServiceAction('inventory'), storeController.postSendInventoryStoreEmail);
router.post('/api/inventory/application/inventary/email', authorizeServiceAction('inventory'), storeController.callSendInventoryStoreEmail);
router.get('/api/inventory/store/:marca/:socketId', authorizeServiceAction('inventory'),bindReplySocket(getIO), storeController.callInventoryStore);
router.get('/api/inventory/consolidated/:marca/:serieStore', authorizeServiceAction('inventory'), storeController.getConsolidatedInventory);
router.post('/api/inventory/one/search', authorizeServiceAction('inventory'),validateStockLookup, storeController.callInventoryOneStore);
router.post('/api/inventory/search/barcode', authorizeServiceAction('inventory'),validateStockLookup, storeController.callInventorySearchCodebar);

// --- RUTAS PARA TRASPASOS
router.post('/api/inventory/traspasos', uploadTraspasos.single('file'), protectSpreadsheetUpload('uploads/traspasos'), authorizeServiceAction('inventory'), validateTransferStores(pool,{file:true}), storeController.callTraspasosFTP);
router.get('/api/inventory/traspasos', authorizeServiceAction('inventory'), storeController.getTraspasos);
router.post('/api/inventory/traspasos/insert', authorizeServiceAction('inventory'), validateTransferStores(pool), storeController.postTraspasoBD);
export default router;
