import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { isProcessEntrypoint } from '../../shared/process-entrypoint.mjs';
import { origins } from './config/security.js';
import routes from './routes/auth.routes.js';

export function createApp() {
  const app = express();
  const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw Error('TRUST_PROXY_HOPS inválido.');
  app.set('trust proxy', hops);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: "*", credentials: true }));
  app.use(origins.protect);
  app.use(cookieParser());
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Single-process guard. A shared gateway limiter is required when scaling workers.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1200,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Demasiadas solicitudes. Intente en unos minutos.' },
    }),
  );
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) =>
      ipKeyGenerator(req.ip) +
      ':' +
      createHash('sha256')
        .update(
          String(req.body?.username || '')
            .trim()
            .toLowerCase(),
        )
        .digest('hex'),
    message: { message: 'Demasiados intentos de ingreso. Intente en 15 minutos.' },
  });
  const loginIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Demasiados intentos desde esta red. Intente más tarde.' },
  });
  app.use(['/s2/auth/login', '/s2/auth/center/login'], loginIpLimiter, loginLimiter);
  app.use('/s2/auth', routes);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res
      .status(error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500)
      .json({ message: 'No se pudo procesar la solicitud.' });
  });
  return app;
}

if (isProcessEntrypoint(import.meta.url)) {
  const server = createServer(createApp());

  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log('auth-service iniciado.'));
}
