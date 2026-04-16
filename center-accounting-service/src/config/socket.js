import { Server } from 'socket.io';
import { extraServices } from '../services/extra.services.js';
import { pool } from './db.js';
import { emailService } from '../services/email.service.js';

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

        socket.on('py_response_cuo', (data) => {
            const dataCuo = JSON.parse(data.cuo);
            const socketId = data.pedido_por;

            io.to(socketId).emit('dashboard_cuo_store', dataCuo);
        });

        socket.on('py_response_insert_cuo', (data) => {
            const message = data.message;
            const socketId = data.pedido_por;

            io.to(socketId).emit('dashboard_cuo_insert', { message: message });
        });

        socket.on('py_response_exchange_rate', async (data) => {
            try {
                // 1. Validación de seguridad
                if (!data.exchangeRate) return;

                const dataExchangeRate = JSON.parse(data.exchangeRate);
                const socketId = data.pedido_por;
                console.log(socketId);
                // Si no hay datos en el array, no procesar
                if (!dataExchangeRate || dataExchangeRate.length === 0) return;

                const { cFecha: fechaHoy, cCotiActual: cotizacionRetail } = dataExchangeRate[0];

                // Caso: Respuesta para el proceso automático del Cron
                if (socketId === 'cron_accounting') {

                    // --- PASO 1: BUSCAR EN DB LOCAL ---
                    const [localRows] = await pool.execute(
                        'SELECT venta FROM tb_tipo_cambio_cache WHERE fecha = ?',
                        [fechaHoy]
                    );

                    if (localRows.length > 0) {
                        const ventaSunat = parseFloat(localRows[0].venta);
                        const ventaRetail = parseFloat(cotizacionRetail);

                        // Comparación robusta
                        if (ventaRetail === ventaSunat) {
                            await extraServices.enviarSlack(
                                `✅ *Sincronización Correcta*\n` +
                                `*Fecha:* ${fechaHoy}\n` +
                                `*FrontRetail:* S/ ${ventaRetail.toFixed(3)}\n` +
                                `*Sunat:* S/ ${ventaSunat.toFixed(3)}\n` +
                                `_Los valores coinciden perfectamente._`,
                                "Comparación de Tipo de Cambio"
                            );
                        } else {
                            await extraServices.enviarSlack(
                                `🚨 *ALERTA: Diferencia detectada*\n` +
                                `*Fecha:* ${fechaHoy}\n` +
                                `*FrontRetail:* S/ ${ventaRetail.toFixed(3)}\n` +
                                `*Sunat:* S/ ${ventaSunat.toFixed(3)}\n` +
                                `*Diferencia:* S/ ${(ventaRetail - ventaSunat).toFixed(3)}`,
                                "Comparación de Tipo de Cambio"
                            );

                            const results = emailService.pushToEmailQueue({
                                email: ['itperu@metasperu.com', 'johnnygermano@metasperu.com'],
                                subject: `Diferencia Tipo Cambio FRONT RETAIL`,
                                template: 'alertaDiffTipoChambio',
                                variables: {
                                    tcSistema: `${ventaRetail.toFixed(3)}`,
                                    tcSunat: `${ventaSunat.toFixed(3)}`,
                                    fecha: fechaHoy
                                }
                            });
                        }
                    } else {
                        console.log(`⚠️ No se encontró registro SUNAT en DB para la fecha ${fechaHoy}`);
                    }

                } else {
                    // Caso: Respuesta para un usuario en el Dashboard
                    io.to(socketId).emit('dashboard_exchange_rate_store', dataExchangeRate);
                }

            } catch (error) {
                console.error('❌ Error en py_response_exchange_rate:', error.message);
                // Opcional: Avisar a Slack que el procesamiento falló
            }
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
