import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { origins } from './config/security.js';
import { initSocket } from './config/socket.js';
import { httpLogger } from './middleware/http-logger.middleware.js';
import routes from './routes/inventory.routes.js';

export function createApp() {
  const app = express();
  const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw Error('TRUST_PROXY_HOPS inválido.');
  app.set('trust proxy', hops);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: origins.cors, credentials: true }));
  app.use(origins.protect);
  app.use(cookieParser());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: false, limit: '50mb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Single-process guard. A shared gateway limiter is required when scaling workers.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 3000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Demasiadas solicitudes. Intente en unos minutos.' },
    }),
  );
  app.use(httpLogger);
  app.use('/s3/inventory', routes);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res
      .status(error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500)
      .json({ message: 'No se pudo procesar la solicitud.' });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer(createApp());
  initSocket(server);
  server.listen(Number(process.env.PORT || 3001), () => console.log('inventory-service iniciado.'));
}
