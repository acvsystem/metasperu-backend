import { logger } from '../utils/logger.js';

export function httpLogger(req, res, next) {
    const start = process.hrtime.bigint();
    const url = req.originalUrl || req.url;

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level]('http_request', {
            method: req.method,
            url,
            status: res.statusCode,
            duration_ms: Math.round(durationMs),
            user_id: req.user?.id || null,
            ip: req.ip,
            user_agent: req.get('user-agent') || ''
        });
    });

    next();
}
