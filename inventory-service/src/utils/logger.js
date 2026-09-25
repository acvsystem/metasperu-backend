import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(__dirname, '../../logs');
const serviceName = process.env.SERVICE_NAME || 'inventory-service';
const levels = new Set(['debug', 'info', 'warn', 'error']);

function ensureLogDir() {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
}

function logFileName(date = new Date()) {
    return `${serviceName}-${date.toISOString().slice(0, 10)}.log`;
}

function safePayload(payload = {}) {
    const copy = { ...payload };
    for (const key of Object.keys(copy)) {
        if (/password|token|authorization|cookie/i.test(key)) copy[key] = '[redacted]';
    }
    return copy;
}

function write(level, message, payload = {}) {
    const normalizedLevel = levels.has(level) ? level : 'info';
    const entry = {
        ts: new Date().toISOString(),
        level: normalizedLevel,
        service: serviceName,
        message,
        ...safePayload(payload)
    };

    const line = JSON.stringify(entry);
    const consoleMethod = normalizedLevel === 'error' ? 'error' : normalizedLevel === 'warn' ? 'warn' : 'log';
    console[consoleMethod](line);

    try {
        ensureLogDir();
        fs.appendFile(path.join(logDir, logFileName()), `${line}\n`, () => {});
    } catch (error) {
        console.error('logger_write_failed', error.message);
    }
}

export const logger = {
    debug: (message, payload) => write('debug', message, payload),
    info: (message, payload) => write('info', message, payload),
    warn: (message, payload) => write('warn', message, payload),
    error: (message, payload) => write('error', message, payload)
};
