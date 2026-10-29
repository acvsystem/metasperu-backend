import { emailService } from './services/email.service.js';
import { startCenterRuntime } from '../../shared/center-runtime.mjs';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { installCenterHttp, centerErrorHandler } from '../../shared/center-http.mjs';
import { origins } from './config/security.js';


import express from 'express';
import { createServer } from 'http';
import { initSocket, getIO } from './config/socket.js'; // 1. Importar primero
import cors from 'cors';
import { pool } from './config/db.js';
//import { createApiLogger } from '../../shared/api-log.middleware.js';

const app = express();
const httpServer = createServer(app);

initSocket(httpServer);

installCenterHttp(app,{helmet,cookieParser,rateLimit,cors,express,origins});



//app.use(createApiLogger({ pool, serviceName: 'center-inventory-service' }));

import inventoryRoutes from './routes/inventory.routes.js';
app.use('/s4/center/inventory', inventoryRoutes);

app.use(centerErrorHandler);

export { app,httpServer };
await startCenterRuntime({moduleUrl:import.meta.url,app,server:httpServer,io:getIO(),pools:[pool],mail:emailService,port:3003,service:'center-inventory-service'});
