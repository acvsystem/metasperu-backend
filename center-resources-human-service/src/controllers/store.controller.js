import { getIO } from '../config/socket.js';
import { emailService } from '../services/email.service.js';

const arDataAsistenciaEmpleados = [{
    ejb: []
}];

export const storeController = {

    callAsistenceEmployesStore: async (req, res) => {
        const { fecha, tipoConsulta } = req.body; // Asegúrate que Python envíe la marca

        if (!fecha || !tipoConsulta) {
            return res.status(400).json({ message: 'Fecha y Tipo de Consulta son requeridos' });
        }

        try {
            const propertyUnique = Math.random().toString(36).substring(2, 8).toUpperCase();

            getIO().to('servidor_backup').emit('py_asistencia_empleados', { fecha, tipoConsulta, propertyUnique });
            res.status(200).json({ property: propertyUnique, message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    callRegisterEmployesStore: async (req, res) => {
        try {

            getIO().to('servidor_ejb').emit('py_registro_empleados');
            res.status(200).json({ message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    postAsistenciaEmployesStore: async (req, res) => {
        const { propertyUnique, data } = req.body;

        if (!data) {
            return res.status(400).json({ message: 'Data es requerido' });
        }

        try {
            arDataAsistenciaEmpleados[0][`${propertyUnique}`] = data;
            console.log('postAsistenciaEmployesStore', arDataAsistenciaEmpleados);
            getIO().emit('dashboard_refresh_empleados');
            res.status(200).json({ message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }

    },
    postEjbRegisterEmployes: async (req, res) => {
        const { data } = req.body;

        if (!data) {
            return res.status(400).json({ message: 'Data es requerido' });
        }

        try {

            arDataAsistenciaEmpleados[0].ejb = data;
            getIO().emit('dashboard_refresh_empleados');
            res.status(200).json({ message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    getRefresAsistenciaEmpleados: async (req, res) => {
        const { property } = req.params;

        try {
            // 1. Validación de seguridad (Early Return)
            const currentData = arDataAsistenciaEmpleados[0];
            if (!currentData) {
                return res.status(200).json({ asistencia: [] });
            }

            // 2. Construcción de respuesta eficiente
            // Solo incluimos la propiedad solicitada y 'ejb' si existen
            const keysToInclude = [property, 'ejb'];
            const response = keysToInclude
                .filter(key => currentData.hasOwnProperty(key))
                .map(key => ({
                    property: key,
                    data: currentData[key]
                }));

            // 3. Responder al cliente
            res.status(200).json({ asistencia: response });

            // 4. Limpieza de memoria (Side Effect)
            // Solo borramos si la propiedad no es la base 'ejb' (opcional, según tu lógica)
            if (property !== 'ejb') {
                delete currentData[property];
            }

        } catch (error) {
            console.error('Error en Refresh Asistencia:', error);
            res.status(500).json({ message: 'Error interno del servidor' });
        }
    }
};
