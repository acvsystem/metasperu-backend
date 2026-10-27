import { Server } from 'socket.io';
import { security, origins } from './security.js';
import { readSessionToken } from '../../../shared/inventory-security.mjs';
import { verifyImporter } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';
import { pool } from './db.js';

let io;
const adminMonitorRoom = 'ops:socket-monitor';
const recentEvents = [];
const eventCounts = new Map();
const socketStartedAt = Date.now();
let monitorInterval;

const canUseMonitor = (role) => ['administrador'].includes(String(role || '').toLowerCase());

const getUserRole = async (userId) => {
  if (!userId) return '';
  const [[user]] = await pool.query('SELECT role FROM usuarios WHERE id = ? AND estado = 1', [
    userId,
  ]);
  return user?.role || '';
};

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
  authenticated: [...(io?.sockets?.sockets?.values() || [])].filter(
    (socket) => socket.data?.user?.id,
  ).length,
  rooms: roomSnapshot(),
  events: [...eventCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12),
  recent: [...recentEvents].reverse().slice(0, 30),
  uptime_seconds: Math.floor((Date.now() - socketStartedAt) / 1000),
  generated_at: new Date().toISOString(),
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
    allowRequest: (req, callback) => callback(null, origins.accepts(req.headers.origin)),
    cors: {
      origin: origins.cors,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || readSessionToken(socket.request);
      socket.data.token = token;
      try {
        socket.data.importer = verifyImporter(token);
      } catch {
        socket.data.user = await security.authenticate(token);
      }
      next();
    } catch {
      next(new Error('Sesión inválida o expirada.'));
    }
  });

  io.on('connection', (socket) => {
    countEvent('connection');
    const connectionEvent = pushRecentEvent({
      direction: 'in',
      event: 'connection',
      socket_id: socket.id,
    });
    logger.info('socket_connection', connectionEvent);

    if (socket.data.user) socket.join(`user:${socket.data.user.id}`);
    const revalidate = async () => {
      try {
        if (socket.data.importer) {
          socket.data.importer = verifyImporter(socket.data.token);
          return;
        }
        const user = await security.authenticate(socket.data.token);
        if (user.role !== socket.data.user.role) {
          // A downgrade must remove privileged subscriptions immediately upon revalidation.
          for (const room of socket.rooms)
            if (room !== socket.id && room !== `user:${user.id}`) socket.leave(room);
        }
        socket.data.user = user;
      } catch {
        socket.disconnect(true);
        throw new Error('Sesión expirada.');
      }
    };
    socket.use(async (packet, next) => {
      try {
        await revalidate();
        next();
      } catch (error) {
        next(error);
      }
    });
    // Also revoke passive subscriptions; no activity is required from the client.
    const validationTimer = setInterval(() => {
      revalidate().catch(() => {});
    }, 15000);
    validationTimer.unref();
    socket.on('disconnect', () => clearInterval(validationTimer));

    socket.onAny((event, ...args) => {
      countEvent(`in:${event}`);
      const payload = args[0];
      const entry = pushRecentEvent({
        direction: 'in',
        event,
        socket_id: socket.id,
        user_id: socket.data.user?.id || null,
        room:
          typeof payload === 'string' ? payload : payload?.session_code || payload?.room || null,
      });
      logger.info('socket_event', entry);
      emitMonitorStats();
    });

    socket.on('subscribe_socket_monitor', async () => {
      const userId = socket.data.user?.id || null;
      let role = socket.data.user?.role || '';
      try {
        role = role || (await getUserRole(userId));
      } catch (error) {
        logger.warn('socket_monitor_role_lookup_failed', {
          socket_id: socket.id,
          user_id: userId,
          error: error.message,
        });
      }
      if (!canUseMonitor(role)) {
        logger.warn('socket_monitor_denied', {
          socket_id: socket.id,
          user_id: userId,
          role: role || null,
        });
        socket.emit('socket_monitor_stats', {
          denied: true,
          message: 'Solo el administrador puede ver el monitor de sockets.',
          generated_at: new Date().toISOString(),
        });
        return;
      }
      socket.data.user = { ...socket.data.user, role };
      socket.join(adminMonitorRoom);
      socket.emit('socket_monitor_stats', statsSnapshot());
    });

    // --- ESTO ES LO QUE FALTA ---
    socket.on('leave_session', (room) => {
      if (typeof room === 'string' && /^[A-Z0-9_-]{1,32}$/i.test(room))
        socket.leave(room.toUpperCase());
    });
    socket.on('join_session', async (sessionCode, ack) => {
      const reply = (result) => {
        if (typeof ack === 'function') ack(result);
      };
      if (typeof sessionCode !== 'string' || !/^[A-Z0-9_-]{1,32}$/i.test(sessionCode))
        return reply({ success: false });
      const room = sessionCode.trim().toUpperCase();
      try {
        if (socket.data.importer) {
          if (room !== socket.data.importer.store.toUpperCase()) return reply({ success: false });
        } else {
          const [[session]] = await pool.query(
            'SELECT id, estado FROM inventario_sesiones WHERE codigo_sesion = ?',
            [room],
          );
          if (!session || (socket.data.user.role === 'pocket' && session.estado !== 'ACTIVO'))
            return reply({ success: false });
        }
        await socket.join(room);
        reply({ success: true });
      } catch {
        reply({ success: false });
      }
    });

    socket.on('disconnect', (reason) => {
      countEvent('disconnect');
      const entry = pushRecentEvent({
        direction: 'in',
        event: 'disconnect',
        socket_id: socket.id,
        user_id: socket.data.user?.id || null,
        reason,
      });
      logger.info('socket_disconnect', entry);
      emitMonitorStats();
    });

    emitMonitorStats();
  });

  clearInterval(monitorInterval);
  monitorInterval = setInterval(emitMonitorStats, 3000);
  monitorInterval.unref();
  io.on('close', () => clearInterval(monitorInterval));

  return io;
};

export const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  trackSocketEmit(event, { target: `user:${userId}`, user_id: userId });
  io.to(`user:${userId}`).emit(event, payload);
};

export const getIO = () => {
  if (!io) throw new Error('Socket.io no ha sido inicializado');
  return io;
};
