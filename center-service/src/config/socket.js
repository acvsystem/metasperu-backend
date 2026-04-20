import { Server } from 'socket.io';
import { emailService } from '../services/email.service.js';
import { pool } from './db.js';

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
        pingTimeout: 60000, // Tiempo de espera para considerar desconexión (60s)
        pingInterval: 25000, // Frecuencia del ping (25s)
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

            console.log("🚀 registrar_servidor", servidorOnline);
            console.log(`🚀 Servidor conectado: ${data.id_servidor}`);
        });

        socket.on('registrar_dashboard', () => {
            enviarActualizacionDashboard();
            socket.join('dashboards');
            // Enviamos solo a ESTE socket la lista actual de tiendas
            console.log('🚀 Dashboard refrescado y sincronizado');
        });

        // --- Lógica para las Tiendas (Python) ---

        socket.on('tienda_identificarse', async (data) => {

            // 1. Guardamos los metadatos dentro del objeto socket.data
            socket.data.id_tienda = data.id_tienda;
            socket.data.nombre = data.nombre;
            socket.data.serie = data.id_tienda;
            socket.data.lastSeen = new Date();

            // 2. Lo unimos a la sala
            await socket.join('grupo_tiendas');
            socket.join(data.id_tienda); // Unimos la tienda a una "sala" por su ID única
            console.log(`🚀 Tienda ${data.id_tienda} registrada en memoria del socket.`);

            // 3. Notificar al dashboard (ver paso siguiente)
            enviarActualizacionDashboard();
        });

        // --- Retorno de Python store al backend documentos de venta---
        socket.on('py_response_documents_store', (data) => {
            // Guardamos los documentos de la tienda usando su serie como llave
            auditoriaEstado.tiendasData[data.serie] = data.documentos;

            const totalRecibidas = Object.keys(auditoriaEstado.tiendasData).length;
            console.log(`🚀 ( ${data.serie} - ${totalRecibidas} ) Tiendas han respondido.`);

            verificarYComparar(data.serie);
        });


        socket.on('py_response_clear_cola_pana', (data) => {
            io.emit('transaction_refresh_dashboard', data);
        });

        // --- Retorno de Python store al backend documentos de venta---
        socket.on('py_response_delete_client', (data) => {
            io.emit('client_refresh_dashboard', data);
        });

        // --- Retorno de Python server al backend ---
        socket.on('py_response_documents_server', (data) => {
            auditoriaEstado['serverData'] = data;
            //verificarYComparar();
        });

        // --- Retorno de python store al backend transacciones
        socket.on('py_requets_transactions_store', (data) => {
            console.log('py_requets_transactions_store', data);
            io.emit('transactions_response_dashboard', data);
        })

        // --- Retorno de python store al backend clientes en blanco
        socket.on('py_response_client_blank', (data) => {
            console.log('py_response_client_blank', data);
            io.emit('client_blank_response_dashboard', data);
        })

        // --- Retorno de python store al backend traffic counter
        socket.on('py_update_devices_status', (data) => {
            io.emit('traffic_response_dashboard', data);
        })

        // --- Retorno de python store al backend transferencia de cola entre cajas
        socket.on('py_response_transfer_terminal', (data) => {
            console.log('py_response_transfer_terminal', data);
            io.emit('transfer_response_dashboard', data);
        });

        // --- Retorno de python store al backend de limpieza de clientes
        socket.on('py_response_delete_client', (data) => {
            console.log('py_response_delete_client', data);
            io.emit('delete_client_esponse_dashboard', data);
        });

        // --- Retorno de python store al backend eliminar cola panama
        socket.on('py_response_delete_cola_panama', (data) => {
            console.log('py_response_delete_cola_panama', data);
            io.emit('delete_cola_panama_dashboard', data);
        });

        // --- Retorno de python server al backend comparacion de documentos
        socket.on('py_response_comparation_documents_server', (data) => {
            console.log('py_response_comparation_documents_server', data);
            io.emit('comparation_documents_server_dashboard', data);
        });

        // --- Retorno de python server al backend documentos pendientes de comparacion
        socket.on('py_response_documents_pending_server', (data) => {
            console.log('py_response_documents_pending_server', data);
            io.emit('documents_pending_server_dashboard', data);
        });

        // --- Retorno de python server al backend status de servidor backup
        socket.on('py_status_server_backup', (data) => {
            io.emit('status_server_backup_dashboard', data);
        });

        // --- Retorno de python server al backend traffic counter de servidor backup
        socket.on('py_response_traffic_counter_verification', (data) => {
            io.emit('traffic_counter_dashboard', data);
        });

        socket.on('disconnect', () => {
            console.log(`❌ Un socket se ha ido.`);
            enviarActualizacionDashboard();

        });


    });

    return io;
};

