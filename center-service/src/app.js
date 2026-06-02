

import express from 'express';
import { createServer } from 'http';
import cookieParser from 'cookie-parser';
import { initSocket } from './config/socket.js'; // 1. Importar primero
import { storeController } from './controllers/store.controller.js';
import cors from 'cors';

const app = express();
const httpServer = createServer(app);

initSocket(httpServer);

app.use(cors({
  origin: (origin, callback) => callback(null, true), // Permite cualquier origen
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

import centerRoutes from './routes/center.routes.js';
app.use('/s1/center', centerRoutes);

/*cron.schedule('00 8 * * 0', async () => {
  console.log('⏰ [Cron Job] Iniciando limpieza de clientes...');
  storeController.callClientDelete();
  try {



  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});*/

const PORT = 3002;
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});



