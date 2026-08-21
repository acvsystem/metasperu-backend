const LOG_TABLE = 'bd_metasperu.tb_api_logs';
const MAX_FIELD_LENGTH = 65000;
const SENSITIVE_KEYS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'password',
    'contrasena',
    'contraseña',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'api_key',
    'apikey'
]);

let tableReadyPromise = null;

function ensureLogTable(pool) {
    if (!tableReadyPromise) {
        tableReadyPromise = pool.execute(`
            CREATE TABLE IF NOT EXISTS ${LOG_TABLE} (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                service_name VARCHAR(80) NOT NULL,
                method VARCHAR(12) NOT NULL,
                original_url TEXT NOT NULL,
                route_path VARCHAR(500) NULL,
                status_code INT NULL,
                success TINYINT(1) NOT NULL DEFAULT 0,
                duration_ms INT UNSIGNED NULL,
                user_id VARCHAR(120) NULL,
                user_name VARCHAR(255) NULL,
                user_role VARCHAR(120) NULL,
                user_payload LONGTEXT NULL,
                ip VARCHAR(80) NULL,
                user_agent TEXT NULL,
                request_headers LONGTEXT NULL,
                request_query LONGTEXT NULL,
                request_body LONGTEXT NULL,
                response_error LONGTEXT NULL,
                error_message TEXT NULL,
                PRIMARY KEY (id),
                INDEX idx_api_logs_created_at (created_at),
                INDEX idx_api_logs_service_status (service_name, status_code),
                INDEX idx_api_logs_user (user_id, user_role)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).catch((error) => {
            tableReadyPromise = null;
            console.error('[api-log] No se pudo crear la tabla de auditoria:', error.message);
        });
    }

    return tableReadyPromise;
}

function truncate(value) {
    if (value === null || value === undefined) return null;

    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) return text;

    return text.length > MAX_FIELD_LENGTH
        ? `${text.slice(0, MAX_FIELD_LENGTH)}...[TRUNCATED]`
        : text;
}

function redact(value) {
    if (Array.isArray(value)) {
        return value.map(redact);
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.entries(value).reduce((acc, [key, item]) => {
        const normalizedKey = String(key).toLowerCase();
        acc[key] = SENSITIVE_KEYS.has(normalizedKey) ? '[REDACTED]' : redact(item);
        return acc;
    }, {});
}

function decodeJwtPayload(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return null;

    const token = authHeader.slice(7);
    const payload = token.split('.')[1];
    if (!payload) return null;

    try {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(normalized, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch (error) {
        return null;
    }
}

function getUserInfo(req) {
    const payload = req.user || decodeJwtPayload(req) || {};

    return {
        userId: payload.id || payload.ID || payload.userId || payload.usuario || payload.username || payload.email || null,
        userName: payload.nombre || payload.name || payload.username || payload.usuario || payload.email || null,
        userRole: payload.role || payload.rol || payload.nivel || payload.perfil || null,
        payload
    };
}

function shouldSkip(req) {
    if (req.method === 'OPTIONS') return true;
    if (req.originalUrl === '/health' || req.originalUrl === '/health/db') return true;
    if (req.originalUrl.includes('/api/logs')) return true;
    return false;
}

function createApiLogger({ pool, serviceName }) {
    ensureLogTable(pool);

    return (req, res, next) => {
        if (shouldSkip(req)) {
            next();
            return;
        }

        const startedAt = Date.now();
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        let responseBody = null;

        res.json = (body) => {
            responseBody = body;
            return originalJson(body);
        };

        res.send = (body) => {
            if (responseBody === null || responseBody === undefined) {
                responseBody = body;
            }

            return originalSend(body);
        };

        res.on('finish', () => {
            const statusCode = res.statusCode;
            const isError = statusCode >= 400;
            const userInfo = getUserInfo(req);
            const routePath = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : null;
            const responseError = isError ? responseBody : null;
            const errorMessage = isError
                ? responseBody?.message || responseBody?.error?.message || responseBody?.error || res.statusMessage
                : null;

            const values = [
                serviceName,
                req.method,
                req.originalUrl,
                routePath,
                statusCode,
                statusCode < 400 ? 1 : 0,
                Date.now() - startedAt,
                userInfo.userId,
                userInfo.userName,
                userInfo.userRole,
                truncate(redact(userInfo.payload)),
                req.ip || req.socket?.remoteAddress || null,
                req.get('user-agent') || null,
                truncate(redact(req.headers)),
                truncate(redact(req.query)),
                truncate(redact(req.body)),
                truncate(redact(responseError)),
                typeof errorMessage === 'string' ? errorMessage : truncate(errorMessage)
            ];

            ensureLogTable(pool)
                .then(() => pool.execute(
                    `INSERT INTO ${LOG_TABLE} (
                        service_name, method, original_url, route_path, status_code, success,
                        duration_ms, user_id, user_name, user_role, user_payload, ip, user_agent,
                        request_headers, request_query, request_body, response_error, error_message
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    values
                ))
                .catch((error) => {
                    console.error('[api-log] No se pudo guardar auditoria:', error.message);
                });
        });

        next();
    };
}

export { createApiLogger };
export default createApiLogger;
