import { pool } from '../config/db.js';

export const configurationController = {
    postParametersStore: async (req, res) => {
        const { serie, mac } = req.body;

        // Validación básica de entrada
        if (!mac || !serie) {
            return res.status(400).json({ message: 'MAC y Serie son requeridos' });
        }

        try {
            // 1. Uso de Prepared Statements (?) para evitar Inyección SQL
            // 2. Solo traemos los campos necesarios en lugar de SELECT *
            const [parameters] = await pool.execute(
                'SELECT * FROM TB_PARAMETROS_TIENDA WHERE MAC = ?',
                [mac.toUpperCase()]
            );

            if (parameters.length > 0) {
                // Buscamos los contadores de tráfico asociados a la serie
                const [sqlTraffics] = await pool.query(
                    'SELECT IP FROM tb_traffic_counter_tienda WHERE CODIGO_TIENDA = ?',
                    [serie]
                );

                // Simplificamos el mapeo de IPs
                const traffics = sqlTraffics.map(t => t.IP);

                // Asignamos los contadores al primer objeto encontrado
                parameters[0].TRAFFIC_COUNTERS = traffics;

                return res.json(parameters);
            }

            // Si no hay parámetros, enviamos un array vacío o 404 según prefieras
            res.json([]);

        } catch (error) {
            console.error('Error en postParametersStore:', error); // Log para debug
            res.status(500).json({
                message: 'Error interno del servidor',
                error: process.env.NODE_ENV === 'development' ? error : {}
            });
        }
    }
}