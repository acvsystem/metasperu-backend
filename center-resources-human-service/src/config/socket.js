import { Server } from 'socket.io';

let io;

export let tiendasOnline = {};

const parseOrigins = () => {
    if (!process.env.CORS_ORIGINS) return (origin, callback) => callback(null, true);
    const allowedOrigins = process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
    return (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin));
};

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: parseOrigins(),
            credentials: true,
            methods: ["GET", "POST"]
        },
        pingInterval: Number(process.env.SOCKET_PING_INTERVAL || 25000),
        pingTimeout: Number(process.env.SOCKET_PING_TIMEOUT || 60000),
        maxHttpBufferSize: Number(process.env.SOCKET_MAX_HTTP_BUFFER_SIZE || 10000000)
    });

    io.on('connection', (socket) => {
        console.log('center-resources-human-service: Cliente conectado:', socket.id);

        socket.on('py_register_server_backup', (info) => {
            socket.join('servidor_backup');
            socket.servidorId = info.id;
            console.log('Servidor BACKUP registrado');
        });

        socket.on('py_register_server_ejb', (info) => {
            socket.join('servidor_ejb');
            socket.servidorId = info.id;
            console.log('Servidor EJB registrado');
        });

        socket.on('disconnect', () => {
            console.log('Cliente desconectado');
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("center-resources-human-service: Socket.io no ha sido inicializado");
    return io;
};
