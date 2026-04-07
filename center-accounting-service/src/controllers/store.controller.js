import { getIO } from '../config/socket.js';

const inventariosPorMarca = new Map();

export const storeController = {

    getKardexStore: async (req, res) => {
        const { serieStore, socketId } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_kardex_store', { pedido_por: socketId });

            res.json({
                message: 'Se emitio señal de kardex'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    }
};
