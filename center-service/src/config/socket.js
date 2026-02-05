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

    let tiendasActivas = {};

    io.on('connection', (socket) => {
        console.log('center-service: Cliente conectado:', socket.id);


        socket.on('registrar_dashboard', () => {
            socket.join('dashboards');
            // Enviamos solo a ESTE socket la lista actual de tiendas
            socket.emit('actualizar_dashboard', Object.values(tiendasActivas));
            console.log('Dashboard refrescado y sincronizado');
        });

        // --- Lógica para las Tiendas (Python) ---
        socket.on('tienda_identificarse', (data) => {

            socket.join('grupo_tiendas');
            tiendasActivas[data.id_tienda] = {
                serie: data.id_tienda,
                socketId: socket.id,
                nombre: data.nombre,
                lastSeen: new Date()
            };
            console.log(`Tienda conectada: ${data.id_tienda}`);
            io.emit('actualizar_dashboard', Object.values(tiendasActivas));
        });

        // --- Lógica para el Dashboard (Angular) ---
        socket.on('solicitar_documentos', (id_tienda) => {
            const tienda = tiendasActivas[id_tienda];
            if (tienda) {
                // Le pedimos a la caja específica que nos de sus documentos
                io.to(tienda.socketId).emit('python_dame_documentos', { pedido_por: socket.id });
            }
        });

        // --- Retorno de Python al Dashboard ---
        socket.on('python_entrega_documentos', (data) => {
            // data.enviar_a es el socketId del Dashboard que pidió la info
            io.to(data.enviar_a).emit('documentos_recibidos', data.documentos);
        });

        socket.on('disconnect', () => {
            // Limpiar al desconectar
            const idTienda = tiendasActivas[socket.id];

            if (idTienda) {
                console.log(`Tienda ${idTienda} OFFLINE`);

                // Notificamos al dashboard que esta tienda ya no está
                io.emit('cambio_estado_tienda', { id: idTienda, online: false });

                // Limpiamos nuestra memoria
                delete tiendasActivas[socket.id];
            }
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("center-service: Socket.io no ha sido inicializado");
    return io;
};