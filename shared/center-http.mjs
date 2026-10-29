import { randomUUID } from 'node:crypto';
import { reportCenterError } from './center-diagnostics.mjs';
export function installCenterHttp(app, { helmet, cors, cookieParser, rateLimit, express, origins }) {
  const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw new Error('TRUST_PROXY_HOPS invalido.');
  app.disable('x-powered-by');
  app.set('trust proxy', hops);
  app.use(helmet());
  app.use(cors({ origin: origins.cors, credentials: true, exposedHeaders: ['X-Request-ID','ETag'] }));
  app.use(origins.protect);
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ limit: '64kb', extended: false }));
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-ID', req.requestId);
    res.set('Cache-Control', 'no-store');
    const started = performance.now();
    const json = res.json.bind(res);
    res.json = body => json(res.statusCode >= 500 ? { message: 'No se pudo completar la operacion.', requestId: req.requestId } : body);
    res.once('finish', () => console.log(JSON.stringify({ event:'http.request', requestId:req.requestId,
      method:req.method, route:req.route?.path, status:res.statusCode, durationMs:Math.round(performance.now()-started), userId:req.user?.id })));
    next();
  });
  app.use(rateLimit({ windowMs:60000, limit:600, standardHeaders:'draft-8', legacyHeaders:false,
    message:{message:'Demasiadas solicitudes. Intente nuevamente en un momento.'} }));
}

export function centerErrorHandler(error, req, res, next) {
  if(res.headersSent)return next(error);
  reportCenterError('http.failed',error,req.requestId);
  const status = error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
  res.status(status).json({message:status === 413 ? 'El contenido supera el limite permitido.' : 'No se pudo procesar la solicitud.',requestId:req.requestId});
}
