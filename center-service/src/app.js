

import express from 'express';
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

cron.schedule('28 14 * * 0', async () => {
  console.log('⏰ [Cron Job] Iniciando limpieza de clientes...');
  storeController.callClientDelete();
  try {

    console.log('Iniciando tarea programada: callClientDelete...');

    // Como el cron no viene de un HTTP request, le pasamos un ID por defecto 
    // o un string que identifique que lo hizo el sistema.
    const systemSocketId = 'SYSTEM_CRON';

    executeClientDeleteLogic(systemSocketId);

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});


const executeClientDeleteLogic = async (socketIdFallback) => {
  try {
    let [data] = await pool.query(`SELECT * FROM TB_CLIENTES_CLEAR_FORNT;`);
    let extra_client = ((data || [])[0]['LIST_CLIENTE']).split(',');

    if ((extra_client || []).length) {
      // Asegúrate de que getIO() esté disponible en este archivo
      getIO().to('grupo_tiendas').emit('py_delete_client', {
        pedido_por: socketIdFallback,
        extra_client: extra_client
      });
      console.log(`[CRON] Señal emitida exitosamente a las 10:00 AM`);
    }
  } catch (error) {
    console.error('[CRON ERROR] Error en ejecución programada:', error);
  }
};

const PORT = 3002;
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});



