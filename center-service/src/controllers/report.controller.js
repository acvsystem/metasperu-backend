import { getIO, iniciarRecoleccionInformeRendimiento } from '../config/socket.js';

export const reportsController = {

    infRendimiento: async (req, res) => {
        const { socket_id, fecha_desde, fecha_hasta, enviar_email } = req.query;
        try {
            console.log('Emitir señal de informe de rendimiento', req.query);

            // Si se pide enviar email (cron o parámetro), activar recolección consolidada
            if (enviar_email === '1' || enviar_email === 'true' || socket_id === 'CRONREPORTE01') {
                iniciarRecoleccionInformeRendimiento(fecha_desde, fecha_hasta);
            }

            getIO().to('grupo_tiendas').emit('py_request_informe_rendimiento', {
                pedido_por: socket_id,
                fecha_desde,
                fecha_hasta
            });

            res.json({
                message: 'Se emitio señal de informe de rendimiento',
                recoleccion_email: enviar_email === '1' || enviar_email === 'true' || socket_id === 'CRONREPORTE01'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    }

}
