import { pool } from '../config/db.js';
import { getIO, tiendasOnline, servidorOnline } from '../config/socket.js';

export const storeController = {

    getTiendas: async (req, res) => {
        try {
            const [rows] = await pool.execute('SELECT * FROM bd_metasperu.tb_lista_tienda where ESTATUS = "ACTIVO" order by DESCRIPCION ASC;');

            const tiendasMapeadas = rows.map(t => {
                return {
                    id: t.ID_TIENDA,
                    serie: t.SERIE_TIENDA,
                    nombre: t.DESCRIPCION,
                    codigo_almacen: t.COD_ALMACEN,
                    unidad_servicio: t.UNID_SERVICIO,
                    marca: t.TIPO_TIENDA,
                    email: t.EMAIL,
                    codigo_ejb: t.COD_TIENDA_EJB,
                    estado: t.ESTATUS,
                    online: false,
                    traffic: 0,
                    comprobantes: 0,
                    transacciones: 0,
                    clientes: 0
                };
            });

            res.json(tiendasMapeadas);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener tiendas', error });
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

    // 2. Aquí recibe la lista de IDs del Servidor General (Agente Python/Node en la otra locación)
    callDocumentsComparation: async (req, res) => {
        const { socketId } = req.params;
        try {
            let onlineStore = [tiendasOnline];
            onlineStore.filter((store, i) => {
                let serie = Object.keys(store)[i];
                console.log("callDocumentsComparation serie:", serie);
                getIO().to(store[serie].socketId).emit('py_requets_documents_store', { pedido_por: socketId });
            });

            const servidor = servidorOnline;
            console.log("callDocumentsComparation servidor:", servidor);
            getIO().to(servidor.socketId).emit('py_request_documents_server');

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

            let onlineStore = [tiendasOnline];
            console.log("callTransactions", onlineStore);
            onlineStore.filter((store, i) => {
                let serie = Object.keys(store)[i];
                getIO().to(store[serie].socketId).emit('py_requets_transactions_store', { pedido_por: socketId });
            });

            res.json({
                message: 'Se emitio señal de documentos'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    }
}
