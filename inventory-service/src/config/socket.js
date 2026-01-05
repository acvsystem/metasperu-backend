import { Server } from 'socket.io';

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        path: '/inventory-socket/',
        cors: {
            origin: "*", 
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        console.log('Cliente conectado:', socket.id);
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

export const getIO = () => {
    if (!io) throw new Error("Socket.io no ha sido inicializado");
    return io;
};