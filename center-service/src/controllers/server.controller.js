import { pool } from '../config/db.js';
import { getIO, tiendasOnline, servidorOnline } from '../config/socket.js';

export const serverController = {

    callComparationDocumentsServer: async (req, res) => {
        const { socketId } = req.params;
        try {
            const servidor = servidorOnline;
            console.log("callComparationDocumentsServer servidor:", servidor);
            getIO().to(servidor.socketId).emit('py_request_comparation_documents_server', { pedido_por: socketId });

            res.json({
                message: 'Se emitio señal de comprobacion.'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    callDocumentsPendingServer: async (req, res) => {
        const { socketId } = req.params;
        try {
            const servidor = servidorOnline;
            console.log("callDocumentsPendingServer servidor:", servidor);
            getIO().to(servidor.socketId).emit('py_request_documents_pending_server', { pedido_por: socketId });

            res.json({
                message: 'Se emitio señal de comprobacion.'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    }
}
