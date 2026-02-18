import { Server } from 'socket.io';

let io;
let tiendasActivas = {};

export const tiendasOnline = [];
export const servidorOnline = {
    socketId: '',
    nombre: '',
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
        console.log('center-service: Cliente conectado:', socket.id);

        socket.on('registrar_servidor', (data) => {
            socket.join('servidor_backup');
            // Enviamos solo a ESTE socket la lista actual de tiendas
            //socket.emit('actualizar_dashboard', Object.values(tiendasActivas));
            servidorOnline.socketId = socket.id;
            servidorOnline.nombre = data.id_servidor
            servidorOnline.online = true;

            console.log("registrar_servidor", servidorOnline);
            console.log(`Servidor conectado: ${data.id_servidor}`);
        });

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
                lastSeen: new Date(),
                online: true
            };

            const index = tiendasOnline.findIndex((store) => store.serie == data.id_tienda);

            if (index == -1) {
                (tiendasOnline || []).push(tiendasActivas);
            }

            auditoriaEstado.totalTiendasEsperadas = Object.keys(tiendasActivas).length;
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
                auditoriaEstado.totalTiendasEsperadas = Object.keys(tiendasActivas).length;
            }
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("center-service: Socket.io no ha sido inicializado");
    return io;
};

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
    tiendasOnline.map((store) => {
        let serie = Object.keys(store)[0];
        const resultadosFinales = obtenerFaltantes(serie, auditoriaEstado.tiendasData[serie], auditoriaEstado.serverData.documentos);

        console.log(resultadosFinales);
        // Enviamos el resultado final al Frontend (Angular)
        io.emit('documents_response_dashboard', resultadosFinales);
    });

    // Limpiamos para la próxima auditoría
    resetearAuditoria();
}

function obtenerFaltantes(serieStore, store, servidor) {
    // 1. Creamos un Set con los IDs del servidor para búsqueda rápida O(1)
    const idsEnServidor = new Set(JSON.parse(servidor).map(s => s.cmpNumero));

    // 2. Filtramos los de la tienda que NO están en el servidor
    const faltantes = JSON.parse(store).filter(t => {
        // Normalizamos el ID de la tienda: "B7A4" + "-" + "00245813"
        // padStart(8, '0') asegura que el número tenga 8 dígitos
        const idNormalizadoTienda = `${t.cmpSerie}-${t.cmpNumero.toString().padStart(8, '0')}`;

        return !idsEnServidor.has(idNormalizadoTienda);
    });

    console.log(`🚀 Documentos Faltantes ${serieStore} - ${faltantes.length}`);
    return { serie: serieStore, documents: faltantes, length: faltantes.length };
}

function resetearAuditoria() {
    auditoriaEstado.serverData = null;
    auditoriaEstado.tiendasData = {};
}