import { pool } from '../config/db.js';
import { getIO, servidorOnline } from '../config/socket.js';
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

            getIO().to('grupo_tiendas').emit('py_delete_cola_panama', { pedido_por: socketId });

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