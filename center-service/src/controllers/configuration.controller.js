import { createPermissionController } from '../../../shared/center-permissions.mjs';
import { reportCenterError } from '../../../shared/center-diagnostics.mjs';
import { pool } from '../config/db.js';
import bcrypt from 'bcrypt';
import { createUserController } from '../../../shared/center-users.mjs';
const users=createUserController({pool,hash:password=>bcrypt.hash(password,12)});

const permissions=createPermissionController(pool);
export const configurationController = {
    postParametersStore: async (req, res) => {
        const { mac } = req.body;
        if (req.agent.kind !== 'store') return res.status(403).json({message:'Dispositivo no autorizado.'});

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
                WHERE pt.MAC = ? AND lt.SERIE_TIENDA = ?`,
                [mac.toUpperCase(), req.agent.store]
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
            reportCenterError('center-service.configuration.controller.47',error); // Log para debug
            res.status(500).json({
                message: 'Error interno del servidor',
                error: process.env.NODE_ENV === 'development' ? error : {}
            });
        }
    },
    permissionsStore: permissions.storeSettings,
    gerPermissions: async (req, res) => {
        try {
            const query = `
      SELECT 
        t.ID_TIENDA as id, 
        t.SERIE_TIENDA as serie,
        t.DESCRIPCION as nombre,
        COALESCE(c.IS_FREE_HORARIO, 0) as horarioPermiso,
        COALESCE(c.IS_FREE_PAPELETA, 0) as papeletaPermiso,
        COALESCE(c.IS_ALERT_TRAFFIC_COUNTER, 0) as avisosTraffic
      FROM tb_lista_tienda t
      LEFT JOIN tb_configuracion_horario_pap c ON t.ID_TIENDA = c.ID_TIENDA_HP
      ORDER BY t.DESCRIPCION ASC
    `;
            const [rows] = await pool.execute(query);
            res.json(rows.filter(row => req.user.allStores || req.user.stores.includes(row.serie)));
        } catch (err) {
            res.status(500).json({ message: 'No se pudieron consultar los permisos.' });
        }
    },
    gerPermissionsMenu: async (req, res) => {
        const { nivel } = req.params;
        console.log("center-service: evento procesado (configuration.controller.js:102)");
        try {
            const query = `
      SELECT ID_MENU_PS as id
      FROM tb_permiso_sistema 
      WHERE NIVEL = ?`;

            const [rows] = await pool.execute(query, [nivel]);

            // Devolvemos solo los IDs para facilitar la comparación en Angular
            res.json(rows);
        } catch (err) {
            reportCenterError('center-service.configuration.controller.114',err);
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
            reportCenterError('center-service.configuration.controller.129',err);
            res.status(500).json({ error: 'Error al obtener permisos' });
        }
    },
    getUsuarios: users.list,
    getUsuariosCreate: users.create,
    getUsuarioUpdate: users.update,
    delUsuariosDelete: users.remove,
    gerPermissionsUserStore: async (req, res) => {
        const { id } = req.body;
        try {
            const [rows] = await pool.execute('SELECT * FROM tb_usuario_tiendas_asignadas WHERE ID_USUARIO_TASG = ?', [id]);
            res.json(rows);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    postAsigPermissionsUserStore: permissions.assignStores,
    getAsingMenuUser: permissions.assignMenu,
    obtenerParametrosStore: async (req, res) => {
        const { id } = req.params;

        try {
            if (id) {
                // Caso: Obtener una tienda específica por ID
                const query = `SELECT * FROM tb_parametros_tienda WHERE ID_PARAMETROS = ?`;
                const [rows] = await pool.query(query, [id]);

                if (rows.length === 0) {
                    return res.status(404).json({ message: 'Parámetros no encontrados' });
                }

                return res.json(rows[0]);
            } else {
                // Caso: Listar todas las tiendas para la tabla general
                const query = `SELECT * FROM tb_parametros_tienda WHERE IS_PRINCIPAL_SERVER = 1 ORDER BY ID_PARAMETROS DESC`;
                const [rows] = await pool.query(query);

                return res.json(rows);
            }
        } catch (error) {
            reportCenterError('center-service.configuration.controller.295',error);
            res.status(500).json({
                message: 'Error al obtener los datos de la base de datos',
                error: error.message
            });
        }
    },

    // 1. INSERTAR (CREATE)
    crearParametrosTienda: async (req, res) => {
        const data = req.body;
        try {
            const query = `INSERT INTO tb_parametros_tienda SET ?`;
            const [result] = await pool.query(query, [data]);

            res.status(201).json({
                message: 'Configuración de tienda registrada',
                id: result.insertId
            });
        } catch (error) {
            reportCenterError('center-service.configuration.controller.315',error);
            res.status(500).json({ message: 'Error al registrar parámetros', error: error.message });
        }
    },

    // 2. ACTUALIZAR (UPDATE)
    actualizarParametrosTienda: async (req, res) => {
        const { id } = req.params;
        const data = req.body;
        try {
            const query = `UPDATE tb_parametros_tienda SET ? WHERE ID_PARAMETROS = ?`;
            const [result] = await pool.query(query, [data, id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Configuración no encontrada' });
            }

            res.json({ message: 'Configuración actualizada correctamente' });
        } catch (error) {
            reportCenterError('center-service.configuration.controller.334',error);
            res.status(500).json({ message: 'Error al actualizar parámetros' });
        }
    },

    // 3. ELIMINAR (DELETE)
    eliminarParametrosTienda: async (req, res) => {
        const { id } = req.params;
        try {
            const query = `DELETE FROM tb_parametros_tienda WHERE ID_PARAMETROS = ?`;
            const [result] = await pool.query(query, [id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'El registro no existe' });
            }

            res.json({ message: 'Configuración eliminada exitosamente' });
        } catch (error) {
            reportCenterError('center-service.configuration.controller.352',error);
            res.status(500).json({ message: 'Error al eliminar parámetros' });
        }
    },
    obtenerClientesBlanco: async (req, res) => {
        try {
            // Obtenemos el registro (asumiendo que es una configuración única)
            const query = 'SELECT LIST_CLIENTE FROM tb_clientes_clear_fornt LIMIT 1';
            const [rows] = await pool.query(query);

            if (rows.length === 0) {
                return res.json({ LIST_CLIENTE: '' });
            }

            // Enviamos el string directamente
            res.json(rows[0]);
        } catch (error) {
            reportCenterError('center-service.configuration.controller.369',error);
            res.status(500).json({
                message: 'Error al obtener la configuración',
                error: error.message
            });
        }
    },
    actualizarClientesClear: async (req, res) => {
        const { LIST_CLIENTE } = req.body;

        if (LIST_CLIENTE === undefined) {
            return res.status(400).json({ message: 'El campo LIST_CLIENTE es requerido' });
        }

        try {
            // Intentamos actualizar el registro con ID 1 (asumiendo que es el registro maestro)
            // Si prefieres que siempre sea el único que existe, usamos LIMIT 1 sin ID
            const query = `
            UPDATE tb_clientes_clear_fornt 
            SET LIST_CLIENTE = ? 
            ORDER BY ID_CLIENTE_CLEAR ASC 
            LIMIT 1
        `;

            const [result] = await pool.query(query, [LIST_CLIENTE]);

            if (result.affectedRows === 0) {
                // Si por alguna razón la tabla está vacía, insertamos el primer registro
                await pool.query('INSERT INTO tb_clientes_clear_fornt (LIST_CLIENTE) VALUES (?)', [LIST_CLIENTE]);
                return res.json({ message: 'Configuración creada exitosamente' });
            }

            res.json({ message: 'Lista de clientes actualizada correctamente' });
        } catch (error) {
            reportCenterError('center-service.configuration.controller.403',error);
            res.status(500).json({ message: 'Error interno al guardar' });
        }
    },
    // GET: Obtener todas las tolerancias (para llenar la lista del modal)
    getTolerancias: async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT * FROM tb_configuracion_tolerancia_hora ORDER BY ID_TOLERANCIA DESC');
            res.json(rows);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener tolerancias', error });
        }
    },

    // POST: Insertar nueva tolerancia (cuando presionas el botón de check azul)
    createTolerancia: async (req, res) => {
        const { REFERENCIA, TIEMPO_TOLERANCIA } = req.body;
        try {
            const [result] = await pool.query(
                'INSERT INTO tb_configuracion_tolerancia_hora (REFERENCIA, TIEMPO_TOLERANCIA) VALUES (?, ?)',
                [REFERENCIA, TIEMPO_TOLERANCIA]
            );
            res.status(201).json({ id: result.insertId, message: 'Tolerancia agregada' });
        } catch (error) {
            res.status(500).json({ message: 'Error al insertar', error });
        }
    },

    // PUT: Actualizar una tolerancia existente
    updateTolerancia: async (req, res) => {
        const { id } = req.params;
        const { REFERENCIA, TIEMPO_TOLERANCIA } = req.body;
        try {
            await pool.query(
                'UPDATE tb_configuracion_tolerancia_hora SET REFERENCIA = ?, TIEMPO_TOLERANCIA = ? WHERE ID_TOLERANCIA = ?',
                [REFERENCIA, TIEMPO_TOLERANCIA, id]
            );
            res.json({ message: 'Tolerancia actualizada' });
        } catch (error) {
            res.status(500).json({ message: 'Error al actualizar', error });
        }
    },

    // DELETE: Eliminar una tolerancia
    deleteTolerancia: async (req, res) => {
        const { id } = req.params;
        try {
            await pool.query('DELETE FROM tb_configuracion_tolerancia_hora WHERE ID_TOLERANCIA = ?', [id]);
            res.json({ message: 'Tolerancia eliminada' });
        } catch (error) {
            res.status(500).json({ message: 'Error al eliminar', error });
        }
    }
}
