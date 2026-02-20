import { pool } from '../config/db.js';

export const configurationController = {

    postParametersStore: async (req, res) => {
        const { serie, mac } = req.body;

        try {
            const [parameters] = await pool.execute(`SELECT * FROM TB_PARAMETROS_TIENDA WHERE MAC='${mac}).toUpperCase()}';`);
            console.log(parameters);
            if (parameters.length) {
                const [sqlTraffics] = await pool.query(`SELECT IP FROM tb_traffic_counter_tienda WHERE CODIGO_TIENDA = '${serie}';`) || [];

                const traffics = sqlTraffics.map(t => {
                    return t.IP;
                });

                parameters[0]['TRAFFIC_COUNTERS'] = traffics;
            }

            res.json(parameters);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener tiendas', error });
        }
    }
}