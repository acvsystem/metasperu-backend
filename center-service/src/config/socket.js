import { Server } from 'socket.io';

let io;
let tiendasActivas = {};

export const tiendasOnline = [];

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: (origin, callback) => callback(null, true), // Permite cualquier origen
            credentials: true,
            methods: ["GET", "POST"]
        }
    });


    const auditoriaEstado = {
        completado: false,
        serverData: null, // Aquí guardaremos los documentos del servidor general
        tiendasData: {},  // Aquí guardaremos los documentos de cada tienda indexados por serie
        totalTiendasEsperadas: Object.values(tiendasActivas).length
    };

    io.on('connection', (socket) => {
        console.log('center-service: Cliente conectado:', socket.id);

        socket.on('registrar_dashboard', () => {
            socket.join('dashboards');
            // Enviamos solo a ESTE socket la lista actual de tiendas
            tiendasOnline.storeOnline.push(Object.values(tiendasActivas));
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
                lastSeen: new Date(),
                online: true
            };
            console.log(`Tienda conectada: ${data.id_tienda}`);
            io.emit('actualizar_dashboard', Object.values(tiendasActivas));
        });

        // --- Retorno de Python store al backend ---
        socket.on('py_response_documents_store', (data) => {
            // Guardamos los documentos de la tienda usando su serie como llave
            auditoriaEstado.tiendasData[data.serie] = data.documentos;

            const totalRecibidas = Object.keys(auditoriaEstado.tiendasData).length;
            console.log(`( ${totalRecibidas} / ${auditoriaEstado.totalTiendasEsperadas} ) Tiendas han respondido.`);

            verificarYComparar();
        });

        // --- Retorno de Python server al backend ---
        socket.on('py_response_documents_server', (data) => {
            auditoriaEstado['serverData'] = data;
        });


        socket.on('disconnect', () => {

            const store = tiendasActivas[socket.handshake.headers.code];

            if (store) {
                console.log(`Tienda ${store.serie} OFFLINE`);

                // Notificamos al dashboard que esta tienda ya no está
                io.emit('actualizar_dashboard', [{ serie: store.serie, online: false }]);

                // Limpiamos nuestra memoria
                delete tiendasActivas[socket.handshake.headers.code];
            }
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("center-service: Socket.io no ha sido inicializado");
    return io;
};



console.log(tiendasOnline);

function verificarYComparar() {
    const totalTiendasRecibidas = Object.keys(auditoriaEstado.tiendasData).length;
    console.log("totalTiendasRecibidas:", totalTiendasRecibidas, "totalTiendasEsperadas:", auditoriaEstado.totalTiendasEsperadas);
    // Condición de éxito: Tenemos el server Y todas las tiendas
    if (auditoriaEstado.serverData && totalTiendasRecibidas === auditoriaEstado.totalTiendasEsperadas) {
        console.log("🚀 ¡Todo listo! Iniciando comparación masiva...");
        iniciarProcesoComparacion();
    }
}

function iniciarProcesoComparacion() {
    const resultadosFinales = [];
    const setServidor = new Set(auditoriaEstado.serverData);

    for (const [serie, docsTienda] of Object.entries(auditoriaEstado.tiendasData)) {
        const faltantes = docsTienda.filter(id => !setServidor.has(id));

        resultadosFinales.push({
            serie: serie,
            totalTienda: docsTienda.length,
            faltantes: faltantes.length,
            detalles: faltantes
        });
    }

    // Enviamos el resultado final al Frontend (Angular)
    io.emit('documents_response_dashboard', resultadosFinales);

    // Limpiamos para la próxima auditoría
    resetearAuditoria();
}

function resetearAuditoria() {
    auditoriaEstado.serverData = null;
    auditoriaEstado.tiendasData = {};
}