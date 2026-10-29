import { startCenterRuntime } from '../../shared/center-runtime.mjs';
import { runScheduledOnce } from '../../shared/center-scheduler.mjs';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { installCenterHttp, centerErrorHandler } from '../../shared/center-http.mjs';
import { origins } from './config/security.js';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import compression from 'compression';
import { initSocket, getIO } from './config/socket.js';
import { pool } from './config/db.js';
import rrhhRoutes from './routes/resources-human.routes.js';
import { emailService } from './services/email.service.js';
import cron from 'node-cron';
//import { createApiLogger } from '../../shared/api-log.middleware.js';

const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT || 3004);
initSocket(httpServer);

app.disable('x-powered-by');




installCenterHttp(app,{helmet,cookieParser,rateLimit,cors,express,origins});

app.use(compression());


//app.use(createApiLogger({ pool, serviceName: 'center-resources-human-service' }));


let scheduledIndex=0;
const scheduleJob=(expression,task,options)=>{
 const name='center-resources-human-service'+':'+(++scheduledIndex)+':'+expression;
 if(process.env.ENABLE_SCHEDULED_JOBS!=='true')return;
 cron.schedule(expression,()=>runScheduledOnce(pool,name,task).catch(()=>console.error(JSON.stringify({event:'scheduled.failed',job:name}))),options);
};
scheduleJob('00 8 * * 0', async () => {
  console.log('⏰ [Cron Job] Iniciando comprobación de horarios creados...');

  const hoy = new Date();

  const mañana = new Date(hoy.getTime() + 24 * 60 * 60 * 1000);

  const fechaFormateada = mañana.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  let day = fechaFormateada.replaceAll('/', '-');

  try {

    const query = `SELECT LT.*
        FROM TB_LISTA_TIENDA LT
        LEFT JOIN TB_HORARIO_PROPERTY HP
            ON HP.CODIGO_TIENDA = LT.SERIE_TIENDA
            AND TRIM(SUBSTRING_INDEX(HP.RANGO_DIAS, ' ', 1)) = ?
        WHERE HP.CODIGO_TIENDA IS NULL AND LT.SERIE_TIENDA != 'HK' AND LT.SERIE_TIENDA != 'HG'AND LT.ESTATUS != 'INACTIVO';`;

    const [rows] = await pool.query(query, [day]);

    if (rows.length > 0) {
      await emailService.pushToEmailQueue({
        email: ['itperu@metasperu.com', 'johnnygermano@metasperu.com', 'paulodosreis@metasperu.com', 'carlosmoron@metasperu.com', 'fieldleaderbbw@metasperu.com', 'fieldleadervs@metasperu.com'],
        subject: `Alerta de tiendas Sin horario creado `,
        template: 'sedesSinHorario',
        variables: { sedes: rows, periodo: day }
      });
    } else {
      await emailService.pushToEmailQueue({
        email: ['itperu@metasperu.com', 'johnnygermano@metasperu.com', 'paulodosreis@metasperu.com', 'carlosmoron@metasperu.com'],
        subject: `Alerta de tiendas Sin horario creado `,
        template: 'sedesHorarioCorrecto',
        variables: { periodo: day }
      });
    }

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    service: 'center-resources-human-service',
    uptime: process.uptime()
  });
});

app.get('/health/db', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ success: true, database: 'ok' });
  } catch (error) {
    res.status(503).json({ success: false, database: 'error' });
  }
});

app.use('/s5/center/resources/human', rrhhRoutes);

app.use(centerErrorHandler);

export { app,httpServer };
await startCenterRuntime({moduleUrl:import.meta.url,app,server:httpServer,io:getIO(),pools:[pool],mail:emailService,port:3004,service:'center-resources-human-service'});
