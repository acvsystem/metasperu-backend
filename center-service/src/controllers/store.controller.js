import { pool } from '../config/db.js';
import { getIO, reiniciarAuditoriaDocumentos, servidorOnline } from '../config/socket.js';
import { emailService } from '../services/email.service.js';
export const storeController = {

    getTiendas: async (req, res) => {
        try {
            const query = `
            SELECT 
                t.*, 
                (
                    SELECT JSON_ARRAYAGG(
                        JSON_OBJECT('ip', IP, 'active', true)
                    )
                    FROM tb_traffic_counter_tienda
                    WHERE CODIGO_TIENDA = t.SERIE_TIENDA
                ) as traffic_json,
                (
                    SELECT JSON_ARRAYAGG(
                        JSON_OBJECT('id', ID, 'serie', SERIE, 'nombre', NOMBRE, 'cantidad', 0)
                    )
                    FROM tb_terminales_store
                    WHERE SERIE = t.SERIE_TIENDA
                ) as terminales_json
            FROM bd_metasperu.tb_lista_tienda t
            WHERE t.ESTATUS = "ACTIVO"
            ORDER BY t.DESCRIPCION ASC;
        `;

            const [rows] = await pool.execute(query);

            const tiendasMapeadas = rows.map(t => {
                // Función auxiliar para parsear JSON de forma segura
                const parseJsonField = (field) => {
                    if (!field) return [];
                    return typeof field === 'string' ? JSON.parse(field) : field;
                };

                return {
                    id: t.ID_TIENDA,
                    serie: t.SERIE_TIENDA,
                    nombre: t.DESCRIPCION,
                    codigo_almacen: t.COD_ALMACEN,
                    unidad_servicio: t.UNID_SERVICIO,
                    marca: t.UNID_SERVICIO,
                    email: t.EMAIL,
                    codigo_ejb: t.COD_TIENDA_EJB,
                    estado: t.ESTATUS,
                    tipo_tienda: t.TIPO_TIENDA,
                    online: false,
                    traffic: parseJsonField(t.traffic_json),
                    terminales: parseJsonField(t.terminales_json), // Nueva lista de terminales
                    comprobantes: 0,
                    transacciones: 0,
                    clientes: 0,
                    clientesLoading: false,
                    transaccionesLoading: false,
                    comprobantesLoading: false
                };
            });

            res.json(tiendasMapeadas);
        } catch (error) {
            console.error("Error en getTiendas:", error);
            res.status(500).json({
                message: 'Error al obtener tiendas',
                error: error.message
            });
        }
    },

    createTienda: async (req, res) => {
        const { serie, nombre, codigo_almacen, unidad_servicio, marca, email, codigo_ejb } = req.body;
        try {
            const [result] = await pool.execute(
                'INSERT INTO tb_lista_tienda (SERIE_TIENDA,DESCRIPCION,COD_ALMACEN,UNID_SERVICIO,TIPO_TIENDA,EMAIL,COD_TIENDA_EJB) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [serie, nombre, codigo_almacen, unidad_servicio, marca, email, codigo_ejb]
            );

            const [rows] = await pool.execute('SELECT * FROM tb_lista_tienda');

            res.status(201).json({ data: rows, message: 'Tienda creada' });
        } catch (error) {
            res.status(500).json({ message: 'Error al crear tienda', error });
        }
    },

    updateTienda: async (req, res) => {
        const { id, serie, nombre, codigo_almacen, unidad_servicio, marca, email, codigo_ejb, estado } = req.body;

        try {
            await pool.execute(
                'UPDATE tb_lista_tienda SET SERIE_TIENDA = ?,DESCRIPCION = ?,COD_ALMACEN = ?,UNID_SERVICIO = ?,TIPO_TIENDA = ?,EMAIL = ?,COD_TIENDA_EJB = ?,ESTATUS = ? WHERE ID_TIENDA = ?',
                [serie, nombre, codigo_almacen, unidad_servicio, marca, email, codigo_ejb, estado, id]
            );

            res.json({ message: 'Tienda actualizada correctamente' });
        } catch (error) {
            res.status(500).json({ message: 'Error al actualizar', error });
        }
    },

    deleteTienda: async (req, res) => {
        const { id } = req.params;
        try {
            // Podrías hacer un borrado físico o lógico (cambiar estado a DESHABILITADO)
            await pool.execute('DELETE FROM tb_lista_tienda WHERE ID_TIENDA = ?', [id]);
            res.json({ message: 'Tienda eliminada' });
        } catch (error) {
            res.status(500).json({ message: 'Error al eliminar', error });
        }
    },

    getDashboarRefresh: async (req, res) => {
        try {
            enviarActualizacionDashboard();
            res.json({ message: 'Señal enviada' });
        } catch (error) {
            res.status(500).json({ message: 'Error al enviar', error });
        }

    },
    // 2. Aquí recibe la lista de IDs del Servidor General (Agente Python/Node en la otra locación)
    callDocumentsComparation: async (req, res) => {

        const { socketId } = req.params;

        try {
            reiniciarAuditoriaDocumentos();
            getIO().to('servidor_backup').emit('py_request_documents_server');
            getIO().to('grupo_tiendas').emit('py_request_documents_store', { pedido_por: socketId });


            res.json({
                message: 'Se emitio señal de documentos'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },

    callTransactions: async (req, res) => {
        const { socketId } = req.params;
        try {

            getIO().to('grupo_tiendas').emit('py_request_transactions_store', { pedido_por: socketId });

            res.json({
                message: 'Se emitio señal de transacciones'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },

    callClientBlank: async (req, res) => {
        const { socketId } = req.params;
        try {

            let [data] = await pool.query(`SELECT * FROM TB_CLIENTES_CLEAR_FORNT;`);
            let listCliente = ((data || [])[0]['LIST_CLIENTE']).split(',');

            getIO().to('grupo_tiendas').emit('py_request_client_blank', { pedido_por: socketId, extra_client: listCliente });

            res.json({
                message: 'Se emitio señal de clientes en blanco'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },

    callClientDelete: async (req, res) => {
        const { socketId } = req.params;
        try {
            let [data] = await pool.query(`SELECT * FROM TB_CLIENTES_CLEAR_FORNT;`);
            let extra_client = ((data || [])[0]['LIST_CLIENTE']).split(',');

            if ((extra_client || []).length) {
                getIO().to('grupo_tiendas').emit('py_delete_client', { pedido_por: socketId, extra_client: extra_client });
                getIO().to('servidor_backup').emit('py_delete_client', { pedido_por: socketId, extra_client: extra_client });
            }

            res.json({
                message: 'Se emitio señal de eliminacion de cliente.'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },

    callTransferTerminal: async (req, res) => {
        const { socketId, serie, terminalIn, terminalOut } = req.body;
        try {

            getIO().to(serie).emit('py_transfer_terminal', { pedido_por: socketId, serie: serie, terminalIn: terminalIn, terminalOut: terminalOut });

            res.json({
                message: 'Se emitio señal de transferencia de cola.'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },

    callDeletePanamaCola: async (req, res) => {
        const { socketId } = req.params;
        try {

            getIO().to('grupo_tiendas').emit('py_delete_cola_panama');

            res.json({
                message: 'Se emitio señal de eliminar cola panama.'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    callTrafficVerification: async (req, res) => {
        const { socketId } = req.params;
        try {

            getIO().to('grupo_tiendas').emit('py_traffic_counter_verification', { pedido_por: socketId });

            res.json({
                message: 'Se emitio señal verificacion traffic counter.'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    callUrlTemporalComprabantes: async (req, res) => {
        try {
            const { token } = req.params;

            // 1. Buscamos el token y verificamos que no haya expirado
            const [rows] = await pool.execute(
                'SELECT documentos FROM enlaces_temporales WHERE token = ? AND expiracion > NOW()',
                [token]
            );

            if (rows.length === 0) {
                return res.status(404).json({ error: "Token no válido o expirado" });
            }

            // 2. Parseamos el JSON que guardaste como string en la BD
            const documentos = rows[0].documentos;

            // 3. ENVIAMOS SOLO JSON (Aquí está la clave)
            // Usamos res.json() en lugar de res.render() o res.sendFile()
            return res.status(200).json(documentos);

        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: "Error interno del servidor" });
        }
    },
    callNotificationSunat: async (req, res) => {
        const ar_documentos = (req || []).body || [];

        try {
            // 1. Consultar la tabla de tiendas
            const [tiendas] = await pool.execute('SELECT * FROM tb_lista_tienda');

            // Creamos un mapa para buscar rápido la tienda por su serie
            const mapTiendas = new Map();
            tiendas.forEach(tienda => {
                mapTiendas.set(tienda.SERIE_TIENDA, {
                    CODIGO_SERIE: tienda.SERIE_TIENDA,
                    DESCRIPCION: tienda.DESCRIPCION,
                    EMAIL: tienda.EMAIL
                });
            });

            // 2. Procesar y agrupar los registros originales
            const documentosAgrupados = {};

            for (const r of ar_documentos) {
                // Extraemos el 2do y 3er carácter del nro_correlativo (Ej: 'F7I1-...' -> '7I')
                const nroCorrelativo = String(r.nro_correlativo || '');
                const codigoGrupo = nroCorrelativo.substring(1, 3);

                // Buscamos si existe información para este código en el mapa de tiendas
                const infoTienda = mapTiendas.get(codigoGrupo) || {
                    CODIGO_SERIE: codigoGrupo,
                    DESCRIPCION: 'NO ENCONTRADO',
                    EMAIL: 'SIN EMAIL'
                };

                // Construimos el objeto con los datos solicitados
                const item = {
                    'codigo_documento': r.codigo_documento,
                    'nro_correlativo': r.nro_correlativo,
                    'nombre_adquiriente': r.nombre_adquiriente,
                    'nro_documento': r.nro_documento,
                    'observacion': r.observacion,
                    'fecha_emision': r.fecha_emision ? String(r.fecha_emision) : '',
                    'estado_sunat': r.estado_sunat,
                    'estado_comprobante': r.estado_comprobante,
                    'codigo_error_sunat': r.codigo_error_sunat,
                    // Campos agregados desde tb_lista_tienda
                    'CODIGO_SERIE': infoTienda.CODIGO_SERIE,
                    'DESCRIPCION': infoTienda.DESCRIPCION,
                    'EMAIL': infoTienda.EMAIL
                };

                // Agrupamos por el código extraído
                if (!documentosAgrupados[codigoGrupo]) {
                    documentosAgrupados[codigoGrupo] = [];
                }
                documentosAgrupados[codigoGrupo].push(item);
            }

            // 3. Enviar un correo separado por cada tienda/grupo utilizando un bucle
            for (const [codigoGrupo, documentosTienda] of Object.entries(documentosAgrupados)) {
                const tiendaInfo = documentosTienda[0]; // Obtenemos los datos de la tienda del primer documento del grupo

                // Filtramos los emails para evitar enviar a "SIN EMAIL"
                const correosDestino = [tiendaInfo.EMAIL, 'itperu@metasperu.com'].filter(email => email && email !== 'SIN EMAIL');

                await emailService.pushToEmailQueue({
                    email: correosDestino,
                    subject: `Documentos observados SUNAT - ${tiendaInfo.DESCRIPCION}`,
                    template: 'alertaDocumentosSunar',
                    variables: {
                        tienda: tiendaInfo.DESCRIPCION, // Variable {{tienda}} para la plantilla
                        documentos: documentosTienda   // Lista de documentos específicos de esta tienda
                    }
                });
            }

            res.send('RECEPCION EXITOSA..!!');

        } catch (error) {
            console.error('Error al procesar los datos:', error);
            throw error;
        }
    }
}


async function enviarActualizacionDashboard() {
    // Obtenemos todos los sockets que están en la sala 'grupo_tiendas'
    const sockets = await getIO().in('grupo_tiendas').fetchSockets();

    const listaTiendas = sockets.map(s => ({
        socketId: s.id,
        id_tienda: s.data.id_tienda,
        nombre: s.data.nombre,
        serie: s.data.serie,
        lastSeen: s.data.lastSeen,
        online: true // Si está en la lista, es porque está online
    }));

    console.log(listaTiendas);
    getIO().emit('actualizar_dashboard', listaTiendas);
}
