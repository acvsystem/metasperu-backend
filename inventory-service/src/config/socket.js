import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

let io;
const JWT_SECRET = 'una_clave_muy_segura_y_larga_123456';

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: (origin, callback) => callback(null, true), // Permite cualquier origen
            credentials: true,
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('Cliente conectado:', socket.id);

        const token = socket.handshake.auth?.token;
        if (typeof token === 'string' && token.trim()) {
            try {
                const user = jwt.verify(token, JWT_SECRET);
                if (user?.id) {
                    socket.data.user = user;
                    socket.join(`user:${user.id}`);
                    console.log(`Socket ${socket.id} se unió al chat del usuario: ${user.id}`);
                }
            } catch {
                console.warn(`Socket ${socket.id} no pudo autenticarse para chat`);
            }
        }

        // --- ESTO ES LO QUE FALTA ---
        socket.on('join_session', (sessionCode) => {

            if (sessionCode) {
                const room = sessionCode.toUpperCase().trim();
                socket.join(room);
                console.log(`Socket ${socket.id} se unió a la sala: ${room}`);
            }
        });

        socket.on('disconnect', () => {
            console.log('Cliente desconectado:', socket.id);
        });
    });

    return io;
};

export const emitToUser = (userId, event, payload) => {
    if (!io || !userId) return;
    io.to(`user:${userId}`).emit(event, payload);
};

export const getIO = () => {
    if (!io) throw new Error("Socket.io no ha sido inicializado");
    return io;
};
