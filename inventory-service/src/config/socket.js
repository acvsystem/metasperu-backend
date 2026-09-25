import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

let io;
const JWT_SECRET = 'una_clave_muy_segura_y_larga_123456';
const adminMonitorRoom = 'ops:socket-monitor';
const recentEvents = [];
const eventCounts = new Map();
const socketStartedAt = Date.now();
let monitorInterval;

const pushRecentEvent = (event) => {
    const entry = { ts: new Date().toISOString(), ...event };
    recentEvents.push(entry);
    if (recentEvents.length > 80) recentEvents.shift();
    return entry;
};

const countEvent = (name) => {
    eventCounts.set(name, (eventCounts.get(name) || 0) + 1);
};

const roomSnapshot = () => {
    if (!io) return [];
    const rooms = [];
    for (const [room, sockets] of io.sockets.adapter.rooms) {
        if (io.sockets.sockets.has(room)) continue;
        rooms.push({ room, sockets: sockets.size });
    }
    return rooms.sort((a, b) => b.sockets - a.sockets).slice(0, 12);
};

const statsSnapshot = () => ({
    connected: io?.engine?.clientsCount || 0,
    authenticated: [...(io?.sockets?.sockets?.values() || [])].filter(socket => socket.data?.user?.id).length,
    rooms: roomSnapshot(),
    events: [...eventCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12),
    recent: [...recentEvents].reverse().slice(0, 30),
    uptime_seconds: Math.floor((Date.now() - socketStartedAt) / 1000),
    generated_at: new Date().toISOString()
});

const emitMonitorStats = () => {
    if (!io) return;
    io.to(adminMonitorRoom).emit('socket_monitor_stats', statsSnapshot());
};

export const trackSocketEmit = (event, payload = {}) => {
    countEvent(`out:${event}`);
    const entry = pushRecentEvent({ direction: 'out', event, ...payload });
    logger.info('socket_emit', entry);
    emitMonitorStats();
};

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: (origin, callback) => callback(null, true), // Permite cualquier origen
            credentials: true,
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        countEvent('connection');
        const connectionEvent = pushRecentEvent({ direction: 'in', event: 'connection', socket_id: socket.id });
        logger.info('socket_connection', connectionEvent);

        const token = socket.handshake.auth?.token;
        if (typeof token === 'string' && token.trim()) {
            try {
                const user = jwt.verify(token, JWT_SECRET);
                if (user?.id) {
                    socket.data.user = user;
                    socket.join(`user:${user.id}`);
                    const role = String(user.role || '').toLowerCase();
                    if (['administrador', 'auditor'].includes(role)) socket.join(adminMonitorRoom);
                    logger.info('socket_authenticated', { socket_id: socket.id, user_id: user.id, role: user.role || null });
                }
            } catch {
                logger.warn('socket_auth_failed', { socket_id: socket.id });
            }
        }

        socket.onAny((event, ...args) => {
            countEvent(`in:${event}`);
            const payload = args[0];
            const entry = pushRecentEvent({
                direction: 'in',
                event,
                socket_id: socket.id,
                user_id: socket.data.user?.id || null,
                room: typeof payload === 'string' ? payload : payload?.session_code || payload?.room || null
            });
            logger.info('socket_event', entry);
            emitMonitorStats();
        });

        socket.on('subscribe_socket_monitor', () => {
            const role = String(socket.data.user?.role || '').toLowerCase();
            if (!['administrador', 'auditor'].includes(role)) {
                logger.warn('socket_monitor_denied', { socket_id: socket.id, user_id: socket.data.user?.id || null });
                return;
            }
            socket.join(adminMonitorRoom);
            socket.emit('socket_monitor_stats', statsSnapshot());
        });

        // --- ESTO ES LO QUE FALTA ---
        socket.on('join_session', (sessionCode) => {

            if (sessionCode) {
                const room = sessionCode.toUpperCase().trim();
                socket.join(room);
                logger.info('socket_join_session', { socket_id: socket.id, user_id: socket.data.user?.id || null, room });
            }
        });

        socket.on('disconnect', (reason) => {
            countEvent('disconnect');
            const entry = pushRecentEvent({ direction: 'in', event: 'disconnect', socket_id: socket.id, user_id: socket.data.user?.id || null, reason });
            logger.info('socket_disconnect', entry);
            emitMonitorStats();
        });

        emitMonitorStats();
    });

    clearInterval(monitorInterval);
    monitorInterval = setInterval(emitMonitorStats, 3000);

    return io;
};

export const emitToUser = (userId, event, payload) => {
    if (!io || !userId) return;
    trackSocketEmit(event, { target: `user:${userId}`, user_id: userId });
    io.to(`user:${userId}`).emit(event, payload);
};

export const getIO = () => {
    if (!io) throw new Error("Socket.io no ha sido inicializado");
    return io;
};
