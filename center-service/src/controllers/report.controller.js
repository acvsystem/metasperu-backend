import { getIO, iniciarRecoleccionInformeRendimiento } from '../config/socket.js';

export const reportsController = {

    infRendimiento: async (req, res) => {
        const { socket_id, fecha_desde, fecha_hasta, enviar_email } = req.query;
        try {
            if(typeof fecha_desde!=='string'||typeof fecha_hasta!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(fecha_desde)||!/^\d{4}-\d{2}-\d{2}$/.test(fecha_hasta)||fecha_desde>fecha_hasta||Date.parse(fecha_hasta)-Date.parse(fecha_desde)>93*86400000)return res.status(422).json({message:'Seleccione un rango valido de hasta 93 dias.'});
            if((enviar_email==='1'||enviar_email==='true'||socket_id==='CRONREPORTE01')&&!req.user.allStores)return res.status(403).json({message:'Solo SISTEMAS puede enviar el consolidado de todas las tiendas.'});

            if(!req.user.allStores&&!req.user.stores.length)return res.status(403).json({message:'La cuenta no tiene tiendas asignadas.'});
            // Si se pide enviar email (cron o parámetro), activar recolección consolidada
            if (enviar_email === '1' || enviar_email === 'true' || socket_id === 'CRONREPORTE01') {
                iniciarRecoleccionInformeRendimiento(fecha_desde, fecha_hasta);
            }

            getIO().to(req.user.allStores?'grupo_tiendas':req.user.stores).emit('py_request_informe_rendimiento', {
                pedido_por: (enviar_email==='1'||enviar_email==='true')?'CRONREPORTE01':socket_id,
                fecha_desde,
                fecha_hasta
            });

            res.json({
                message: 'Se emitio señal de informe de rendimiento',
                recoleccion_email: enviar_email === '1' || enviar_email === 'true' || socket_id === 'CRONREPORTE01'
            });
        } catch (error) {
            res.status(error.status||500).json({ message: error.status===409?error.message:'No se pudo iniciar el informe.' });
        }
    }

}
