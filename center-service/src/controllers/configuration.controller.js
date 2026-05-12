import { pool } from '../config/db.js';
import bcrypt from 'bcrypt';

export const configurationController = {
    postParametersStore: async (req, res) => {
        const { mac } = req.body;

        // Validación básica de entrada
        if (!mac) {
            return res.status(400).json({ message: 'MAC son requeridos' });
        }

        try {
            // 1. Uso de Prepared Statements (?) para evitar Inyección SQL
            // 2. Solo traemos los campos necesarios en lugar de SELECT *
            const [parameters] = await pool.execute(
                `SELECT lt.SERIE_TIENDA,lt.DESCRIPCION,lt.ESTATUS,lt.UNID_SERVICIO,pt.MAC,pt.DATABASE_INSTANCE,pt.DATABASE_NAME,pt.COD_TIPO_FAC,pt.COD_TIPO_BOL,
                pt.PROPERTY_STOCK,pt.NAME_EXCEL_REPORT_STOCK,pt.ASUNTO_EMAIL_REPORT_STOCK FROM tb_lista_tienda lt 
                INNER JOIN tb_parametros_tienda pt on lt.SERIE_TIENDA = pt.SERIE_TIENDA
                WHERE pt.MAC = ?`,
                [mac.toUpperCase()]
            );

            if (parameters.length > 0) {
                // Buscamos los contadores de tráfico asociados a la serie
                const [sqlTraffics] = await pool.query(
                    'SELECT IP FROM tb_traffic_counter_tienda WHERE CODIGO_TIENDA = ?',
                    [parameters[0]['SERIE_TIENDA']]
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
    },
    permissionsStore: async (req, res) => {
        const permissions = req.body; // Array de tiendas desde Angular

        try {
            for (let tienda of permissions) {
                const query = `
        INSERT INTO tb_configuracion_horario_pap 
          (ID_TIENDA_HP, IS_FREE_HORARIO, IS_FREE_PAPELETA, IS_ALERT_TRAFFIC_COUNTER)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          IS_FREE_HORARIO = VALUES(IS_FREE_HORARIO),
          IS_FREE_PAPELETA = VALUES(IS_FREE_PAPELETA),
          IS_ALERT_TRAFFIC_COUNTER = VALUES(IS_ALERT_TRAFFIC_COUNTER)
      `;
                await pool.execute(query, [
                    tienda.id,
                    tienda.horarioPermiso ? 1 : 0,
                    tienda.papeletaPermiso ? 1 : 0,
                    tienda.avisosTraffic ? 1 : 0
                ]);
            }
            res.json({ message: 'Configuración guardada exitosamente' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    gerPermissions: async (req, res) => {
        try {
            const query = `
      SELECT 
        t.ID_TIENDA as id, 
        t.DESCRIPCION as nombre,
        COALESCE(c.IS_FREE_HORARIO, 0) as horarioPermiso,
        COALESCE(c.IS_FREE_PAPELETA, 0) as papeletaPermiso,
        COALESCE(c.IS_ALERT_TRAFFIC_COUNTER, 0) as avisosTraffic
      FROM tb_lista_tienda t
      LEFT JOIN tb_configuracion_horario_pap c ON t.ID_TIENDA = c.ID_TIENDA_HP
      ORDER BY t.DESCRIPCION ASC
    `;
            const [rows] = await pool.execute(query);
            res.json(rows);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    gerPermissionsMenu: async (req, res) => {
        const { nivel } = req.params;
        console.log(nivel);
        try {
            const query = `
      SELECT ID_MENU_PS as id
      FROM tb_permiso_sistema 
      WHERE NIVEL = ?`;

            const [rows] = await pool.execute(query, [nivel]);

            // Devolvemos solo los IDs para facilitar la comparación en Angular
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al obtener permisos' });
        }
    },
    getMenu: async (req, res) => {
        try {
            const query = `
      SELECT ID_MENU as id,NOMBRE_MENU as menu,RUTA as ruta 
      FROM tb_menu_sistema;`;

            const [rows] = await pool.execute(query);

            // Devolvemos solo los IDs para facilitar la comparación en Angular
            res.json(rows);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Error al obtener permisos' });
        }
    },
    getUsuarios: async (req, res) => {
        try {
            // Excluimos las contraseñas por seguridad
            const [rows] = await pool.execute('SELECT ID_LOGIN, USUARIO, EMAIL, NIVEL, DEFAULT_PAGE, CODE_STORE FROM tb_login');
            res.json(rows);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    getUsuariosCreate: async (req, res) => {
        const { USUARIO, PASSWORD, EMAIL, NIVEL, DEFAULT_PAGE, CODE_STORE } = req.body;

        try {
            // Encriptar password para PASSWORD_NW
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(PASSWORD, salt);

            const query = `
        INSERT INTO tb_login (USUARIO, EMAIL, NIVEL, DEFAULT_PAGE, CODE_STORE, PASSWORD_NW) 
        VALUES (?, ?, ?, ?, ?, ?)`;

            const [result] = await pool.execute(query, [USUARIO, EMAIL, NIVEL, DEFAULT_PAGE, CODE_STORE, hashedPassword]);

            res.status(201).json({ id: result.insertId, message: 'Usuario creado con éxito' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    getUsuarioUpdate: async (req, res) => {
        const { ID, USUARIO, EMAIL, NIVEL, DEFAULT_PAGE, CODE_STORE, PASSWORD } = req.body;

        try {
            let query = `UPDATE tb_login SET USUARIO=?, EMAIL=?, NIVEL=?, DEFAULT_PAGE=?, CODE_STORE=?`;
            let params = [USUARIO, EMAIL, NIVEL, DEFAULT_PAGE, CODE_STORE];

            // Si el usuario envió una nueva contraseña, la re-encriptamos
            if (PASSWORD) {
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(PASSWORD, salt);
                query += `, PASSWORD_NW=?`;
                params.push(hashedPassword);
            }

            query += ` WHERE ID_LOGIN=?`;
            params.push(ID);

            await pool.execute(query, params);
            res.json({ message: 'Usuario actualizado' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    delUsuariosDelete: async (req, res) => {
        const { id } = req.body;
        try {
            await pool.execute('DELETE FROM tb_login WHERE ID_LOGIN = ?', [id]);
            res.json({ message: 'Usuario eliminado correctamente' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}
