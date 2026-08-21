import { getIO } from '../config/socket.js';

export const reportsController = {

    infRendimiento: async (req, res) => {
        const { socket_id, fecha_desde, fecha_hasta } = req.query;
        try {
            console.log('Emitir señal de informe de rendimiento', req.query);
            getIO().to('grupo_tiendas').emit('py_request_informe_rendimiento', { pedido_por: socket_id, fecha_desde: fecha_desde, fecha_hasta: fecha_hasta });

            res.json({
                message: 'Se emitio señal de informe de rendimiento',
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    }

}