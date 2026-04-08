import { getIO } from '../config/socket.js';

const inventariosPorMarca = new Map();

export const storeController = {

    getKardexStore: async (req, res) => {
        const { serieStore, socketId, init, end } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_kardex_store', { pedido_por: socketId, init: init, end: end });

            res.json({
                message: 'Se emitio señal de kardex'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    postKardexCamposLibres: async (req, res) => {
        const { serieStore, socketId, body } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_kardex_campos_libres', { pedido_por: socketId, body: body });

            res.json({
                message: 'Se emitio señal de kardex campos libres'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    getCuoStore: async (req, res) => {
        const { serieStore, socketId, init, end } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_cuo', { pedido_por: socketId, init: init, end: end });

            res.json({
                message: 'Se emitio señal de CUO'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    postCuoInsert: async (req, res) => {
        const { serieStore, socketId, data } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_insert_cuo', { pedido_por: socketId, data: data });

            res.json({
                message: 'Se emitio señal de CUO'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    }
};
