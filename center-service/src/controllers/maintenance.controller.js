import { pool } from '../config/db.js';

const tableConfig = {
    headPapeleta: {
        table: 'tb_head_papeleta',
        primaryKey: 'ID_HEAD_PAPELETA',
        columns: [
            'CODIGO_PAPELETA',
            'NOMBRE_COMPLETO',
            'NRO_DOCUMENTO_EMPLEADO',
            'ID_PAP_TIPO_PAPELETA',
            'CARGO_EMPLEADO',
            'FECHA_DESDE',
            'FECHA_HASTA',
            'HORA_SALIDA',
            'HORA_LLEGADA',
            'HORA_ACUMULADA',
            'HORA_SOLICITADA',
            'CODIGO_TIENDA',
            'FECHA_CREACION',
            'DESCRIPCION',
            'ESTADO_PAPELETA',
            'ISUPDATE',
            'ISBLOCKED'
        ],
        textFilters: [
            'CODIGO_PAPELETA',
            'NOMBRE_COMPLETO',
            'NRO_DOCUMENTO_EMPLEADO',
            'CODIGO_TIENDA',
            'ESTADO_PAPELETA'
        ]
    },
    detallePapeleta: {
        table: 'tb_detalle_papeleta',
        primaryKey: 'ID_DETALLE_PAPELETA',
        columns: [
            'DET_ID_HEAD_PAPELETA',
            'DET_ID_HR_EXTRA',
            'HR_EXTRA_ACUMULADO',
            'HR_EXTRA_SOLICITADO',
            'HR_EXTRA_SOBRANTE',
            'ESTADO',
            'APROBADO',
            'SELECCIONADO',
            'FECHA',
            'FECHA_MODIFICACION'
        ],
        textFilters: ['ESTADO', 'FECHA']
    },
    horaExtraEmpleado: {
        table: 'tb_hora_extra_empleado',
        primaryKey: 'ID_HR_EXTRA',
        columns: [
            'NRO_DOCUMENTO_EMPLEADO',
            'HR_EXTRA_ACUMULADO',
            'HR_EXTRA_SOLICITADO',
            'HR_EXTRA_SOBRANTE',
            'ESTADO',
            'APROBADO',
            'SELECCIONADO',
            'FECHA',
            'FECHA_MODIFICACION',
            'ISUPDATE',
            'OBSERVACION',
            'ISAPROBACION'
        ],
        textFilters: ['NRO_DOCUMENTO_EMPLEADO', 'ESTADO', 'FECHA']
    }
};

const resourceAliases = {
    'head-papeleta': 'headPapeleta',
    'tb_head_papeleta': 'headPapeleta',
    'detalle-papeleta': 'detallePapeleta',
    'tb_detalle_papeleta': 'detallePapeleta',
    'hora-extra-empleado': 'horaExtraEmpleado',
    'tb_hora_extra_empleado': 'horaExtraEmpleado'
};

const getTableConfig = (resource) => tableConfig[resourceAliases[resource] || resource];

const parsePositiveInteger = (value, fallback, maxValue) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, maxValue);
};

const pickAllowedFields = (body, columns) => {
    return columns.reduce((fields, column) => {
        if (Object.prototype.hasOwnProperty.call(body, column)) {
            fields[column] = body[column];
        }
        return fields;
    }, {});
};

const buildWhere = (config, query) => {
    const conditions = [];
    const values = [];
    const allowedFilters = [config.primaryKey, ...config.columns];

    for (const column of allowedFilters) {
        const value = query[column];
        if (value === undefined || value === '') continue;

        if (config.textFilters.includes(column)) {
            conditions.push(`${column} LIKE ?`);
            values.push(`%${value}%`);
        } else {
            conditions.push(`${column} = ?`);
            values.push(value);
        }
    }

    return {
        clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        values
    };
};

const handleError = (res, error, message) => {
    console.error(message, error);
    res.status(500).json({
        success: false,
        message
    });
};

