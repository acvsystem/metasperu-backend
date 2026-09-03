import { Server } from 'socket.io';
import { emailService } from '../services/email.service.js';
import { pool } from './db.js';
import { extraServices } from '../services/extra.services.js';
import crypto from 'crypto';
import * as XLSX from 'xlsx';

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
    serverRespondido: false,
    serverData: null, // Aquí guardaremos los documentos del servidor general
    tiendasData: {},  // Aquí guardaremos los documentos de cada tienda indexados por serie
    comparacionesEnProceso: new Set(),
    comparacionesProcesadas: new Set(),
    totalTiendasEsperadas: 0
};

/** Estado para recolectar informes de rendimiento de todas las tiendas */
const informeRendimientoEstado = {
    activo: false,
    fechaDesde: null,
    fechaHasta: null,
    tiendasData: {},      // serie -> { data: [...], recibidoEn: Date }
    timeoutId: null,
    timeoutMs: 180000,    // 3 minutos para esperar respuestas
    emails: ['itperu@metasperu.com']
};

export function reiniciarAuditoriaDocumentos() {
    auditoriaEstado.completado = false;
    auditoriaEstado.serverRespondido = false;
    auditoriaEstado.serverData = null;
    auditoriaEstado.tiendasData = {};
    auditoriaEstado.comparacionesEnProceso.clear();
    auditoriaEstado.comparacionesProcesadas.clear();
    auditoriaEstado.totalTiendasEsperadas = 0;
}

/**
 * Inicia la recolección del informe de rendimiento (llamado desde el cron o endpoint).
 * Reinicia el estado y programa el cierre automático por timeout.
 */
