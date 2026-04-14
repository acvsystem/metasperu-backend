import { getIO } from '../config/socket.js';
import { emailService } from '../services/email.service.js';
import { pool } from '../config/db.js';
import { dev_pool } from '../config/dev_bd.js';

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

            procesarAsistenciaFinal(arDataAsistenciaEmpleados[0][`ejb`], data).then((asistencia) => {
                arDataAsistenciaEmpleados[0][`${propertyUnique}`] = asistencia;
                getIO().emit('dashboard_refresh_empleados');
            });

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
            const empleadosUnicos = Array.from(
                new Map(
                    data.map(empleado => [
                        empleado.NUMDOC.trim(), // La llave del Map será el DNI limpio
                        empleado                // El valor será el objeto completo
                    ])
                ).values()
            );

            arDataAsistenciaEmpleados[0].ejb = empleadosUnicos;
            res.status(200).json({ message: 'Se envio la solicitud con exito' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    postRefresAsistenciaEmpleados: (req, res) => {
        const { property } = req.body;

        try {
            const response = [];
            for (const key in arDataAsistenciaEmpleados[0]) {
                if (key == property || key == 'ejb') {

                    if (key != 'ejb') {
                        // 1. Aplanamos el array de arrays para tener una lista única de objetos
                        const asistenciaPlana = arDataAsistenciaEmpleados[0][key].flat().filter(item => item && item.fecha);

                        // 2. Ordenamos por fecha (de la más antigua a la más reciente)
                        asistenciaPlana.sort((a, b) => {
                            // Convertimos las fechas a objetos Date para una comparación precisa
                            const fechaA = new Date(a.fecha);
                            const fechaB = new Date(b.fecha);

                            // Si las fechas son iguales, podemos ordenar por hora de entrada como segundo criterio
                            if (fechaA.getTime() === fechaB.getTime()) {
                                return a.entrada.localeCompare(b.entrada);
                            }

                            return fechaA - fechaB;
                        });

                        response.push({ property: key, data: asistenciaPlana });
                    } else {
                        response.push({ property: key, data: arDataAsistenciaEmpleados[0][key].flat() });
                    }

                }
            }

            res.status(200).json({ asistencia: response });
            delete arDataAsistenciaEmpleados[0][property];
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    postBallotEmployesStore: async (req, res) => {
        const { codeBallot } = req.body;

        // 1. Validación de entrada
        if (!codeBallot) {
            return res.status(400).json({ message: 'El código de papeleta es requerido' });
        }

        try {
            // 2. Consulta de Cabecera
            const headQuery = `SELECT * FROM TB_HEAD_PAPELETA WHERE CODIGO_PAPELETA = ? LIMIT 1`;
            const [rowsHead] = await pool.query(headQuery, [codeBallot]);

            // 3. Verificación de existencia
            if (rowsHead.length === 0) {
                return res.status(404).json({ message: 'Papeleta no encontrada' });
            }

            const headData = rowsHead[0];
            const idHead = headData.ID_HEAD_PAPELETA;

            // 4. Consulta de Detalle
            const detailQuery = `SELECT * FROM TB_DETALLE_PAPELETA WHERE DET_ID_HEAD_PAPELETA = ?`;
            const [rowsDetail] = await pool.query(detailQuery, [idHead]);

            // 5. Respuesta estructurada
            return res.status(200).json({
                success: true,
                head_ballot: headData, // Enviamos el objeto directo, no el array de 1 posición
                detail_ballot: rowsDetail
            });

        } catch (error) {
            console.error(`❌ Error en papeleta ${codeBallot}:`, error.message);
            return res.status(500).json({
                message: 'Error interno del servidor',
                error: process.env.NODE_ENV === 'development' ? error.message : {}
            });
        }
    },
    getScheduleStore: async (req, res) => {
        try {
            // Realizamos un INNER JOIN para obtener el nombre de la tienda
            // H.RANGO_DIAS contiene el rango que vamos a separar para rango_1 y rango_2
            const query = `
            SELECT 
                SUBSTRING_INDEX(H.RANGO_DIAS, ' ', 1) as rango_1,
                SUBSTRING_INDEX(H.RANGO_DIAS, ' ', -1) as rango_2,
                H.CODIGO_TIENDA as code,
                MAX(H.DATETIME) as datetime, 
                T.DESCRIPCION as name
            FROM TB_HORARIO_PROPERTY H
            INNER JOIN TB_LISTA_TIENDA T ON H.CODIGO_TIENDA = T.SERIE_TIENDA
            GROUP BY H.CODIGO_TIENDA, H.RANGO_DIAS, T.DESCRIPCION
            ORDER BY STR_TO_DATE(rango_1, '%d-%m-%Y') DESC;
        `;

            const [rows] = await pool.query(query);

            // Mapeamos los resultados al formato exacto que solicitaste
            const responseData = rows.map(item => ({
                cFecha: item.rango_1, // Usamos el inicio del rango como fecha de referencia
                cSerieStore: item.code,
                cRango_1: item.rango_1,
                cRango_2: item.rango_2,
                cDescripcion: item.name,
                cDatetime: item.datetime
            }));

            return res.status(200).json({
                success: true,
                data: responseData
            });

        } catch (error) {
            console.error(`❌ Error al obtener horarios con nombres:`, error.message);
            return res.status(500).json({
                success: false,
                message: 'Error al procesar la lista de horarios y tiendas',
                error: process.env.NODE_ENV === 'development' ? error.message : {}
            });
        }
    },
    getSearchScheduleStore: async (req, res) => {
        try {
            const { range_days, code_store } = req.body || {};

            if (!range_days || !code_store) {
                return res.status(400).json(mdwErrorHandler.error({
                    status: 400, message: 'Faltan parámetros requeridos.'
                }));
            }

            // 1. Consulta principal parametrizada (Seguridad)
            const [schedules] = await pool.query(
                'SELECT * FROM TB_HORARIO_PROPERTY WHERE CODIGO_TIENDA = ? AND RANGO_DIAS = ?',
                [code_store, range_days]
            );

            if (!schedules.length) {
                return res.status(400).json(mdwErrorHandler.error({
                    status: 400, type: 'OK', message: 'No hay ningún calendario en este rango de fecha.', api: '/schedule/search', data: []
                }));
            }

            // 2. Mapeamos cada horario para traer su detalle en paralelo
            const responseSchedule = await Promise.all(schedules.map(async (sql) => {
                const id = sql.ID_HORARIO;

                // Ejecutamos todas las consultas de detalle al mismo tiempo para este cargo
                const [
                    [ranges],
                    [days],
                    [workDays],
                    [freeDays],
                    [observations]
                ] = await Promise.all([
                    pool.query('SELECT * FROM TB_RANGO_HORA WHERE ID_RG_HORARIO = ?', [id]),
                    pool.query('SELECT * FROM TB_DIAS_HORARIO WHERE ID_DIA_HORARIO = ? ORDER BY POSITION ASC', [id]),
                    pool.query('SELECT * FROM TB_DIAS_TRABAJO WHERE ID_TRB_HORARIO = ?', [id]),
                    pool.query('SELECT * FROM TB_DIAS_LIBRE WHERE ID_TRB_HORARIO = ?', [id]),
                    pool.query('SELECT * FROM TB_OBSERVACION WHERE ID_OBS_HORARIO = ?', [id])
                ]);

                return {
                    id: id,
                    cargo: sql.CARGO,
                    codigo_tienda: sql.CODIGO_TIENDA,
                    rg_hora: ranges.map((r, i) => ({
                        id: r.ID_RANGO_HORA,
                        position: i + 1,
                        rg: r.RANGO_HORA,
                        codigo_tienda: code_store
                    })),
                    dias: days.map((d, i) => ({
                        dia: d.DIA,
                        fecha: d.FECHA,
                        fecha_number: d.FECHA_NUMBER,
                        id: d.ID_DIAS,
                        position: i + 1
                    })),
                    dias_trabajo: workDays.map(r => ({
                        id: r.ID_DIA_TRB,
                        id_cargo: r.ID_TRB_HORARIO,
                        id_dia: r.ID_TRB_DIAS,
                        nombre_completo: r.NOMBRE_COMPLETO,
                        numero_documento: r.NUMERO_DOCUMENTO,
                        rg: r.ID_TRB_RANGO_HORA,
                        codigo_tienda: r.CODIGO_TIENDA
                    })),
                    dias_libres: freeDays.map(r => ({
                        id: r.ID_DIA_LBR,
                        id_cargo: r.ID_TRB_HORARIO,
                        id_dia: r.ID_TRB_DIAS,
                        nombre_completo: r.NOMBRE_COMPLETO,
                        numero_documento: r.NUMERO_DOCUMENTO,
                        rg: r.ID_TRB_RANGO_HORA,
                        codigo_tienda: r.CODIGO_TIENDA
                    })),
                    observacion: observations.map(obs => ({
                        id: obs.ID_OBSERVACION,
                        id_dia: obs.ID_OBS_DIAS,
                        nombre_completo: obs.NOMBRE_COMPLETO,
                        observacion: obs.OBSERVACION
                    }))
                };
            }));

            // 3. Respuesta inmediata sin setTimeouts
            res.status(200).json({ data: responseSchedule });

        } catch (error) {
            console.error("Error en searchSchedule:", error);
            res.status(500).json({ status: 500, message: 'Error interno del servidor' });
        }
    },
    getRegisterScheduleStore: async (req, res) => {
        const { codigoTienda, fechaCabecera, rangoDias, datos } = req.body;
        const n = (val) => (val === undefined || val === null ? null : val);

        // Obtenemos una conexión del pool para la transacción
        const connection = await dev_pool.getConnection();

        try {
            await connection.beginTransaction();

            for (const item of datos) {
                // 1. Insertar Cabecera
                const [resCab] = await connection.execute(
                    `INSERT INTO tb_horario_property (FECHA, RANGO_DIAS, CARGO, CODIGO_TIENDA, ESTADO, DATETIME) 
                 VALUES (?, ?, ?, ?, 1, NOW())`,
                    [n(fechaCabecera), n(rangoDias), n(item.cargo), n(codigoTienda)]
                );

                const idHorario = resCab.insertId;

                // 2. Insertar Días
                const mappingDias = {};
                for (const d of item.dias) {
                    const [resDia] = await connection.execute(
                        `INSERT INTO tb_dias_horario (ID_DIA_HORARIO, DIA, FECHA, POSITION) 
                     VALUES (?, ?, ?, ?)`,
                        [idHorario, n(d.dia), n(d.fecha), n(d.id)]
                    );
                    mappingDias[d.id] = resDia.insertId;
                }

                // 3. Insertar Notas
                if (item.notasDia) {
                    for (const [idDiaJson, observacion] of Object.entries(item.notasDia)) {
                        // Solo insertamos si hay texto real
                        if (observacion && String(observacion).trim() !== "") {
                            await connection.execute(
                                `INSERT INTO tb_observacion (ID_OBS_HORARIO, ID_OBS_DIAS, OBSERVACION) 
                             VALUES (?, ?, ?)`,
                                [idHorario, mappingDias[idDiaJson], n(observacion)]
                            );
                        }
                    }
                }

                // 4. Insertar Filas de Trabajo
                if (item.filasTrabajo && Array.isArray(item.filasTrabajo)) {
                    for (const fila of item.filasTrabajo) {
                        const [resRango] = await connection.execute(
                            `INSERT INTO tb_rango_hora (ID_RG_HORARIO, RANGO_HORA) VALUES (?, ?)`,
                            [idHorario, n(fila.rango)]
                        );
                        const idRangoReal = resRango.insertId;

                        if (fila.celdas && Array.isArray(fila.celdas)) {
                            for (const diaInfo of fila.celdas) {
                                if (diaInfo.trabajadores && Array.isArray(diaInfo.trabajadores)) {
                                    for (const user of diaInfo.trabajadores) {
                                        await connection.execute(
                                            `INSERT INTO tb_dias_trabajo (ID_TRB_HORARIO, ID_TRB_DIAS, ID_TRB_RANGO_HORA, NUMERO_DOCUMENTO, NOMBRE_COMPLETO) 
                                         VALUES (?, ?, ?, ?, ?)`,
                                            [
                                                idHorario,
                                                mappingDias[diaInfo.id_dia],
                                                idRangoReal,
                                                n(user.dni),
                                                n(user.nombre_completo)
                                            ]
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                // 5. Insertar Libres
                if (item.filaLibres && Array.isArray(item.filaLibres)) {
                    for (const libre of item.filaLibres) {
                        if (libre.trabajadores && Array.isArray(libre.trabajadores)) {
                            for (const trb of libre.trabajadores) {
                                await connection.execute(
                                    `INSERT INTO tb_dias_libre (ID_TRB_HORARIO, ID_TRB_DIAS, NUMERO_DOCUMENTO, NOMBRE_COMPLETO) 
                                 VALUES (?, ?, ?, ?)`,
                                    [
                                        idHorario,
                                        mappingDias[libre.id_dia],
                                        n(trb.dni),
                                        n(trb.nombre_completo)
                                    ]
                                );
                            }
                        }
                    }
                }
            }

            await connection.commit();
            res.status(201).json({ success: true, message: 'Horario registrado correctamente' });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Error detallado:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            if (connection) connection.release();
        }
    },
    getOneSearchScheduleStore: async (req, res) => {
        const { codigoTienda, rango_fecha } = req.body;

        if (!rango_fecha || !codigoTienda) {
            return res.status(400).json({
                success: false,
                message: 'Parámetros incompletos (rango_fecha, codigoTienda)'
            });
        }
        const connection = await dev_pool.getConnection();

        try {
            // 1. Obtener todas las cabeceras/cargos en el rango
            const [cabeceras] = await connection.execute(
                `SELECT ID_HORARIO, CARGO, FECHA, RANGO_DIAS 
             FROM tb_horario_property 
             WHERE CODIGO_TIENDA = ? AND RANGO_DIAS = ?
             ORDER BY FECHA ASC`,
                [codigoTienda, rango_fecha]
            );

            const respuestaFinal = [];

            for (const cab of cabeceras) {
                const idH = cab.ID_HORARIO;

                // Consultas de apoyo
                const [diasDB] = await connection.execute(
                    `SELECT ID_DIAS, DIA, FECHA, POSITION FROM tb_dias_horario WHERE ID_DIA_HORARIO = ? ORDER BY POSITION ASC`, [idH]);
                const [rangosDB] = await connection.execute(`SELECT ID_RANGO_HORA, RANGO_HORA FROM tb_rango_hora WHERE ID_RG_HORARIO = ?`, [idH]);
                const [trabajadoresDB] = await connection.execute(`SELECT * FROM tb_dias_trabajo WHERE ID_TRB_HORARIO = ?`, [idH]);
                const [libresDB] = await connection.execute(`SELECT * FROM tb_dias_libre WHERE ID_TRB_HORARIO = ?`, [idH]);
                const [obsDB] = await connection.execute(`SELECT ID_OBS_DIAS, OBSERVACION FROM tb_observacion WHERE ID_OBS_HORARIO = ?`, [idH]);

                // Formatear dias
                const diasFormateados = diasDB.map(d => ({
                    id: d.POSITION, // Usamos la posición como ID relativo según tu ejemplo
                    dia: d.DIA,
                    fecha: d.FECHA
                }));

                // Reconstruir filasTrabajo (Agrupado por Rango Horario)
                const filasTrabajo = rangosDB.map(r => ({
                    rango: r.RANGO_HORA,
                    celdas: diasDB.map(d => ({
                        id_dia: d.POSITION,
                        trabajadores: trabajadoresDB
                            .filter(t => t.ID_TRB_RANGO_HORA === r.ID_RANGO_HORA && t.ID_TRB_DIAS === d.ID_DIAS)
                            .map(t => ({
                                dni: t.NUMERO_DOCUMENTO,
                                nombre_completo: t.NOMBRE_COMPLETO
                            }))
                    }))
                }));

                // Reconstruir filaLibres
                const filaLibres = diasDB.map(d => ({
                    id_dia: d.POSITION,
                    trabajadores: libresDB
                        .filter(l => l.ID_TRB_DIAS === d.ID_DIAS)
                        .map(l => ({
                            dni: l.NUMERO_DOCUMENTO,
                            nombre_completo: l.NOMBRE_COMPLETO
                        }))
                }));

                // Reconstruir notasDia (Objeto: { id_dia: observacion })
                const notasDia = {};
                obsDB.forEach(o => {
                    const diaCorrespondiente = diasDB.find(d => d.ID_DIAS === o.ID_OBS_DIAS);
                    if (diaCorrespondiente) {
                        notasDia[diaCorrespondiente.POSITION] = o.OBSERVACION;
                    }
                });

                // Armar el objeto del cargo según tu estructura solicitada
                respuestaFinal.push({
                    cargo: cab.CARGO,
                    dias: diasFormateados,
                    filasTrabajo: filasTrabajo,
                    filaLibres: filaLibres,
                    notasDia: notasDia
                });
            }

            res.status(200).json(respuestaFinal);

        } catch (error) {
            console.error('❌ Error:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            if (connection) connection.release();
        }
    },
    postUpdateScheduleStore: async (req, res) => {
        // Recibimos los mismos datos que en el registro
        const { codigoTienda, fechaCabecera, rangoDias, datos } = req.body;
        const n = (val) => (val === undefined || val === null ? null : val);

        // RESPALDO PREVENTIVO: Guardamos un archivo local por si la DB falla catastróficamente
        try {
            const fileName = `./logs/backup_${codigoTienda}_${fechaCabecera}.json`;
            await fs.writeFile(fileName, JSON.stringify(req.body, null, 2));
        } catch (err) {
            console.error("No se pudo crear el backup local, pero continuamos...", err);
        }

        const connection = await dev_pool.getConnection();

        try {
            await connection.beginTransaction();

            // 1. LIMPIEZA: Buscamos los IDs de horarios existentes para ese rango y tienda para borrar sus hijos
            // Esto asegura que no queden registros huérfanos antes de insertar los nuevos.
            const [existentes] = await connection.execute(
                `SELECT ID_HORARIO FROM tb_horario_property 
             WHERE CODIGO_TIENDA = ? AND FECHA = ?`,
                [codigoTienda, fechaCabecera]
            );

            if (existentes.length > 0) {
                const idsABorrar = existentes.map(h => h.ID_HORARIO);

                // Borrar cascada manual (en caso de que no tengas ON DELETE CASCADE en la DB)
                await connection.query(`DELETE FROM tb_observacion WHERE ID_OBS_HORARIO IN (?)`, [idsABorrar]);
                await connection.query(`DELETE FROM tb_dias_trabajo WHERE ID_TRB_HORARIO IN (?)`, [idsABorrar]);
                await connection.query(`DELETE FROM tb_dias_libre WHERE ID_TRB_HORARIO IN (?)`, [idsABorrar]);
                await connection.query(`DELETE FROM tb_rango_hora WHERE ID_RG_HORARIO IN (?)`, [idsABorrar]);
                await connection.query(`DELETE FROM tb_dias_horario WHERE ID_DIA_HORARIO IN (?)`, [idsABorrar]);
                await connection.query(`DELETE FROM tb_horario_property WHERE ID_HORARIO IN (?)`, [idsABorrar]);
            }

            // 2. RE-INSERCIÓN: Utilizamos la misma lógica del registro

            for (const item of datos) {
                // 1. Insertar Cabecera
                const [resCab] = await connection.execute(
                    `INSERT INTO tb_horario_property (FECHA, RANGO_DIAS, CARGO, CODIGO_TIENDA, ESTADO, DATETIME) 
                 VALUES (?, ?, ?, ?, 1, NOW())`,
                    [n(fechaCabecera), n(rangoDias), n(item.cargo), n(codigoTienda)]
                );

                const idHorario = resCab.insertId;

                // 2. Insertar Días
                const mappingDias = {};
                for (const d of item.dias) {
                    const [resDia] = await connection.execute(
                        `INSERT INTO tb_dias_horario (ID_DIA_HORARIO, DIA, FECHA, POSITION) 
                     VALUES (?, ?, ?, ?)`,
                        [idHorario, n(d.dia), n(d.fecha), n(d.id)]
                    );
                    mappingDias[d.id] = resDia.insertId;
                }

                // 3. Insertar Notas
                if (item.notasDia) {
                    for (const [idDiaJson, observacion] of Object.entries(item.notasDia)) {
                        // Solo insertamos si hay texto real
                        if (observacion && String(observacion).trim() !== "") {
                            await connection.execute(
                                `INSERT INTO tb_observacion (ID_OBS_HORARIO, ID_OBS_DIAS, OBSERVACION) 
                             VALUES (?, ?, ?)`,
                                [idHorario, mappingDias[idDiaJson], n(observacion)]
                            );
                        }
                    }
                }

                // 4. Insertar Filas de Trabajo
                if (item.filasTrabajo && Array.isArray(item.filasTrabajo)) {
                    for (const fila of item.filasTrabajo) {
                        const [resRango] = await connection.execute(
                            `INSERT INTO tb_rango_hora (ID_RG_HORARIO, RANGO_HORA) VALUES (?, ?)`,
                            [idHorario, n(fila.rango)]
                        );
                        const idRangoReal = resRango.insertId;

                        if (fila.celdas && Array.isArray(fila.celdas)) {
                            for (const diaInfo of fila.celdas) {
                                if (diaInfo.trabajadores && Array.isArray(diaInfo.trabajadores)) {
                                    for (const user of diaInfo.trabajadores) {
                                        await connection.execute(
                                            `INSERT INTO tb_dias_trabajo (ID_TRB_HORARIO, ID_TRB_DIAS, ID_TRB_RANGO_HORA, NUMERO_DOCUMENTO, NOMBRE_COMPLETO) 
                                         VALUES (?, ?, ?, ?, ?)`,
                                            [
                                                idHorario,
                                                mappingDias[diaInfo.id_dia],
                                                idRangoReal,
                                                n(user.dni),
                                                n(user.nombre_completo)
                                            ]
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                // 5. Insertar Libres
                if (item.filaLibres && Array.isArray(item.filaLibres)) {
                    for (const libre of item.filaLibres) {
                        if (libre.trabajadores && Array.isArray(libre.trabajadores)) {
                            for (const trb of libre.trabajadores) {
                                await connection.execute(
                                    `INSERT INTO tb_dias_libre (ID_TRB_HORARIO, ID_TRB_DIAS, NUMERO_DOCUMENTO, NOMBRE_COMPLETO) 
                                 VALUES (?, ?, ?, ?)`,
                                    [
                                        idHorario,
                                        mappingDias[libre.id_dia],
                                        n(trb.dni),
                                        n(trb.nombre_completo)
                                    ]
                                );
                            }
                        }
                    }
                }
            }

            await connection.commit();
            res.status(200).json({ success: true, message: 'Horario actualizado correctamente' });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('❌ Error al editar:', error);
            res.status(500).json({ success: false, error: error.message });
        } finally {
            if (connection) connection.release();
        }
    }
};


const CONFIG = {
    MIN_TOLERANCIA_ENTRADA: 0,
    MIN_BREAK_PERMITIDO: 60,
    MIN_TOLERANCIA_BREAK: 0,
    HORAS_LABORALES_META: 8
};

// Función maestra para convertir Fecha + Hora en un objeto Date real
const crearFecha = (fechaStr, horaStr) => {
    if (!horaStr || horaStr.includes('--')) return null;
    return new Date(`${fechaStr}T${horaStr}`);
};

const analizarMetricasMadrugada = (dia, horaOficial) => {
    // 1. Configuración de entrada oficial para tardanza
    let dEntradaPrimera = crearFecha(dia.fecha, dia.entrada);
    let dOficial = crearFecha(dia.fecha, horaOficial);

    let totalMinutosTrabajados = 0;
    let totalMinutosBreak = 0;

    // 2. RECORRER TODOS LOS BLOQUES (Pueden ser 1, 2, 5 o más)
    const bloques = dia.marcaciones || [];

    bloques.forEach((bloque, index) => {
        let inicio = crearFecha(dia.fecha, bloque.hrIn);
        let fin = crearFecha(dia.fecha, bloque.hrOut);

        if (inicio && fin) {
            totalMinutosTrabajados += calcularDiferenciaMinutos(bloque.hrIn, bloque.hrOut);
        }

        // Calcular Break: Es el tiempo entre el fin del bloque actual 
        // y el inicio del siguiente bloque
        if (index < bloques.length - 1) {
            let finBloqueActual = crearFecha(dia.fecha, bloque.hrOut);
            let inicioSiguiente = crearFecha(dia.fecha, bloques[index + 1].hrIn);

            // Ajuste de madrugada para el break
            if (inicioSiguiente < finBloqueActual) {
                inicioSiguiente.setDate(inicioSiguiente.getDate() + 1);
            }

            if (finBloqueActual && inicioSiguiente) {
                const msBreak = inicioSiguiente - finBloqueActual;
                totalMinutosBreak += (msBreak / 1000 / 60);
            }
        }
    });

    // 3. Cálculo de Tardanza (Solo se evalúa la primera entrada del día)
    const minutosTardanza = dEntradaPrimera && dOficial
        ? (dEntradaPrimera - dOficial) / 1000 / 60
        : 0;

    const esTardanza = minutosTardanza > CONFIG.MIN_TOLERANCIA_ENTRADA;

    return {
        ...dia,
        tiempoBreak: fmt(totalMinutosBreak), // Suma de todos los intermedios
        horasEfectivas: minutosAHoras(totalMinutosTrabajados), // Suma de todos los bloques laborados
        tardanza: esTardanza ? 'tardanza' : 'correcto',
        minutosTardanza: minutosTardanza > 0 ? minutosTardanza : 0,
        excesoBreak: totalMinutosBreak > (CONFIG.MIN_BREAK_PERMITIDO + CONFIG.MIN_TOLERANCIA_BREAK) ? 'verificar' : 'correcto',
        jornadaIncompleta: (totalMinutosTrabajados / 60) < CONFIG.HORAS_LABORALES_META ? 'incompleta' : 'completa'
    };
};

const fmt = (minutosDecimales) => {
    if (!minutosDecimales || minutosDecimales <= 0) return "00:00";

    // Redondeamos al minuto más cercano para absorber los segundos
    // 418.966 se convertirá en 419
    const minutosRedondeados = Math.round(minutosDecimales);

    const hrs = Math.floor(minutosRedondeados / 60);
    const mins = minutosRedondeados % 60;

    // padStart asegura que siempre veamos 08:05 y no 8:5
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};


const searchPapeletaEmpleado = async (fecha, documento) => {
    try {
        const query = `
            SELECT CODIGO_PAPELETA,HORA_SOLICITADA FROM TB_HEAD_PAPELETA 
            WHERE ID_PAP_TIPO_PAPELETA = 7 AND NRO_DOCUMENTO_EMPLEADO = ? AND FECHA_DESDE = ?
        `;

        const [rows] = await pool.query(query, [documento.trim(), fecha]);

        if (rows && rows.length > 0) {
            const rangoCompleto = rows[0].CODIGO_PAPELETA;
            const horaSolicitada = rows[0].HORA_SOLICITADA;

            //
            return {
                codigoPapeleta: rangoCompleto || "",
                horaSolicitada: horaSolicitada || "",
                isPapeleta: rangoCompleto.length > 0 ? true : false
            };
        }

        return { codigoPapeleta: "", isPapeleta: false }; // Valor por defecto

    } catch (error) {
        console.error("Error en searchPapeletaEmpleado:", error);
        return { codigoPapeleta: "", isPapeleta: false };
    }
}


const searchHorarioEmpleado = async (fecha, documento) => {
    try {
        const query = `
            SELECT RH.RANGO_HORA 
            FROM TB_DIAS_TRABAJO DT
            INNER JOIN TB_RANGO_HORA RH ON RH.ID_RANGO_HORA = DT.ID_TRB_RANGO_HORA 
            INNER JOIN TB_DIAS_HORARIO DH ON DH.ID_DIAS = DT.ID_TRB_DIAS 
            WHERE DH.FECHA_NUMBER = ? AND DT.NUMERO_DOCUMENTO = ?
            LIMIT 1;
        `;

        const [rows] = await pool.query(query, [fecha, documento.trim()]);

        if (rows && rows.length > 0) {
            const rangoCompleto = rows[0].RANGO_HORA; // Ejemplo: "08:30 a 17:30"

            // Dividimos por la " a " y tomamos el primer elemento [0]
            // Usamos .trim() por si hay espacios extra alrededor
            const horaEntrada = rangoCompleto.split(' a ')[0].trim();

            return {
                rango: rangoCompleto,
                entradaOficial: horaEntrada // Esto devolverá "08:30"
            };
        }

        return { rango: "", entradaOficial: "08:00" }; // Valor por defecto

    } catch (error) {
        console.error("Error en searchHorarioEmpleado:", error);
        return { rango: "", entradaOficial: "08:00" };
    }
}

const searchDescansoEmpleado = async (fecha, documento) => {
    try {
        const query = `
            SELECT * 
            FROM TB_DIAS_LIBRE DL
            INNER JOIN TB_DIAS_HORARIO DH ON DH.ID_DIAS = DL.ID_TRB_DIAS
            WHERE DH.FECHA_NUMBER = ? AND DL.NUMERO_DOCUMENTO = ?
            LIMIT 1;
        `;

        const [rows] = await pool.query(query, [fecha, documento.trim()]);

        if (rows && rows.length > 0) {
            const diaDescanso = rows[0].DIA; // Ejemplo: "08:30 a 17:30"

            // Dividimos por la " a " y tomamos el primer elemento [0]
            // Usamos .trim() por si hay espacios extra alrededor

            return {
                descanso: diaDescanso
            };
        }

        return { descanso: "" }; // Valor por defecto

    } catch (error) {
        console.error("Error en searchHorarioEmpleado:", error);
        return { rango: "", entradaOficial: "08:00" };
    }
}

const formatearFechaParaDB = (fechaISO) => {
    // fechaISO viene como "2025-01-27"
    const [anio, mes, dia] = fechaISO.split('-');
    // Retornamos "27-1-2025" (quitando ceros a la izquierda del mes/día si es necesario)
    return `${parseInt(dia)}-${parseInt(mes)}-${anio}`;
};

// --- PROCESADOR PRINCIPAL ---
const procesarAsistenciaFinal = async (empleados, marcaciones) => {

    const resultadosPorEmpleado = await Promise.all(empleados.map(async (emp) => {
        const dni = emp.NUMDOC.trim();
        const susMarcaciones = marcaciones.filter(m => m.nroDocumento.trim() === dni);

        if (susMarcaciones.length === 0) return [];

        // 1. Agrupar por día
        const cajasExcluidas = ['9M1', '9M2', '9M3'];

        const grupos = susMarcaciones.reduce((acc, curr) => {
            // 1. Validamos si la caja actual NO está en la lista de excluidas

            if (!cajasExcluidas.includes(curr.caja)) {

                // 2. Si el día no existe en el acumulador, lo inicializamos
                if (!acc[curr.dia]) {
                    acc[curr.dia] = [];
                }

                // 3. Calculamos las horas del bloque
                curr.hrWorking = minutosAHoras(calcularDiferenciaMinutos(curr.hrIn, curr.hrOut));

                // 4. Agregamos el registro al grupo del día correspondiente
                acc[curr.dia].push(curr);
            }

            // IMPORTANTE: Siempre retornar el acumulador en cada iteración
            return acc;
        }, {});

        // 2. Procesar cada día dinámicamente
        const asistenciaDiaria = await Promise.all(Object.keys(grupos).map(async (fecha) => {
            // Ordenamos todas las marcaciones del día por hora de inicio
            const lista = grupos[fecha].sort((a, b) => a.hrIn.localeCompare(b.hrIn));
            const totalMarcaciones = lista.length;

            // LÓGICA DINÁMICA:
            const primera = lista[0]; // Siempre la primera del día
            const ultima = lista[totalMarcaciones - 1]; // Siempre la última del día

            const fechaSQL = formatearFechaParaDB(fecha);

            // Consultas a DB en paralelo
            const [horarioDB, papeletaDB, diaDescanso] = await Promise.all([
                searchHorarioEmpleado(fechaSQL, dni),
                searchPapeletaEmpleado(fecha, dni),
                searchDescansoEmpleado(fechaSQL, dni)
            ]);

            // Construimos el registro base
            const registro = {
                documento: dni,
                nombre: primera.nombreCompleto,
                ejb: emp.CODEJB,
                tienda: emp.UNDSERVICIO,
                dia: fecha,
                fecha: fecha,

                // Métrica de visualización
                entrada: primera.hrIn,
                salidaFinal: ultima.hrOut || ultima.hrIn, // Si no tiene salida, usamos la entrada del último bloque

                // Estos campos ahora son informativos del primer y segundo bloque (si existen)
                salidaBreak: totalMarcaciones > 1 ? lista[0].hrOut : '--:--:--',
                retornoBreak: totalMarcaciones > 1 ? lista[1].hrIn : '--:--:--',

                // Datos de Horario/Papeleta
                entradaOficial: horarioDB.entradaOficial || "08:30",
                rango: (diaDescanso.descanso || "").length ? 'Descanso' : (horarioDB.rango || "Sin Horario"),
                codigoPapeleta: papeletaDB.codigoPapeleta || "",
                isPapeleta: papeletaDB.isPapeleta ? 'con papeleta' : 'sin papeleta',
                horaSolicitada: papeletaDB.horaSolicitada || "",
                // ENVIAMOS TODAS LAS MARCACIONES (las 5 o más)
                // Esto servirá para que en el Dashboard puedas hacer un "Ver más"
                marcaciones: lista,
                marcacionesLen: (lista || []).length,
                totalBloques: totalMarcaciones
            };

            // Aplicamos tu lógica de madrugada y cálculos de horas
            return analizarMetricasMadrugada(registro, registro.entradaOficial);
        }));

        return asistenciaDiaria;
    }));

    return resultadosPorEmpleado.flat();
};

/**
 * Calcula la diferencia en minutos entre dos horas (HH:mm)
 * Soporta cruce de medianoche (ej: 23:00 a 07:00)
 */
const calcularDiferenciaMinutos = (horaInicio, horaFin) => {
    if (!horaInicio || !horaFin) return 0;

    const [h1, m1] = horaInicio.split(':').map(Number);
    const [h2, m2] = horaFin.split(':').map(Number);

    const inicioEnMinutos = h1 * 60 + m1;
    const finEnMinutos = h2 * 60 + m2;

    let diferencia = finEnMinutos - inicioEnMinutos;

    // Si la diferencia es negativa, significa que pasó a otro día (Cruce de medianoche)
    if (diferencia < 0) {
        diferencia += 24 * 60;
    }

    return diferencia;
};

// Función para convertir minutos a formato legible "HH:mm"
const minutosAHoras = (totalMinutos) => {
    const hrs = Math.floor(totalMinutos / 60);
    const mins = totalMinutos % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};
