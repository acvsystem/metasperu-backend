import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import compression from 'compression';
import { initSocket } from './config/socket.js';
import { pool } from './config/db.js';
import { dev_pool } from './config/dev_bd.js';
import rrhhRoutes from './routes/resources-human.routes.js';
import { emailService } from './services/email.service.js';
import cron from 'node-cron';

const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT || 3004);
const BODY_LIMIT = process.env.BODY_LIMIT || '50mb';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 120000);
const parseOrigins = () => {
  if (!process.env.CORS_ORIGINS) return (origin, callback) => callback(null, true);
  const allowedOrigins = process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
  return (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin));
};

initSocket(httpServer);

app.disable('x-powered-by');
app.set('trust proxy', 1);
httpServer.requestTimeout = REQUEST_TIMEOUT_MS;
httpServer.headersTimeout = REQUEST_TIMEOUT_MS + 5000;

app.use(cors({
  origin: parseOrigins(),
  credentials: true
}));

app.use(compression());
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));


cron.schedule('00 8 * * 0', async () => {
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
        WHERE HP.CODIGO_TIENDA IS NULL AND LT.SERIE_TIENDA != '9M' AND LT.ESTATUS != 'INACTIVO';`;

    const [rows] = await pool.query(query, [day]);

    if (rows.length > 0) {
      emailService.pushToEmailQueue({
        email: ['itperu@metasperu.com'],
        subject: `Alerta de tiendas Sin horario creado `,
        template: 'sedesSinHorario',
        variables: { sedes: rows, periodo: day }
      });
    } else {
      emailService.pushToEmailQueue({
        email: ['itperu@metasperu.com'],
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

app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(err.status || 500).json({
    success: false,
    message: 'Error interno del servidor'
  });
});

const closeGracefully = async (signal) => {
  console.log(`${signal} recibido, cerrando servicio...`);
  httpServer.close(async () => {
    await Promise.allSettled([pool.end(), dev_pool.end()]);
    process.exit(0);
  });
};

process.on('SIGTERM', () => closeGracefully('SIGTERM'));
process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('unhandledRejection', (error) => {
  console.error('Promesa no manejada:', error);
});
process.on('uncaughtException', (error) => {
  console.error('Excepcion no capturada:', error);
});

httpServer.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
});