export function iniciarRecoleccionInformeRendimiento(fechaDesde, fechaHasta) {
    if (informeRendimientoEstado.timeoutId) {
        clearTimeout(informeRendimientoEstado.timeoutId);
    }

    informeRendimientoEstado.activo = true;
    informeRendimientoEstado.fechaDesde = fechaDesde;
    informeRendimientoEstado.fechaHasta = fechaHasta;
    informeRendimientoEstado.tiendasData = {};

    console.log(`📊 [Informe Rendimiento] Recolección iniciada (${fechaDesde} → ${fechaHasta}). Esperando respuestas de tiendas...`);

    informeRendimientoEstado.timeoutId = setTimeout(() => {
        console.log('⏰ [Informe Rendimiento] Timeout alcanzado. Generando Excel con las tiendas que respondieron...');
        finalizarInformeRendimiento();
    }, informeRendimientoEstado.timeoutMs);
}

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
            auditoriaEstado.serverData = data;
            auditoriaEstado.serverRespondido = true;

            Object.keys(auditoriaEstado.tiendasData).forEach((serie) => {
                verificarYComparar(serie);
            });
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
            console.log('py_update_devices_status', data);
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
        // 1. Agregamos "async" al callback del socket
        socket.on('py_response_traffic_counter_verification', async (data) => {
            try {
                const trafficCounter = data || {};

                // Validamos de forma segura que existan dispositivos en el objeto de entrada
                if (!trafficCounter.devices || !Array.isArray(trafficCounter.devices)) {
                    console.log("⚠️ Estructura de Traffic Counter no válida o vacía.");
                    return;
                }

                // Buscamos el dispositivo offline
                const offlineTraffic = trafficCounter.devices.find((t) => t.online === false);

                if (!offlineTraffic) {
                    console.log("🚀 Todos los Traffic Counter están ONLINE");
                } else {
                    // Si hay un dispositivo offline, procedemos a consultar base de datos
                    let connection;
                    try {
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT DESCRIPCION
                     FROM bd_metasperu.tb_lista_tienda t
                     WHERE t.SERIE_TIENDA = ?`,
                            [trafficCounter.serie || '']
                        );


                        if (rows.length > 0) {
                            const store = rows[0];

                            // Enviamos al queue de emails con los parámetros simplificados (IP, TIENDA, ESTATUS)
                            emailService.pushToEmailQueue({
                                email: ['itperu@metasperu.com', 'johnnygermano@metasperu.com'],
                                subject: `ALERTA TRAFFIC COUNTER - ${store.DESCRIPCION}`,
                                template: 'alertaTrafficCounterOffLine',
                                variables: {
                                    tienda: store.DESCRIPCION,
                                    ip: offlineTraffic.ip || 'Sin IP',
                                    estatus: 'OFFLINE' // Forzado a OFFLINE ya que entramos por la condición de t.online === false
                                }
                            });
                        } else {
                            console.log(`⚠️ No se encontró la tienda con la serie: ${offlineTraffic.serie}`);
                        }
                    } catch (dbError) {
                        console.error("❌ Error en la consulta a base de datos:", dbError);
                    } finally {
                        if (connection) connection.release(); // Siempre libera la conexión del pool
                    }
                }

                // Transmitimos al dashboard independientemente de si hay offline o no
                io.emit('traffic_counter_dashboard', data);

            } catch (error) {
                console.error("❌ Error crítico en el socket de verificación:", error);
            }
        });

        socket.on('py_response_informe_rendimiento', (data) => {
            console.log('py_response_informe_rendimiento', data?.serie, Array.isArray(data?.data) ? data.data.length + ' filas' : 'sin data');

            // Si hay un destinatario real (dashboard), reenviar en vivo
            if (data?.enviar_a && data.enviar_a !== 'CRONREPORTE01') {
                io.to(data.enviar_a).emit('response_informe_rendimiento', data);
            }

            // Recolección para el Excel consolidado (cron o sesión activa)
            if (informeRendimientoEstado.activo && data?.serie) {
                informeRendimientoEstado.tiendasData[data.serie] = {
                    data: Array.isArray(data.data) ? data.data : [],
                    recibidoEn: new Date()
                };

                const totalRecibidas = Object.keys(informeRendimientoEstado.tiendasData).length;
                console.log(`📊 [Informe Rendimiento] (${data.serie}) Tiendas respondieron: ${totalRecibidas}`);

                // Intentar finalizar si ya respondieron todas las tiendas online
                tryFinalizarSiCompleto();
            }
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
    console.log("totalTiendasRecibidas:", totalTiendasRecibidas);

    if (!auditoriaEstado.serverRespondido) {
        console.log(`Esperando respuesta del servidor para comparar la tienda ${serie}.`);
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(auditoriaEstado.tiendasData, serie)) {
        console.log(`Esperando respuesta de la tienda ${serie}.`);
        return;
    }

    if (auditoriaEstado.comparacionesProcesadas.has(serie) || auditoriaEstado.comparacionesEnProceso.has(serie)) {
        console.log(`La tienda ${serie} ya fue enviada a comparacion en esta auditoria.`);
        return;
    }

    auditoriaEstado.comparacionesEnProceso.add(serie);
    console.log("Todo listo. Iniciando comparacion masiva...");

    iniciarProcesoComparacion(serie)
        .then(() => {
            auditoriaEstado.comparacionesProcesadas.add(serie);
        })
        .catch((error) => {
            console.error(`Error al comparar documentos de la tienda ${serie}:`, error);
        })
        .finally(() => {
            auditoriaEstado.comparacionesEnProceso.delete(serie);
        });
}
async function iniciarProcesoComparacion(serie) {
    let resultadosFinales = {};

    if (((auditoriaEstado.tiendasData || [])[serie] || []).length && (((auditoriaEstado || {}).serverData || {}).documentos || []).length) {

        const query = `
            SELECT DESCRIPCION
            FROM bd_metasperu.tb_lista_tienda t
            WHERE t.SERIE_TIENDA = ?
        `;

        const [rows] = await pool.execute(query, [serie]);

        const storeDescription = rows.find(t => {
            return t;
        });

        resultadosFinales = obtenerFaltantes(serie, ((auditoriaEstado.tiendasData || [])[serie] || []), auditoriaEstado.serverData.documentos);

        if (resultadosFinales.length > 20) {

            const token = crypto.randomBytes(25).toString('hex');

            await pool.execute("DELETE FROM enlaces_temporales WHERE expiracion < NOW()");

            const [result] = await pool.execute(
                `INSERT INTO enlaces_temporales (token, documentos, expiracion) 
                VALUES (?, ?, NOW() + INTERVAL 8 HOUR)`,
                [token, JSON.stringify(resultadosFinales.documents)]
            );

            const urlTemporal = `https://api.metasperu.net.pe/s1/center/api/documentos-pendientes/${token}`;

            await extraServices.enviarSlack(
                `🚨 *ALERTA: Documentos Pendientes*\n` +
                `*Tienda:*  ${storeDescription.DESCRIPCION}\n` +
                `*Cantidad:*  ${resultadosFinales.length}\n` +
                `*Documentos:* ${urlTemporal}`,
                "Comparación de Documentos faltantes", ":bookmark_tabs:"
            );

            emailService.pushToEmailQueue({
                email: ['itperu@metasperu.com', 'johnnygermano@metasperu.com'],
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

        if (store.length && servidor.length) {

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
        }

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

/**
 * Si ya respondieron todas las tiendas online, finaliza antes del timeout.
 */
async function tryFinalizarSiCompleto() {
    if (!informeRendimientoEstado.activo) return;

    try {
        const sockets = await io.in('grupo_tiendas').fetchSockets();
        const seriesOnline = new Set(
            sockets
                .map(s => s.data?.serie || s.data?.id_tienda)
                .filter(Boolean)
        );

        const seriesRecibidas = Object.keys(informeRendimientoEstado.tiendasData);
        const todasRespondieron =
            seriesOnline.size > 0 &&
            [...seriesOnline].every(serie => seriesRecibidas.includes(serie));

        if (todasRespondieron) {
            console.log('✅ [Informe Rendimiento] Todas las tiendas online respondieron. Generando Excel...');
            await finalizarInformeRendimiento();
        }
    } catch (err) {
        console.error('❌ [Informe Rendimiento] Error al verificar completitud:', err.message);
    }
}

/**
 * Genera el Excel consolidado con 1 fila por tienda (usando TOTAL GENERAL)
 * y lo envía por correo a itperu@metasperu.com
 */
async function finalizarInformeRendimiento() {
    if (!informeRendimientoEstado.activo) return;

    // Evitar doble ejecución
    informeRendimientoEstado.activo = false;
    if (informeRendimientoEstado.timeoutId) {
        clearTimeout(informeRendimientoEstado.timeoutId);
        informeRendimientoEstado.timeoutId = null;
    }

    const fechaDesde = informeRendimientoEstado.fechaDesde;
    const fechaHasta = informeRendimientoEstado.fechaHasta;
    const respuestas = { ...informeRendimientoEstado.tiendasData };

    try {
        // Catálogo de tiendas activas
        const [tiendasDb] = await pool.execute(`
            SELECT 
                SERIE_TIENDA AS serie,
                DESCRIPCION AS nombre,
                UNID_SERVICIO AS brand,
                TIPO_TIENDA AS tipo
            FROM bd_metasperu.tb_lista_tienda
            WHERE ESTATUS = 'ACTIVO'
            ORDER BY UNID_SERVICIO ASC, DESCRIPCION ASC
        `);

        const mapaTiendas = {};
        tiendasDb.forEach((t, idx) => {
            mapaTiendas[t.serie] = {
                orden: idx + 1,
                brand: t.brand || '',
                nombre: t.nombre || t.serie,
                tipo: t.tipo || 'RETAIL'
            };
        });

        // ===== ORDEN DESEADO (por SERIE) =====
        const ordenDeseado = [
            { serie: '7J', nombre: 'AVENTURA MALL AREQUIPA' },          // BBW
            { serie: '7F', nombre: 'E-COMMERCE PERU' },                 // BBW
            { serie: '7A', nombre: 'JOCKEY PLAZA' },                    // BBW
            { serie: '7E', nombre: 'LA RAMBLA MALL' },                  // BBW
            { serie: '7I', nombre: 'MALL PLAZA TRUJILLO' },             // BBW
            { serie: '7D', nombre: 'PLAZA SALAVERRY' },                 // BBW
            { serie: '7C', nombre: 'PLAZA SAN MIGUEL MALL' },           // BBW
            { serie: '7R', nombre: 'AVENTURA MALL SANTA ANITA' },       // BBW
            { serie: 'HL', nombre: 'AVENTURA MALL AREQUIPA' },          // VICTORIAS
            { serie: 'HN', nombre: 'AVENTURA MALL SANTA ANITA' },       // VICTORIAS
            { serie: 'HK', nombre: 'E-COMMERCE PERU' },                 // VICTORIAS
            { serie: 'HE', nombre: 'LA RAMBLA MALL' },                  // VICTORIAS
            { serie: 'HF', nombre: 'MALL DEL SUR' },                    // VICTORIAS
            { serie: 'HO', nombre: 'MALL PLAZA ANGAMOS' },              // VICTORIAS
            { serie: 'HM', nombre: 'MALL PLAZA TRUJILLO' },             // VICTORIAS
            { serie: 'HJ', nombre: 'MEGAPLAZA' },                       // VICTORIAS
            { serie: 'HC', nombre: 'PLAZA NORTE MALL' },                // VICTORIAS
            { serie: 'HH', nombre: 'PLAZA SALAVERRY' },                 // VICTORIAS
            { serie: 'HD', nombre: 'PLAZA SAN MIGUEL MALL' },           // VICTORIAS
            { serie: 'HI', nombre: 'PURUCHUCO MALL' },                  // VICTORIAS
            { serie: 'HG', nombre: 'E-COMMERCE PERU' },                 // VICTORIAS
            { serie: 'HB', nombre: 'MINKA' },                           // VSFA
            { serie: 'HA', nombre: 'JOCKEY PLAZA' },                    // VSFA
            { serie: '8A', nombre: 'JOCKEY PLAZA' }                     // TUMI
        ];

        // Mapa rápido de serie → posición
        const ordenMap = new Map();
        ordenDeseado.forEach((item, idx) => {
            ordenMap.set(item.serie, idx);
        });

        // Filas del Excel
        const filas = [];

        tiendasDb.forEach((t) => {
            const respuesta = respuestas[t.serie];
            let ventaSoles = null;
            let ventaDolares = null;
            let unidades = null;
            let stock = null;

            if (respuesta && Array.isArray(respuesta.data)) {
                const total = respuesta.data.find(
                    r => r.NombreDepartamento === 'TOTAL GENERAL' || r.CodDepartamento == null
                ) || respuesta.data[respuesta.data.length - 1];

                if (total) {
                    ventaSoles = total.VentaSoles != null ? Number(total.VentaSoles) : null;
                    ventaDolares = total.VentaDolares != null ? Number(total.VentaDolares) : null;
                    unidades = total.CantidadVendida != null ? Number(total.CantidadVendida) : null;
                    stock = total.Stock != null ? Number(total.Stock) : null;
                }
            }

            // Nombre preferido del ordenDeseado (si existe)
            const nameStore = ordenDeseado.find(o => o.serie === t.serie)?.nombre || t.nombre || t.serie;

            filas.push({
                _serie: t.serie,                    // clave interna para ordenar
                'ORDEN DE TIENDA': 0,
                'BRAND': t.brand == 'VS' ? 'VICTORIAS' : t.brand == 'BBW' ? 'BBW' : t.brand == 'MT' ? 'TUMI' : nameStore == 'MINKA' || (t.brand == 'VS' && nameStore == 'JOCKEY PLAZA') ? 'VSFA' : t.brand || '',
                'NAME': nameStore,
                'TYPE': nameStore == 'E-COMMERCE PERU' || nameStore == 'VSFA ECOMMERCE' ? 'ECOMMERCE' : nameStore == 'MINKA' ? 'OUTLET' : 'RETAIL',
                'DAILY SALES S/': ventaSoles,
                'DAILY SALES $': ventaDolares,
                'DAILY UNITS': unidades,
                'STOCK': stock
            });
        });

        // Series que respondieron pero no están en el catálogo ACTIVO
        Object.keys(respuestas).forEach(serie => {
            if (mapaTiendas[serie]) return;

            const respuesta = respuestas[serie];
            const total = (respuesta.data || []).find(
                r => r.NombreDepartamento === 'TOTAL GENERAL' || r.CodDepartamento == null
            );

            filas.push({
                _serie: serie,
                'ORDEN DE TIENDA': 0,
                'BRAND': '',
                'NAME': serie,
                'TYPE': '',
                'DAILY SALES S/': total?.VentaSoles != null ? Number(total.VentaSoles) : null,
                'DAILY SALES $': total?.VentaDolares != null ? Number(total.VentaDolares) : null,
                'DAILY UNITS': total?.CantidadVendida != null ? Number(total.CantidadVendida) : null,
                'STOCK': total?.Stock != null ? Number(total.Stock) : null
            });
        });

        // ===== ORDENAR SEGÚN LA LISTA DESEADA =====
        filas.sort((a, b) => {
            const posA = ordenMap.has(a._serie) ? ordenMap.get(a._serie) : 9999;
            const posB = ordenMap.has(b._serie) ? ordenMap.get(b._serie) : 9999;
            return posA - posB;
        });

        // Recalcular ORDEN DE TIENDA y limpiar propiedad interna
        filas.forEach((f, idx) => {
            f['ORDEN DE TIENDA'] = idx + 1;
            delete f._serie;
        });

        // Generar Excel
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(filas, {
            header: [
                'ORDEN DE TIENDA',
                'BRAND',
                'NAME',
                'TYPE',
                'DAILY SALES S/',
                'DAILY SALES $',
                'DAILY UNITS',
                'STOCK'
            ]
        });

        ws['!cols'] = [
            { wch: 16 },
            { wch: 8 },
            { wch: 24 },
            { wch: 12 },
            { wch: 16 },
            { wch: 16 },
            { wch: 14 },
            { wch: 12 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, 'Daily Report');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const base64 = Buffer.from(buffer).toString('base64');

        const nombreArchivo = `Informe_Rendimiento_${fechaDesde}_${fechaHasta}.xlsx`;
        const subject = `Informe de Rendimiento ${fechaDesde}${fechaDesde !== fechaHasta ? ' - ' + fechaHasta : ''}`;

        const respondieron = Object.keys(respuestas).length;
        const totalCatalogo = tiendasDb.length;

        await emailService.pushToEmailQueue({
            email: informeRendimientoEstado.emails,
            subject,
            template: 'informeRendimiento',
            variables: {
                fechaDesde,
                fechaHasta,
                tiendasRespondieron: respondieron,
                tiendasCatalogo: totalCatalogo
            },
            archivo: {
                filename: nombreArchivo,
                content: base64,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                encoding: 'base64'
            }
        });

        console.log(`📧 [Informe Rendimiento] Excel enviado (${respondieron}/${totalCatalogo} tiendas). Archivo: ${nombreArchivo}`);

        io.emit('informe_rendimiento_completado', {
            fechaDesde,
            fechaHasta,
            tiendasRespondieron: respondieron,
            tiendasCatalogo: totalCatalogo,
            archivo: nombreArchivo
        });

    } catch (error) {
        console.error('❌ [Informe Rendimiento] Error al generar/enviar Excel:', error);
    } finally {
        informeRendimientoEstado.tiendasData = {};
    }
}
