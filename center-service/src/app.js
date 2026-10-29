import { purgeExpiredRecordings } from '../../shared/center-retention.mjs';
import { emailService } from './services/email.service.js';
import { startCenterRuntime } from '../../shared/center-runtime.mjs';
import { runScheduledOnce } from '../../shared/center-scheduler.mjs';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { installCenterHttp, centerErrorHandler } from '../../shared/center-http.mjs';
import { origins } from './config/security.js';



import express from 'express';
import { createServer } from 'http';
import cookieParser from 'cookie-parser';
import { getIO, initSocket, reiniciarAuditoriaDocumentos, iniciarRecoleccionInformeRendimiento } from './config/socket.js'; // 1. Importar primero
import { storeController } from './controllers/store.controller.js';
import cors from 'cors';
import cron from 'node-cron';
import { pool } from './config/db.js';
//import { createApiLogger } from '../../shared/api-log.middleware.js';

const app = express();
const httpServer = createServer(app);

initSocket(httpServer);

installCenterHttp(app, { helmet, rateLimit, cookieParser, cors, express, origins });
app.get('/health', (_req,res) => res.json({status:'ok',service:'center-service'}));

import centerRoutes from './routes/center.routes.js';
app.use('/s1/center', centerRoutes);

// Disabled by default. Enable only in the designated scheduler instance.
let scheduleSequence = 0;
const scheduleJob = (expression, task, options) => {
  const name = 'center-' + (++scheduleSequence) + ':' + expression;
  if (process.env.ENABLE_SCHEDULED_JOBS !== 'true') return;
  cron.schedule(expression, () => runScheduledOnce(pool, name, task).catch(() =>
    console.error(JSON.stringify({event:'scheduled.failed',job:name}))), options);
};
if(process.env.ENABLE_RECORDING_RETENTION==='true')scheduleJob('*/15 * * * *',()=>purgeExpiredRecordings(pool,{days:Number(process.env.RECORDING_RETENTION_DAYS||30)}),{timezone:'America/Lima'});
scheduleJob('00 10 * * *', async () => {
  console.log('⏰ [Cron Job] Iniciando limpieza de clientes...');

  try {

    console.log('Iniciando tarea programada: callClientDelete...');

    // Como el cron no viene de un HTTP request, le pasamos un ID por defecto 
    // o un string que identifique que lo hizo el sistema.
    const systemSocketId = 'SYSTEM_CRON';

    await executeClientDeleteLogic(systemSocketId);

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});

scheduleJob('00 10 * * *', async () => {
  console.log('⏰ [Cron Job] Iniciando envio de ventas Arequipa...');

  try {

    console.log('Iniciando tarea programada: SendVentasFTP...');

    await executeSendVentasFTP();

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});

scheduleJob('10 10 * * *', async () => {
  console.log('⏰ [Cron Job 1] Iniciando comprobacion documentos faltantes...');

  try {

    reiniciarAuditoriaDocumentos();
    getIO().to('servidor_backup').emit('py_request_documents_server');
    getIO().to('grupo_tiendas').emit('py_request_documents_store', { pedido_por: 'cronwe2e22er2e2' });

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});

scheduleJob('00 17 * * *', async () => {
  console.log('⏰ [Cron Job 2] Iniciando comprobacion documentos faltantes...');

  try {

    reiniciarAuditoriaDocumentos();
    getIO().to('servidor_backup').emit('py_request_documents_server');
    getIO().to('grupo_tiendas').emit('py_request_documents_store', { pedido_por: 'cronwe2e22er2e2' });

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});

scheduleJob('00 21 * * *', async () => {
  console.log('⏰ [Cron Job 3] Iniciando comprobacion documentos faltantes...');

  try {

    reiniciarAuditoriaDocumentos();
    getIO().to('servidor_backup').emit('py_request_documents_server');
    getIO().to('grupo_tiendas').emit('py_request_documents_store', { pedido_por: 'cronwe2e22er2e2' });

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});

scheduleJob('05 22 * * *', async () => {
  console.log('⏰ [Cron Job 3] Iniciando generacion de reportes de rendimiento...');

  // Fecha actual en formato YYYY-MM-DD (zona America/Lima)
  const fechaActual = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Lima'
  });

  try {
    // Activa la recolección: las respuestas se acumulan y al final se arma el Excel + email
    iniciarRecoleccionInformeRendimiento(fechaActual, fechaActual);

    getIO().to('grupo_tiendas').emit('py_request_informe_rendimiento', {
      pedido_por: 'CRONREPORTE01',
      fecha_desde: fechaActual,
      fecha_hasta: fechaActual
    });

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error Informe Rendimiento]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});

// Se ejecuta a las horas: 09:00, 12:00, 15:00, 18:00 y 21:00
scheduleJob('0 9,12,15,18,21 * * *', async () => {
  console.log('⏰ [Cron Job] Iniciando verificacion traffic counter...');

  try {
    console.log('Iniciando tarea programada: verificacion traffic counter...');

    // Emitimos la señal reutilizando la lógica
    getIO().to('grupo_tiendas').emit('py_traffic_counter_verification', {
      pedido_por: 'mismosistema'
    });

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima" // Mantiene tu zona horaria de Perú
});

scheduleJob('0 9,12,15,17,21 * * *', async () => {
  console.log('⏰ [Cron Job] Iniciando verificacion SUNAT...');

  try {
    console.log('Iniciando tarea programada: verificacion SUNAT...');
    await executeVerificationSunat();

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima" // Mantiene tu zona horaria de Perú
});

const executeClientDeleteLogic = async (socketIdFallback) => {
  try {
    let [data] = await pool.query(`SELECT * FROM TB_CLIENTES_CLEAR_FORNT;`);
    let extra_client = String(data[0]?.LIST_CLIENTE || '').split(',').filter(Boolean);

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

const executeSendVentasFTP = async () => {
  try {
    // Asegúrate de que getIO() esté disponible en este archivo
    getIO().to('servidor_backup').emit('py_send_ventas_ftp');
    console.log(`[CRON] Señal emitida exitosamente a las 10:00 AM`);

  } catch (error) {
    console.error('[CRON ERROR] Error en ejecución programada:', error);
  }
};


const executeVerificationSunat = async () => {
  try {
    // Asegúrate de que getIO() esté disponible en este archivo
    getIO().to('servidor_backup').emit('py_verificacion_sunat');
    console.log(`[CRON] Señal emitida SUNAT exitosamente`);

  } catch (error) {
    console.error('[CRON ERROR] Error en ejecución programada:', error);
  }
};

app.use(centerErrorHandler);

export { app,httpServer };
await startCenterRuntime({moduleUrl:import.meta.url,app,server:httpServer,io:getIO(),pools:[pool],mail:emailService,port:3002,service:'center-service'});