export const getIO = () => {
    if (!io) throw new Error("🚀 center-service: Socket.io no ha sido inicializado");
    return io;
};

function verificarYComparar(serie) {
    const totalTiendasRecibidas = Object.keys(auditoriaEstado.tiendasData).length;
    console.log("🚀 totalTiendasRecibidas:", totalTiendasRecibidas);
    // Condición de éxito: Tenemos el server Y todas las tiendas

    if (auditoriaEstado.serverData) {
        console.log("🚀 ¡Todo listo! Iniciando comparación masiva...");
        iniciarProcesoComparacion(serie);
    }
}

async function iniciarProcesoComparacion(serie) {
    let resultadosFinales = {};

    if (((auditoriaEstado.tiendasData || [])[serie] || []).length) {

        const query = `
            SELECT DESCRIPCION
            FROM bd_metasperu.tb_lista_tienda t
            WHERE t.SERIE_TIENDA = '${serie}'
        `;

        const [rows] = await pool.execute(query);

        const storeDescription = rows.find(t => {
            return t;
        });

        resultadosFinales = obtenerFaltantes(serie, ((auditoriaEstado.tiendasData || [])[serie] || []), auditoriaEstado.serverData.documentos);
        console.log(resultadosFinales.documents);
        if (resultadosFinales.length > 0) {
            emailService.pushToEmailQueue({
                email: 'andrecanalesv@gmail.com',
                subject: `Documentos Pendientes - ${storeDescription.DESCRIPCION}`,
                template: 'documentosPendientes',
                variables: {
                    tienda: storeDescription.DESCRIPCION, // Esta es la variable {{tienda}}
                    documentos: resultadosFinales.documents
                }
            });
        }

        io.emit('documents_response_dashboard', resultadosFinales);
    } else {
        resultadosFinales = { serie: serie, documents: [], length: 0 };
        io.emit('documents_response_dashboard', resultadosFinales);
    }

}

function obtenerFaltantes(serieStore, storeRaw, servidorRaw) {
    try {
        // 1. Parseo seguro con validación inicial
        const store = JSON.parse(storeRaw || '[]');
        const servidor = JSON.parse(servidorRaw || '[]');

        if (store.length === 0) {
            return { serie: serieStore, documents: [], length: 0 };
        }

        // 2. Indexación eficiente de documentos del servidor
        // Usamos un Set para búsquedas de O(1)
        const idsEnServidor = new Set(servidor.map(s => s.cmpNumero));

        // 3. Filtrado y transformación en una sola pasada
        const faltantes = store.reduce((acc, t) => {
            const idNormalizado = `${t.cmpSerie}-${String(t.cmpNumero).padStart(8, '0')}`;

            if (!idsEnServidor.has(idNormalizado)) {
                acc.push({
                    id: idNormalizado,
                    tipo: t.cmpTipo,
                    fecha: t.cmpFecha
                });
            }
            return acc;
        }, []);

        console.info(`🚀 Documentos Faltantes [${serieStore}]: ${faltantes.length} encontrados.`);

        return {
            serie: serieStore,
            documents: faltantes,
            length: faltantes.length
        };

    } catch (error) {
        console.error("Error al procesar la comparación de documentos:", error);
        return { serie: serieStore, documents: [], length: 0, error: true };
    }
}

async function enviarActualizacionDashboard() {
    // Obtenemos todos los sockets que están en la sala 'grupo_tiendas'
    const sockets = await io.in('grupo_tiendas').fetchSockets();

    const listaTiendas = sockets.map(s => ({
        socketId: s.id,
        id_tienda: s.data.id_tienda,
        nombre: s.data.nombre,
        serie: s.data.serie,
        lastSeen: s.data.lastSeen,
        online: true // Si está en la lista, es porque está online
    }));

    console.log(listaTiendas);
    io.emit('actualizar_dashboard', listaTiendas);
}