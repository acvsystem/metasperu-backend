import { Server } from 'socket.io';

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: (origin, callback) => callback(null, true), // Permite cualquier origen
            credentials: true,
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('center-service: Cliente conectado:', socket.id);
        // --- ESTO ES LO QUE FALTA ---
        socket.on('join_session', (sessionCode) => {

            if (sessionCode) {
                const room = sessionCode.toUpperCase().trim();
                socket.join(room);
                console.log(`center-service: Socket ${socket.id} se unió a la sala: ${room}`);
            }
        });

        socket.on('disconnect', () => {
            console.log('center-service: Cliente desconectado:', socket.id);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("center-service: Socket.io no ha sido inicializado");
    return io;
};