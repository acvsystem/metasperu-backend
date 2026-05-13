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
    },
    gerPermissionsUserStore: async (req, res) => {
        const { id } = req.body;
        try {
            const [rows] = await pool.execute('SELECT * FROM tb_usuario_tiendas_asignadas WHERE ID_USUARIO_TASG = ?', [id]);
            res.json(rows);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    },
    postAsigPermissionsUserStore: async (req, res) => {
        const { ID_USUARIO, TIENDAS } = req.body; // TIENDAS: [ {id: 1, nombre: 'Tienda A'}, ... ]

        if (!ID_USUARIO || !TIENDAS) {
            return res.status(400).json({ message: 'Datos incompletos' });
        }

        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // 1. Obtener las tiendas que el usuario YA tiene asignadas actualmente
            const [rowsActuales] = await connection.query(
                'SELECT ID_TIENDA_TASG FROM tb_usuario_tiendas_asignadas WHERE ID_USUARIO_TASG = ?',
                [ID_USUARIO]
            );
            const idsActuales = rowsActuales.map(row => row.ID_TIENDA_TASG);
            const idsNuevos = TIENDAS.map(t => t.id);

            // 2. Identificar qué IDs borrar (están en la DB pero no en el nuevo envío)
            const idsAEliminar = idsActuales.filter(id => !idsNuevos.includes(id));

            // 3. Identificar qué IDs insertar (están en el envío pero no en la DB)
            const tiendasAInsertar = TIENDAS.filter(t => !idsActuales.includes(t.id));

            // --- Ejecutar Cambios ---

            // A. Eliminar los que ya no sobran
            if (idsAEliminar.length > 0) {
                await connection.query(
                    'DELETE FROM tb_usuario_tiendas_asignadas WHERE ID_USUARIO_TASG = ? AND ID_TIENDA_TASG IN (?)',
                    [ID_USUARIO, idsAEliminar]
                );
            }

            // B. Insertar los nuevos
            if (tiendasAInsertar.length > 0) {
                const values = tiendasAInsertar.map(t => [ID_USUARIO, t.id, t.nombre]);
                await connection.query(
                    'INSERT INTO tb_usuario_tiendas_asignadas (ID_USUARIO_TASG, ID_TIENDA_TASG, DESCRIPCION_TIENDA) VALUES ?',
                    [values]
                );
            }

            await connection.commit();

            res.status(200).json({
                message: 'Sincronización exitosa',
                eliminados: idsAEliminar.length,
                insertados: tiendasAInsertar.length,
                mantenidos: idsActuales.length - idsAEliminar.length
            });

        } catch (error) {
            await connection.rollback();
            console.error("Error sincronizando tiendas:", error);
            res.status(500).json({ message: 'Error en el servidor' });
        } finally {
            connection.release();
        }
    },
    getAsingMenuUser: async (req, res) => {
        const { NIVEL, MENUS } = req.body; // MENUS: [1, 2, 3, 4, ...] (Array de IDs de menú)

        if (!NIVEL || !Array.isArray(MENUS)) {
            return res.status(400).json({ message: 'Nivel o lista de menús inválida' });
        }

        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // 1. Obtener los permisos que el NIVEL ya tiene actualmente
            const [rowsActuales] = await connection.query(
                'SELECT ID_MENU_PS FROM tb_permiso_sistema WHERE NIVEL = ?',
                [NIVEL]
            );

            const idsActuales = rowsActuales.map(row => row.ID_MENU_PS);
            const idsNuevos = MENUS;

            // 2. Identificar qué IDs borrar (están en DB pero no en el nuevo envío)
            const idsAEliminar = idsActuales.filter(id => !idsNuevos.includes(id));

            // 3. Identificar qué IDs insertar (están en el envío pero no en la DB)
            const idsAInsertar = idsNuevos.filter(id => !idsActuales.includes(id));

            // --- Ejecutar Cambios ---

            // A. Eliminar los menús desmarcados
            if (idsAEliminar.length > 0) {
                await connection.query(
                    'DELETE FROM tb_permiso_sistema WHERE NIVEL = ? AND ID_MENU_PS IN (?)',
                    [NIVEL, idsAEliminar]
                );
            }

            // B. Insertar los nuevos menús asignados
            if (idsAInsertar.length > 0) {
                const values = idsAInsertar.map(idMenu => [idMenu, NIVEL]);
                await connection.query(
                    'INSERT INTO tb_permiso_sistema (ID_MENU_PS, NIVEL) VALUES ?',
                    [values]
                );
            }

            await connection.commit();

            res.status(200).json({
                message: `Permisos para el nivel ${NIVEL} actualizados`,
                detalles: {
                    eliminados: idsAEliminar.length,
                    insertados: idsAInsertar.length,
                    mantenidos: idsActuales.length - idsAEliminar.length
                }
            });

        } catch (error) {
            await connection.rollback();
            console.error("Error sincronizando permisos de menú:", error);
            res.status(500).json({ message: 'Error interno del servidor' });
        } finally {
            connection.release();
        }
    },
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
            console.error("Error en GET parametros:", error);
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
            console.error(error);
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
            console.error(error);
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
            console.error(error);
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
            console.error("Error al obtener clientes clear:", error);
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
            console.error("Error al actualizar clientes clear:", error);
            res.status(500).json({ message: 'Error interno al guardar' });
        }
    }
}
