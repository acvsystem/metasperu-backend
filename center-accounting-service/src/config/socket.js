import { Server } from 'socket.io';

let io;
let tiendasActivas = {}; // Aqui se almacenan las tiendas que van conectandoce 

export let tiendasOnline = {};
export const servidorOnline = { // Aqui se almacena el servidor backup cuando se conecta
    socketId: '',
    nombre: '',// servidor backup
    lastSeen: new Date(),
    online: false
};

const auditoriaEstado = {
    completado: false,
    serverData: null, // Aquí guardaremos los documentos del servidor general
    tiendasData: {},  // Aquí guardaremos los documentos de cada tienda indexados por serie
    totalTiendasEsperadas: 0
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
        console.log('center-accounting-service: Cliente conectado:', socket.id);

        // Registro de tienda
        socket.on('py_register_store', (info) => {
            socket.join(info.id); // Unimos la tienda a una "sala" por su ID única
            socket.join(info.marca); // Unimos la tienda a una "sala" por marca
            socket.tiendaId = info.id;
            console.log(`🏪 Tienda ${info.nombre} registrada en sala ${info.marca}`);
        });

        socket.on('py_response_kardex_store', (data) => {
            const dataKardex = JSON.parse(data.kardex);
            const socketId = data.pedido_por;

            io.to(socketId).emit('dashboard_kardex_store', dataKardex);
        });

        socket.on('py_response_kardex_campos_libres', (data) => {
            console.log(data);
            const message = data.message;
            const socketId = data.pedido_por;

            io.to(socketId).emit('dashboard_kardex_campos_libres', { message: message });
        });

        socket.on('disconnect', () => {
            console.log('❌ Tienda desconectada');
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("🚀 center-accounting-service: Socket.io no ha sido inicializado");
    return io;
};
