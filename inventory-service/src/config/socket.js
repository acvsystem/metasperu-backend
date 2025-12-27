import { Server } from 'socket.io';

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "http://localhost:4200", // URL de tu PWA Angular
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    io.on('connection', (socket) => {
        console.log('Cliente conectado:', socket.id);
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("Socket.io no ha sido inicializado");
    return io;
};