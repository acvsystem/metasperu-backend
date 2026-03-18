import { Server } from 'socket.io';

let io;

export let tiendasOnline = {};


export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: (origin, callback) => callback(null, true), // Permite cualquier origen
            credentials: true,
            methods: ["GET", "POST"]
        }
    });


    io.on('connection', (socket) => {
        console.log('center-resources-human-service: Cliente conectado:', socket.id);

        socket.on('py_register_server_backup', (info) => {
            socket.join('servidor_backup'); // Unimos la tienda a una "sala" por su ID única
            socket.servidorId = info.id;
            console.log(`🏪 Servidor BACKUP registrado`);
        });

        socket.on('py_register_server_ejb', (info) => {
            socket.join('servidor_ejb'); // Unimos la tienda a una "sala" por su ID única
            socket.servidorId = info.id;
            console.log(`🏪 Servidor EJB registrado`);
        });

        socket.on('disconnect', () => {
            console.log('❌ Tienda desconectada');
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("🚀 center-resources-human-service: Socket.io no ha sido inicializado");
    return io;
};