export const maintenanceController = {
    list: async (req, res) => {
        const config = getTableConfig(req.params.resource);
        if (!config) return res.status(404).json({ success: false, message: 'Recurso no encontrado' });

        const page = parsePositiveInteger(req.query.page, 1, 100000);
        const limit = parsePositiveInteger(req.query.limit, 50, 200);
        const offset = (page - 1) * limit;
        const order = String(req.query.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const { clause, values } = buildWhere(config, req.query);

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM ${config.table} ${clause} ORDER BY ${config.primaryKey} ${order} LIMIT ? OFFSET ?`,
                [...values, limit, offset]
            );
            const [countRows] = await pool.execute(
                `SELECT COUNT(*) AS total FROM ${config.table} ${clause}`,
                values
            );

            res.json({
                success: true,
                data: rows,
                pagination: {
                    page,
                    limit,
                    total: countRows[0].total
                }
            });
        } catch (error) {
            handleError(res, error, 'Error al listar registros de mantenimiento');
        }
    },

    getById: async (req, res) => {
        const config = getTableConfig(req.params.resource);
        if (!config) return res.status(404).json({ success: false, message: 'Recurso no encontrado' });

        try {
            const [rows] = await pool.execute(
                `SELECT * FROM ${config.table} WHERE ${config.primaryKey} = ? LIMIT 1`,
                [req.params.id]
            );

            if (!rows.length) {
                return res.status(404).json({ success: false, message: 'Registro no encontrado' });
            }

            res.json({ success: true, data: rows[0] });
        } catch (error) {
            handleError(res, error, 'Error al obtener registro de mantenimiento');
        }
    },

    create: async (req, res) => {
        const config = getTableConfig(req.params.resource);
        if (!config) return res.status(404).json({ success: false, message: 'Recurso no encontrado' });

        const fields = pickAllowedFields(req.body, config.columns);
        const columns = Object.keys(fields);
        if (!columns.length) {
            return res.status(400).json({ success: false, message: 'No se enviaron campos validos para registrar' });
        }

        try {
            const placeholders = columns.map(() => '?').join(', ');
            const [result] = await pool.execute(
                `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders})`,
                columns.map(column => fields[column])
            );

            const [rows] = await pool.execute(
                `SELECT * FROM ${config.table} WHERE ${config.primaryKey} = ? LIMIT 1`,
                [result.insertId]
            );

            res.status(201).json({
                success: true,
                message: 'Registro creado correctamente',
                id: result.insertId,
                data: rows[0] || null
            });
        } catch (error) {
            handleError(res, error, 'Error al crear registro de mantenimiento');
        }
    },

    update: async (req, res) => {
        const config = getTableConfig(req.params.resource);
        if (!config) return res.status(404).json({ success: false, message: 'Recurso no encontrado' });

        const fields = pickAllowedFields(req.body, config.columns);
        const columns = Object.keys(fields);
        if (!columns.length) {
            return res.status(400).json({ success: false, message: 'No se enviaron campos validos para actualizar' });
        }

        try {
            const assignments = columns.map(column => `${column} = ?`).join(', ');
            const [result] = await pool.execute(
                `UPDATE ${config.table} SET ${assignments} WHERE ${config.primaryKey} = ?`,
                [...columns.map(column => fields[column]), req.params.id]
            );

            if (!result.affectedRows) {
                return res.status(404).json({ success: false, message: 'Registro no encontrado' });
            }

            const [rows] = await pool.execute(
                `SELECT * FROM ${config.table} WHERE ${config.primaryKey} = ? LIMIT 1`,
                [req.params.id]
            );

            res.json({
                success: true,
                message: 'Registro actualizado correctamente',
                data: rows[0] || null
            });
        } catch (error) {
            handleError(res, error, 'Error al actualizar registro de mantenimiento');
        }
    },

    remove: async (req, res) => {
        const config = getTableConfig(req.params.resource);
        if (!config) return res.status(404).json({ success: false, message: 'Recurso no encontrado' });

        try {
            const [result] = await pool.execute(
                `DELETE FROM ${config.table} WHERE ${config.primaryKey} = ?`,
                [req.params.id]
            );

            if (!result.affectedRows) {
                return res.status(404).json({ success: false, message: 'Registro no encontrado' });
            }

            res.json({ success: true, message: 'Registro eliminado correctamente' });
        } catch (error) {
            handleError(res, error, 'Error al eliminar registro de mantenimiento');
        }
    }
};
