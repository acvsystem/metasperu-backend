import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
import crypto from 'crypto'; // Módulo nativo de Node.js para generar el Hash
import { lockStore as redis } from '../utils/lock-store.js';

const parsePositiveInt = (value, fallback, max = 1000) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
};

const buildPagination = (query, defaultPageSize = 100, maxPageSize = 1000) => {
    const page = parsePositiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = parsePositiveInt(query.pageSize, defaultPageSize, maxPageSize);
    const offset = (page - 1) * pageSize;
    return { page, pageSize, offset };
};

const hasPagination = (query) => query.page !== undefined || query.pageSize !== undefined;

const sectionColumnKey = (name = '') => name.toString().trim().replace(/\s+/g, '_').toLowerCase();

const escapeCsv = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const sendCsv = (res, fileName, rows, columns) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    res.write('\uFEFF');
    res.write(columns.map((column) => escapeCsv(column.header)).join(';') + '\n');

    rows.forEach((row) => {
        res.write(columns.map((column) => escapeCsv(row[column.key])).join(';') + '\n');
    });

    res.end();
};

const buildConteoFilters = (query) => {
    const where = [];
    const params = [];

    const filters = [
        { key: 'sku', sql: 's.sku', exact: true },
        { key: 'user', sql: 'u.username' },
        { key: 'usuario', sql: 'u.username' },
        { key: 'nombre_zona', sql: 'ze.nombre_zona' },
        { key: 'zona', sql: 'ze.nombre_zona' },
        { key: 'section_name', sql: 'sa.nombre_seccion', exact: true },
        { key: 'subzona', sql: 'sa.nombre_seccion', exact: true }
    ];

    filters.forEach(({ key, sql, exact }) => {
        const value = query[key];
        if (value === undefined || value === null || String(value).trim() === '') return;

        if (exact) {
            where.push(`UPPER(TRIM(${sql})) = ?`);
            params.push(String(value).trim().toUpperCase());
        } else {
            where.push(`${sql} LIKE ?`);
            params.push(`%${String(value).trim()}%`);
        }
    });

    const cantidad = query.total_cantidad ?? query.cantidad;
    if (cantidad !== undefined && cantidad !== null && String(cantidad).trim() !== '') {
        where.push('s.cantidad = ?');
        params.push(Number(cantidad));
    }

    return { where, params };
};

const normalizeFilterValues = (value) => {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || String(value).trim() === '') return [];
    return [value];
};

const sessionsWithSyncedStoreTotals = new Set();

const buildInventoryFilters = (query) => {
    const where = [];
    const params = [];
    let usesScanTotals = false;

    const filters = [
        'cCodigoBarra',
        'cCodigoBarra2',
        'cCodigoBarra3',
        'cReferencia',
        'cDescripcion',
        'cDepartamento',
        'cSeccion',
        'cFamilia',
        'cSubFamilia',
        'cTalla',
        'cColor',
        'cEsencia',
        'cStyleDescription',
        'cStyleDesc'
    ];

    filters.forEach((field) => {
        const value = query[field];
        if (value === undefined || value === null || String(value).trim() === '') return;

        const column = field === 'cStyleDesc' ? 'cStyleDescription' : field;
        where.push(`st.${column} LIKE ?`);
        params.push(`%${String(value).trim()}%`);
    });

    const scanTotalSql = 'COALESCE(st.cConteo, 0)';
    const diffSql = 'COALESCE(st.cTotalConteo, 0)';

    const conteoValue = query.cConteo;
    if (conteoValue !== undefined && conteoValue !== null && String(conteoValue).trim() !== '') {
        where.push(`${scanTotalSql} = ?`);
        params.push(Number(conteoValue));
        usesScanTotals = true;
    }

    const totalConteoValues = normalizeFilterValues(query.cTotalConteo);
    if (totalConteoValues.length) {
        const totalConteoWhere = [];
        usesScanTotals = true;

        totalConteoValues.forEach((rawValue) => {
            const value = String(rawValue || '').trim().toLowerCase();
            const numericValue = Number(rawValue);

            if (value === 'positivo') {
                totalConteoWhere.push(`${diffSql} > 0`);
            } else if (value === 'negativo') {
                totalConteoWhere.push(`${diffSql} < 0`);
            } else if (value === 'cero sin escaneo') {
                totalConteoWhere.push(`(${diffSql} = 0 AND ${scanTotalSql} = 0)`);
            } else if (value === 'cero con escaneo' || value === 'cero escaneo') {
                totalConteoWhere.push(`(${diffSql} = 0 AND ${scanTotalSql} > 0)`);
            } else if (Number.isFinite(numericValue)) {
                totalConteoWhere.push(`${diffSql} = ?`);
                params.push(numericValue);
            }
        });

        if (totalConteoWhere.length) {
            where.push(`(${totalConteoWhere.join(' OR ')})`);
        }
    }

    const numericFilters = ['cStock'];
    numericFilters.forEach((field) => {
        const value = query[field];
        if (value === undefined || value === null || String(value).trim() === '') return;

        where.push(`st.${field} = ?`);
        params.push(Number(value));
    });

    return { where, params, usesScanTotals };
};

const syncStoreScanTotals = async (sessionId, sessionCode) => {
    if (!sessionId || !sessionCode || sessionsWithSyncedStoreTotals.has(sessionCode)) return;

    await pool.execute(
        `UPDATE inventario_store st
         LEFT JOIN (
            SELECT
                product_codes.id,
                COALESCE(SUM(scan_by_sku.total_conteo), 0) AS scan_total
            FROM (
                SELECT id, cCodigoBarra AS sku
                FROM inventario_store
                WHERE cSessionCode = ?
                  AND cCodigoBarra IS NOT NULL
                  AND cCodigoBarra <> ''
                UNION ALL
                SELECT id, cCodigoBarra2 AS sku
                FROM inventario_store
                WHERE cSessionCode = ?
                  AND cCodigoBarra2 IS NOT NULL
                  AND cCodigoBarra2 <> ''
                UNION ALL
                SELECT id, cCodigoBarra3 AS sku
                FROM inventario_store
                WHERE cSessionCode = ?
                  AND cCodigoBarra3 IS NOT NULL
                  AND cCodigoBarra3 <> ''
            ) product_codes
            LEFT JOIN (
                SELECT sku, SUM(cantidad) AS total_conteo
                FROM inventario_escaneos
                WHERE sesion_id = ?
                GROUP BY sku
            ) scan_by_sku
                ON scan_by_sku.sku = product_codes.sku
            GROUP BY product_codes.id
         ) totals ON totals.id = st.id
         SET
            st.cConteo = COALESCE(totals.scan_total, 0),
            st.cTotalConteo = COALESCE(totals.scan_total, 0) - ABS(COALESCE(st.cStock, 0))
         WHERE st.cSessionCode = ?`,
        [sessionCode, sessionCode, sessionCode, sessionId, sessionCode]
    );

    sessionsWithSyncedStoreTotals.add(sessionCode);
};

const areaCaseSql = (sectionAlias = 'sa') => `
    CASE
        WHEN LOWER(REPLACE(TRIM(${sectionAlias}.nombre_seccion), ' ', '_')) = 'tester' THEN 'Tester'
        WHEN LOWER(REPLACE(TRIM(${sectionAlias}.nombre_seccion), ' ', '_')) = 'reconteo' THEN 'Reconteo'
        WHEN LOWER(REPLACE(TRIM(${sectionAlias}.nombre_seccion), ' ', '_')) IN ('otros', 'otras_zonas') THEN 'Otros'
        WHEN LOWER(REPLACE(TRIM(${sectionAlias}.nombre_seccion), ' ', '_')) = 'ac' THEN 'Venta'
        WHEN LOWER(REPLACE(TRIM(${sectionAlias}.nombre_seccion), ' ', '_')) = 'defectuoso' THEN 'Defectuoso'
        WHEN UPPER(LEFT(TRIM(${sectionAlias}.nombre_seccion), 1)) = 'A' THEN 'Almacén'
        WHEN UPPER(LEFT(TRIM(${sectionAlias}.nombre_seccion), 1)) IN ('M', 'P', 'G') THEN 'Venta'
        ELSE 'Otros'
    END
`;

const attachSectionTotalsToInventoryRows = async (sessionId, inventoryRows = []) => {
    if (!sessionId || inventoryRows.length === 0) return inventoryRows;

    const codeToRows = new Map();

    inventoryRows.forEach((row) => {
        [row.cCodigoBarra, row.cCodigoBarra2, row.cCodigoBarra3]
            .filter(Boolean)
            .forEach((code) => {
                const key = String(code);
                if (!codeToRows.has(key)) codeToRows.set(key, []);
                codeToRows.get(key).push(row);
            });
    });

    const codes = [...codeToRows.keys()];
    if (codes.length === 0) return inventoryRows;

    const BATCH = 3000;

    for (let i = 0; i < codes.length; i += BATCH) {
        const batchCodes = codes.slice(i, i + BATCH);

        const [sectionRows] = await pool.query(
            `SELECT
                es.sku,
                sa.nombre_seccion,
                COALESCE(SUM(es.cantidad), 0) AS total_cantidad
             FROM inventario_escaneos es
             LEFT JOIN secciones_asginados sa ON sa.id = es.seccion_id
             WHERE es.sesion_id = ? AND es.sku IN (?)
             GROUP BY es.sku, sa.nombre_seccion`,
            [sessionId, batchCodes]
        );

        sectionRows.forEach((sectionRow) => {
            const key = sectionColumnKey(sectionRow.nombre_seccion || 'DESCONOCIDO');
            const rows = codeToRows.get(String(sectionRow.sku)) || [];

            rows.forEach((row) => {
                if (key) {
                    row[key] = Number(row[key] || 0) + Number(sectionRow.total_cantidad || 0);
                }
            });
        });
    }

    return inventoryRows;
};

const attachScanTotalsToInventoryRows = async (sessionId, inventoryRows = []) => {
    if (!sessionId || inventoryRows.length === 0) return inventoryRows;

    const codeToRows = new Map();

    inventoryRows.forEach((row) => {
        [row.cCodigoBarra, row.cCodigoBarra2, row.cCodigoBarra3]
            .filter(Boolean)
            .forEach((code) => {
                const key = String(code);
                if (!codeToRows.has(key)) codeToRows.set(key, []);
                codeToRows.get(key).push(row);
            });
    });

    const codes = [...codeToRows.keys()];
    if (codes.length === 0) return inventoryRows;

    const rowTotals = new Map(inventoryRows.map((row) => [row.id, 0]));

    const BATCH = 3000;

    for (let i = 0; i < codes.length; i += BATCH) {
        const batchCodes = codes.slice(i, i + BATCH);

        const [scanRows] = await pool.query(
            `SELECT sku, COALESCE(SUM(cantidad), 0) AS total_conteo
             FROM inventario_escaneos
             WHERE sesion_id = ? AND sku IN (?)
             GROUP BY sku`,
            [sessionId, batchCodes]
        );

        scanRows.forEach((scanRow) => {
            const rows = codeToRows.get(String(scanRow.sku)) || [];
            rows.forEach((row) => {
                rowTotals.set(row.id, (rowTotals.get(row.id) || 0) + Number(scanRow.total_conteo || 0));
            });
        });
    }

    inventoryRows.forEach((row) => {
        const total = rowTotals.get(row.id) || Number(row.cConteo || 0);
        row.cConteo = total;
        row.cTotalConteo = total - Math.abs(Number(row.cStock || 0));
    });

    return inventoryRows;
};

export const createSession = async (req, res) => {
    const { tienda_id, assigned_section } = req.body;
    const userId = req.user.id;

    // --- ARQUITECTURA DE DEDUPLICACIÓN (CREATE SESSION LOCK) ---
    // Bloqueamos por la combinación de Tienda y Usuario creador.
    // Evita que el mismo usuario abra múltiples sesiones en la misma tienda en el mismo instante.
    const lockKey = `lock:session:create:${tienda_id}:${userId}`;

    try {
        // Ponemos un bloqueo de 4 segundos. Tiempo suficiente para resolver múltiples inserts
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 4);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento de creación de sesión duplicada bloqueado para usuario ${userId} en tienda ${tienda_id}`);
            return res.status(429).json({
                message: 'Ya se está procesando una solicitud de creación de sesión. Por favor, espere.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const sessionCode = Math.random().toString(36).substring(2, 8).toUpperCase();

        const [result] = await pool.execute(
            'INSERT INTO inventario_sesiones (codigo_sesion, tienda_id, estado, creado_por) VALUES (?, ?, ?, ?)',
            [sessionCode, tienda_id, 'ACTIVO', userId]
        );

        if (assigned_section && assigned_section.length > 0) {
            // Nota de optimización: Podrías cambiar esto luego a un solo INSERT masivo, 
            // pero mantenemos tus promesas actuales ejecutándose de forma segura.
            const insertPromises = assigned_section.map((section) => {
                return pool.execute(
                    'INSERT INTO secciones_asginados (codigo_sesion, seccion_id_fk, nombre_seccion) VALUES (?, ?, ?)',
                    [
                        sessionCode,
                        section.seccion_id || null,
                        section.nombre_seccion || 'Sin Nombre'
                    ]
                );
            });

            await Promise.all(insertPromises);
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // Como todo salió bien y las inserciones terminaron, borramos el bloqueo.
        await redis.del(lockKey);

        res.status(201).json({
            id: result.insertId,
            session_code: sessionCode,
            message: 'Sesión de inventario iniciada'
        });

    } catch (error) {
        // Si la base de datos falla (por ejemplo, timeout en Promise.all), 
        // limpiamos Redis para permitir que el usuario lo intente de nuevo de forma manual.
        await redis.del(lockKey);
        console.error("Error en createSession:", error);
        res.status(500).json({ message: 'Error al crear sesión', error: error.message });
    }
};

export const registerScan = async (req, res) => {
    const { session_code, sku, quantity = 1 } = req.body;
    const scannedBy = req.user.id;

    const lockKey = `lock:scan:${session_code}:${sku}:${quantity}:${scannedBy}`;
    console.log(lockKey);
    try {
        // Ponemos un bloqueo de respaldo muy corto (500 milisegundos)
        // PX indica milisegundos en lugar de segundos (EX)
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'PX', 500);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Clon de ráfaga bloqueado para SKU: ${sku}`);
            return res.status(429).json({ message: 'Evitando duplicidad por ráfaga.' });
        }

        // 1. Validar Sesión
        const [session] = await pool.execute(
            'SELECT id FROM inventario_sesiones WHERE codigo_sesion = ? AND estado = "ACTIVO"',
            [session_code]
        );

        if (session.length === 0) {
            await redis.del(lockKey); // Liberar si falla
            return res.status(404).json({ message: 'Sesión no encontrada' });
        }

        const sessionId = session[0].id;

        // 2. Insertar en MySQL
        await pool.execute(
            'INSERT INTO inventario_escaneos (sesion_id, sku, cantidad, escaneado_por) VALUES (?, ?, ?, ?)',
            [sessionId, sku, quantity, scannedBy]
        );

        // --- ¡EL TRUCO AQUÍ! ---
        // Como MySQL ya terminó de guardar, borramos el candado de inmediato.
        // El espacio queda libre para el siguiente pistoleo en el próximo milisegundo.
        await redis.del(lockKey);

        // 3. Socket.io
        req.io.to(session_code).emit('new-scan-received', { sku, quantity, scanned_at: new Date() });

        res.status(200).json({ message: 'Producto registrado correctamente' });

    } catch (error) {
        await redis.del(lockKey); // Liberar siempre en caso de error
        res.status(500).json({ message: 'Error', error: error.message });
    }
};

export const syncBulkScans = async (req, res) => {
    const { session_code, scans } = req.body; // 'scans' es un array de objetos
    const userId = req.user.id;

    if (!scans || scans.length === 0) {
        return res.status(400).json({ error: 'No se proporcionaron datos para escanear.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (REDIS LOCK) ---
    // 1. Convertimos el array de escaneos a un string único y generamos su Hash MD5
    const scansString = JSON.stringify(scans);
    const scansHash = crypto.createHash('md5').update(scansString).digest('hex');

    // 2. Creamos la clave de bloqueo única para esta ráfaga
    const lockKey = `lock:sync:${session_code}:${scansHash}`;


    try {
        // 3. Intentamos adquirir el bloqueo atómico en Redis.
        // 'NX' = Solo si no existe. 'EX' 5 = Expira automáticamente en 5 segundos.
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 5);
        console.log(lockAcquired);
        if (!lockAcquired) {
            // Si otra petición idéntica ya tomó el candado en este mismo milisegundo, la descartamos.
            console.warn(`[DEDUPLICACIÓN] Petición duplicada bloqueada para la sesión: ${session_code}`);
            return res.status(429).json({
                error: 'Esta solicitud ya está siendo procesada. Evitando registros duplicados.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [session] = await pool.execute(
            'SELECT id FROM inventario_sesiones WHERE codigo_sesion = ? AND estado = "ACTIVO"',
            [session_code]
        );

        if (session.length === 0) {
            // Si la sesión no es válida, liberamos el candado inmediatamente para no bloquear futuros envíos buenos
            await redis.del(lockKey);
            return res.status(500).json({ error: 'Sesión no válida o finalizada' });
        }

        const sessionId = session[0].id;

        // Preparamos los datos para una sola inserción masiva (optimización SQL)
        const values = scans.map(s => [sessionId, s.sku, s.quantity, userId, s.scanned_at, s.seccion_id]);

        await pool.query(
            'INSERT INTO inventario_escaneos (sesion_id, sku, cantidad, escaneado_por, fecha_escaneo, seccion_id) VALUES ?',
            [values]
        );

        // Notificamos al Dashboard que llegaron nuevos datos
        getIO().to(session_code).emit('update_totals', {
            count: scans.length,
            last_scans: scans.slice(-5) // enviamos los últimos 5 para previsualización
        });

        console.log(`[EXITO] Guardados ${scans.length} escaneos para la sesión ${session_code}`);
        res.status(200).json({ message: 'Sincronización exitosa' });

    } catch (error) {
        // Si el proceso truena a mitad de camino por culpa de la base de datos o socket, 
        // borramos el candado de Redis para que la app móvil/malla pueda reintentar de inmediato.
        await redis.del(lockKey);
        console.error('Error crítico en syncBulkScans:', error);
        res.status(500).json({ error: error.message });
    }
};


export const getAssignedSection = async (req, res) => {
    const { session_code } = req.params;

    if (!session_code) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    try {
        // Regresamos al SELECT * para asegurar compatibilidad total con tus columnas actuales
        const query = `
            SELECT * FROM secciones_asginados WHERE codigo_sesion = ?;
        `;

        const [sections] = await pool.execute(query, [session_code]);

        res.status(200).json(sections);

    } catch (error) {
        console.error("Error en getAssignedSection:", error);
        res.status(500).json({ error: error.message });
    }
};

export const getSessionSummary = async (req, res) => {
    const { session_code } = req.params;

    if (!session_code) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    try {
        // --- PASO 1: TRAER INFO DE LA SESIÓN (MINI-QUERY RÁPIDA) ---
        // Obtenemos el ID numérico interno para no castigar a la query grande con JOINs de texto
        const [sessionInfo] = await pool.execute(
            `SELECT sess.id, sess.tienda_id, t.nombre_tienda, sess.estado, sess.creado_por, u.username 
             FROM inventario_sesiones sess
             INNER JOIN tiendas t ON t.id = sess.tienda_id
             INNER JOIN usuarios u ON u.id = sess.creado_por
             WHERE sess.codigo_sesion = ?`,
            [session_code]
        );

        if (sessionInfo.length === 0) {
            return res.status(404).json({ message: 'Sesión no encontrada.' });
        }

        const sessionData = sessionInfo[0];

        // --- PASO 2: LISTADO COMPLETO DE LOS 10,000 REGISTROS (SIN GROUP BY) ---
        // Al quitar el GROUP BY, te traerá cada escaneo individual (los 10,000 exactos).
        // Traemos "1" en veces_escaneado y la cantidad normal de la fila para mantener tu compatibilidad de frontend.
        const summaryQuery = `
            SELECT 
                s.id,
                s.sku, 
                s.cantidad as total_cantidad,
                s.id as ultimo_escaneo_id, 
                1 as veces_escaneado,
                s.seccion_id as seccion_id,
                u.username as usuario
            FROM inventario_escaneos s
            INNER JOIN usuarios u ON s.escaneado_por = u.id
            WHERE s.sesion_id = ?
            ORDER BY s.id DESC
        `;

        const [summary] = await pool.execute(summaryQuery, [sessionData.id]);

        // Retornamos la respuesta con los 10k registros íntegros
        res.status(200).json({
            session: sessionData,
            products: summary
        });

    } catch (error) {
        console.error("Error en getSessionSummary:", error);
        res.status(500).json({ message: 'Error al obtener el resumen', error: error.message });
    }
};

export const getSessionSummaryv2 = async (req, res) => {
    const { session_code } = req.params;
    const paginated = hasPagination(req.query);
    const { page, pageSize, offset } = buildPagination(req.query, 100, 1000);

    if (!session_code) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    try {
        // --- PASO 1: TRAER INFO DE LA SESIÓN (MINI-QUERY RÁPIDA) ---
        // Obtenemos el ID numérico interno para no castigar a la query grande con JOINs de texto
        const [sessionInfo] = await pool.execute(
            `SELECT sess.id, sess.tienda_id, t.nombre_tienda, sess.estado, sess.creado_por, u.username 
             FROM inventario_sesiones sess
             INNER JOIN tiendas t ON t.id = sess.tienda_id
             INNER JOIN usuarios u ON u.id = sess.creado_por
             WHERE sess.codigo_sesion = ?`,
            [session_code]
        );

        if (sessionInfo.length === 0) {
            return res.status(404).json({ message: 'Sesión no encontrada.' });
        }

        const sessionData = sessionInfo[0];
        const { where: filterWhere, params: filterParams } = buildConteoFilters(req.query);
        const filterSql = filterWhere.length ? ` AND ${filterWhere.join(' AND ')}` : '';

        const [totalsRows] = await pool.execute(
            `SELECT 
                COUNT(*) AS total_rows,
                COUNT(DISTINCT s.sku) AS unique_skus,
                COALESCE(SUM(s.cantidad), 0) AS total_unidades
             FROM inventario_escaneos s
             INNER JOIN usuarios u ON s.escaneado_por = u.id
             LEFT JOIN secciones_asginados sa ON sa.id = s.seccion_id
             LEFT JOIN zonas_seccion zs ON zs.seccion_id_fk = sa.seccion_id_fk
             LEFT JOIN zonas_escaneos ze ON ze.zona_id = zs.zona_id_fk
             WHERE s.sesion_id = ? ${filterSql}`,
            [sessionData.id, ...filterParams]
        );

        const totals = {
            total_rows: Number(totalsRows[0]?.total_rows || 0),
            unique_skus: Number(totalsRows[0]?.unique_skus || 0),
            total_unidades: Number(totalsRows[0]?.total_unidades || 0),
            total_stock: 0,
            total_diferencia: 0
        };

        if (filterWhere.length) {
            const [filteredStockRows] = await pool.execute(
                `SELECT COALESCE(SUM(ABS(matched_scans.cStock)), 0) AS total_stock
                 FROM (
                    SELECT DISTINCT filtered_scans.scan_id, product_codes.id, product_codes.cStock
                    FROM (
                        SELECT s.id AS scan_id, s.sku AS raw_sku, TRIM(LEADING '0' FROM TRIM(s.sku)) AS sku
                        FROM inventario_escaneos s
                        INNER JOIN usuarios u ON s.escaneado_por = u.id
                        LEFT JOIN secciones_asginados sa ON sa.id = s.seccion_id
                        LEFT JOIN zonas_seccion zs ON zs.seccion_id_fk = sa.seccion_id_fk
                        LEFT JOIN zonas_escaneos ze ON ze.zona_id = zs.zona_id_fk
                        WHERE s.sesion_id = ? ${filterSql}
                    ) filtered_scans
                    INNER JOIN (
                        SELECT st.id, st.cStock, TRIM(LEADING '0' FROM TRIM(st.cCodigoBarra)) AS sku
                        FROM inventario_store st
                        WHERE st.cSessionCode = ?
                          AND st.cCodigoBarra IS NOT NULL
                          AND TRIM(st.cCodigoBarra) <> ''
                        UNION ALL
                        SELECT st.id, st.cStock, TRIM(LEADING '0' FROM TRIM(st.cCodigoBarra2)) AS sku
                        FROM inventario_store st
                        WHERE st.cSessionCode = ?
                          AND st.cCodigoBarra2 IS NOT NULL
                          AND TRIM(st.cCodigoBarra2) <> ''
                        UNION ALL
                        SELECT st.id, st.cStock, TRIM(LEADING '0' FROM TRIM(st.cCodigoBarra3)) AS sku
                        FROM inventario_store st
                        WHERE st.cSessionCode = ?
                          AND st.cCodigoBarra3 IS NOT NULL
                          AND TRIM(st.cCodigoBarra3) <> ''
                    ) product_codes ON product_codes.sku = filtered_scans.sku
                 ) matched_scans`,
                [sessionData.id, ...filterParams, session_code, session_code, session_code]
            );

            totals.total_stock = Number(filteredStockRows[0]?.total_stock || 0);
        } else {
            const [stockRows] = await pool.execute(
                `SELECT COALESCE(SUM(cStock), 0) AS total_stock
                 FROM inventario_store
                 WHERE cSessionCode = ?`,
                [session_code]
            );
            totals.total_stock = Number(stockRows[0]?.total_stock || 0);
        }

        totals.total_diferencia = totals.total_unidades - totals.total_stock;

        const summaryQuery = `
            SELECT 
			    s.id,
                s.sku, 
                s.cantidad as total_cantidad,
                s.id as ultimo_escaneo_id, 
                1 as veces_escaneado,
                s.seccion_id as seccion_id,
                u.username as usuario,
                ze.nombre_zona
            FROM inventario_escaneos s
            INNER JOIN usuarios u ON s.escaneado_por = u.id
            LEFT JOIN secciones_asginados sa ON sa.id = s.seccion_id
            LEFT JOIN zonas_seccion zs ON zs.seccion_id_fk = sa.seccion_id_fk
            LEFT JOIN zonas_escaneos ze ON ze.zona_id = zs.zona_id_fk
            WHERE s.sesion_id = ? ${filterSql}
            ORDER BY s.id DESC
            ${paginated ? `LIMIT ${pageSize} OFFSET ${offset}` : ''}
        `;

        const [summary] = await pool.execute(summaryQuery, [sessionData.id, ...filterParams]);

        res.status(200).json({
            session: sessionData,
            products: summary,
            totals,
            pagination: paginated ? {
                page,
                pageSize,
                totalRows: totals.total_rows,
                totalPages: Math.ceil(totals.total_rows / pageSize)
            } : undefined
        });

    } catch (error) {
        console.error("Error en getSessionSummary:", error);
        res.status(500).json({ message: 'Error al obtener el resumen', error: error.message });
    }
};

export const getStores = async (req, res) => {
    try {
        // Seleccionamos id y nombre de la tabla tiendas
        const [rows] = await pool.query('SELECT id, serie, nombre_tienda FROM tiendas ORDER BY nombre_tienda ASC');

        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


export const getSessions = async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT s.codigo_sesion,s.tienda_id,t.nombre_tienda,s.creado_por,u.username,s.fecha_inicio,s.estado FROM inventario_sesiones s 
            INNER JOIN tiendas t on t.id = s.tienda_id
            INNER JOIN usuarios u on u.id = s.creado_por
            ORDER BY s.fecha_inicio DESC;
        `);

        res.json(rows);
    } catch (error) {
        res.status(500).json({
            message: 'Error al obtener las sesiones',
            error: error.message
        });
    }
};


// Listar sesiones activas para retomar
export const getActiveSessions = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.id, s.codigo_sesion, s.tienda_id,t.nombre_tienda, s.creado_por, u.username, 
            (SELECT COUNT(DISTINCT sku) FROM inventario_escaneos e WHERE e.id = s.id) as total_skus
            FROM inventario_sesiones s 
            INNER JOIN tiendas t on t.id = s.tienda_id
            INNER JOIN usuarios u on u.id = s.creado_por
            WHERE s.estado = 'ACTIVO' 
            ORDER BY s.creado_por DESC`
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


export const getInventoryReqStore = async (req, res) => {
    const { session_code, serie_store } = req.query;
    const paginated = hasPagination(req.query);
    const summaryOnly = req.query.summaryOnly === 'true' || req.query.summaryOnly === true;
    const includeFilterOptions = req.query.includeFilterOptions === 'true' || req.query.includeFilterOptions === true;
    const skipSectionTotals = req.query.skipSectionTotals === 'true' || req.query.skipSectionTotals === true;
    const { page, pageSize, offset } = buildPagination(req.query, 100, 1000);
    let objResponse = { success: true };
    console.log('getInventoryReqStore - Parámetros recibidos:', { session_code, serie_store });
    if (!session_code || !serie_store) {
        return res.status(400).json({ error: "Faltan parámetros requeridos: session_code y serie_store" });
    }

    try {
        // OPTIMIZACIÓN 1: Traemos SOLO la columna necesaria en lugar de SELECT *
        const [sesionRows] = await pool.execute(
            `SELECT id, inventario_registrado FROM inventario_sesiones WHERE codigo_sesion = ?`,
            [session_code]
        );

        // Una forma mucho más limpia y segura de validar si el registro existe en JS
        const sesion = sesionRows[0];
        const sessionId = sesion?.id;
        const invExist = sesion?.inventario_registrado || 0;

        console.log('getInventoryReqStore - Existencia:', invExist);

        if (sesionRows.length > 0 && invExist) {
            const { where: inventoryWhere, params: inventoryParams, usesScanTotals } = buildInventoryFilters(req.query);
            const inventoryWhereSql = inventoryWhere.length ? ` AND ${inventoryWhere.join(' AND ')}` : '';
            const hasInventoryFilters = inventoryWhere.length > 0;

            if (usesScanTotals || hasInventoryFilters) {
                await syncStoreScanTotals(sessionId, session_code);
            }

            let stockSummaryRows;
            let totalConteo = 0;

            if (!hasInventoryFilters) {
                [stockSummaryRows] = await pool.execute(
                    `SELECT
                        COUNT(*) AS total_rows,
                        COALESCE(SUM(st.cStock), 0) AS total_stock
                     FROM inventario_store st
                     WHERE st.cSessionCode = ?`,
                    [session_code]
                );

                const [scanSummaryRows] = await pool.execute(
                    `SELECT COALESCE(SUM(es.cantidad), 0) AS total_conteo
                     FROM inventario_escaneos es
                     WHERE es.sesion_id = ?`,
                    [sessionId]
                );
                totalConteo = Number(scanSummaryRows[0]?.total_conteo || 0);
            } else {
                [stockSummaryRows] = await pool.execute(
                    `SELECT
                        COUNT(*) AS total_rows,
                        COALESCE(SUM(ABS(st.cStock)), 0) AS total_stock,
                        COALESCE(SUM(st.cConteo), 0) AS total_conteo
                     FROM inventario_store st
                     WHERE st.cSessionCode = ? ${inventoryWhereSql}`,
                    [session_code, ...inventoryParams]
                );
                totalConteo = Number(stockSummaryRows[0]?.total_conteo || 0);
            }

            const totalStock = Number(stockSummaryRows[0]?.total_stock || 0);

            objResponse['codigo_sesion'] = session_code;
            objResponse['summary'] = {
                total_rows: Number(stockSummaryRows[0]?.total_rows || 0),
                total_stock: totalStock,
                total_conteo: totalConteo,
                total_diferencia: totalConteo - totalStock
            };

            if (includeFilterOptions) {
                const [sectionOptions] = await pool.execute(
                    `SELECT id, seccion_id_fk, nombre_seccion
                     FROM secciones_asginados
                     WHERE codigo_sesion = ?
                     ORDER BY nombre_seccion ASC`,
                    [session_code]
                );

                const [filterRows] = await pool.execute(
                    `SELECT 'cDepartamento' AS field_name, cDepartamento AS field_value
                     FROM inventario_store
                     WHERE cSessionCode = ? AND cDepartamento IS NOT NULL AND cDepartamento <> ''
                     GROUP BY cDepartamento
                     UNION ALL
                     SELECT 'cSeccion' AS field_name, cSeccion AS field_value
                     FROM inventario_store
                     WHERE cSessionCode = ? AND cSeccion IS NOT NULL AND cSeccion <> ''
                     GROUP BY cSeccion
                     UNION ALL
                     SELECT 'cFamilia' AS field_name, cFamilia AS field_value
                     FROM inventario_store
                     WHERE cSessionCode = ? AND cFamilia IS NOT NULL AND cFamilia <> ''
                     GROUP BY cFamilia
                     UNION ALL
                     SELECT 'cSubFamilia' AS field_name, cSubFamilia AS field_value
                     FROM inventario_store
                     WHERE cSessionCode = ? AND cSubFamilia IS NOT NULL AND cSubFamilia <> ''
                     GROUP BY cSubFamilia`,
                    [session_code, session_code, session_code, session_code]
                );

                const filterOptionMap = filterRows.reduce((acc, row) => {
                    if (!acc[row.field_name]) acc[row.field_name] = [];
                    acc[row.field_name].push(String(row.field_value).trim());
                    return acc;
                }, {});

                objResponse['filterOptions'] = {
                    sections: sectionOptions,
                    cDepartamento: (filterOptionMap.cDepartamento || []).sort(),
                    cSeccion: (filterOptionMap.cSeccion || []).sort(),
                    cFamilia: (filterOptionMap.cFamilia || []).sort(),
                    cSubFamilia: (filterOptionMap.cSubFamilia || []).sort()
                };
            }

            if (!summaryOnly) {
                const inventoryQuery = `
                    SELECT 
                        st.id, st.cSessionCode, st.codigo_sesion, st.cCodigoTienda, st.cCodigoArticulo, st.cReferencia,
                        st.cCodigoBarra, st.cCodigoBarra2, st.cCodigoBarra3, st.cDescripcion, st.cDepartamento,
                        st.cSeccion, st.cFamilia, st.cSubFamilia, st.cTalla, st.cColor, st.cEsencia,
                        st.cStyleDescription, st.cStyleDescription AS cStyleDesc, st.cStock, st.cTemporada,
                        COALESCE(st.cConteo, 0) AS cConteo,
                        COALESCE(st.cTotalConteo, 0) AS cTotalConteo,
                        st.checking
                    FROM inventario_store st
                    WHERE st.cSessionCode = ? ${inventoryWhereSql}
                    ORDER BY st.id ASC
                    ${paginated ? `LIMIT ${pageSize} OFFSET ${offset}` : ''}
                `;

                const [inventario_store] = await pool.execute(inventoryQuery, [session_code, ...inventoryParams]);
                await attachScanTotalsToInventoryRows(sessionId, inventario_store);
                if (!skipSectionTotals) {
                    await attachSectionTotalsToInventoryRows(sessionId, inventario_store);
                }

                objResponse['inventario'] = inventario_store;
                objResponse['pagination'] = paginated ? {
                    page,
                    pageSize,
                    totalRows: objResponse['summary'].total_rows,
                    totalPages: Math.ceil(objResponse['summary'].total_rows / pageSize)
                } : undefined;
            }
        } else {
            // Si no existe, disparamos el Socket de la Pocket/Tienda de forma normal
            getIO().to(serie_store).emit('req_inv_store', { session_code: session_code, serie: serie_store });
        }

        return res.status(200).json(objResponse);

    } catch (error) {
        console.error("Error en getInventoryReqStore:", error);
        return res.status(500).json({ error: "Error interno del servidor", details: error.message });
    }
};

export const exportSessionSummaryCsv = async (req, res) => {
    const { session_code } = req.params;

    if (!session_code) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    try {
        const [sessionInfo] = await pool.execute(
            `SELECT id FROM inventario_sesiones WHERE codigo_sesion = ?`,
            [session_code]
        );

        if (sessionInfo.length === 0) {
            return res.status(404).json({ message: 'Sesión no encontrada.' });
        }

        const { where: filterWhere, params: filterParams } = buildConteoFilters(req.query);
        const filterSql = filterWhere.length ? ` AND ${filterWhere.join(' AND ')}` : '';

        const [rows] = await pool.execute(
            `SELECT 
                s.sku AS CODBARRAS,
                u.username AS USUARIO,
                ze.nombre_zona AS ZONA,
                sa.nombre_seccion AS SUBZONA,
                s.cantidad AS UNIDADES
             FROM inventario_escaneos s
             INNER JOIN usuarios u ON s.escaneado_por = u.id
             LEFT JOIN secciones_asginados sa ON sa.id = s.seccion_id
             LEFT JOIN zonas_seccion zs ON zs.seccion_id_fk = sa.seccion_id_fk
             LEFT JOIN zonas_escaneos ze ON ze.zona_id = zs.zona_id_fk
             WHERE s.sesion_id = ? ${filterSql}
             ORDER BY s.id DESC`,
            [sessionInfo[0].id, ...filterParams]
        );

        return sendCsv(res, `conteo_${session_code}.csv`, rows, [
            { key: 'CODBARRAS', header: 'CODBARRAS' },
            { key: 'USUARIO', header: 'USUARIO' },
            { key: 'ZONA', header: 'ZONA' },
            { key: 'SUBZONA', header: 'SUBZONA' },
            { key: 'UNIDADES', header: 'UNIDADES' }
        ]);
    } catch (error) {
        console.error('Error en exportSessionSummaryCsv:', error);
        return res.status(500).json({ message: 'Error al exportar conteo', error: error.message });
    }
};

export const getSessionStatistics = async (req, res) => {
    const { session_code } = req.params;

    if (!session_code) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    try {
        const [sessionInfo] = await pool.execute(
            `SELECT id FROM inventario_sesiones WHERE codigo_sesion = ?`,
            [session_code]
        );

        const sessionId = sessionInfo[0]?.id;
        if (!sessionId) {
            return res.status(404).json({ message: 'Sesión no encontrada.' });
        }

        const [byUser] = await pool.execute(
            `SELECT
                COALESCE(NULLIF(TRIM(u.username), ''), 'SIN USUARIO') AS label,
                COALESCE(SUM(s.cantidad), 0) AS value
             FROM inventario_escaneos s
             LEFT JOIN usuarios u ON u.id = s.escaneado_por
             WHERE s.sesion_id = ?
             GROUP BY label
             ORDER BY value DESC`,
            [sessionId]
        );

        const [bySection] = await pool.execute(
            `SELECT
                COALESCE(NULLIF(TRIM(sa.nombre_seccion), ''), 'DESCONOCIDO') AS label,
                COALESCE(SUM(s.cantidad), 0) AS value
             FROM inventario_escaneos s
             LEFT JOIN secciones_asginados sa ON sa.id = s.seccion_id
             WHERE s.sesion_id = ?
             GROUP BY label
             ORDER BY value DESC`,
            [sessionId]
        );

        return res.status(200).json({ byUser, bySection });
    } catch (error) {
        console.error('Error en getSessionStatistics:', error);
        return res.status(500).json({ message: 'Error al obtener estadísticas', error: error.message });
    }
};

export const exportInventoryStoreCsv = async (req, res) => {
    const { session_code, serie_store } = req.query;

    if (!session_code || !serie_store) {
        return res.status(400).json({ error: "Faltan parámetros requeridos: session_code y serie_store" });
    }

    try {
        const [sesionRows] = await pool.execute(
            `SELECT id FROM inventario_sesiones WHERE codigo_sesion = ?`,
            [session_code]
        );

        if (sesionRows.length === 0) {
            return res.status(404).json({ message: 'Sesión no encontrada.' });
        }

        const sessionId = sesionRows[0].id;
        const { where: inventoryWhere, params: inventoryParams, usesScanTotals } = buildInventoryFilters(req.query);
        const inventoryWhereSql = inventoryWhere.length ? ` AND ${inventoryWhere.join(' AND ')}` : '';

        if (usesScanTotals) {
            await syncStoreScanTotals(sessionId, session_code);
        }

        const [rows] = await pool.execute(
            `SELECT 
                st.id, st.cCodigoBarra, st.cCodigoBarra2, st.cCodigoBarra3, st.cReferencia,
                st.cDescripcion, st.cDepartamento, st.cSeccion, st.cFamilia, st.cSubFamilia,
                st.cTalla, st.cColor, st.cEsencia, st.cStyleDescription AS cStyleDesc,
                st.cStock,
                COALESCE(st.cConteo, 0) AS cConteo,
                COALESCE(st.cTotalConteo, 0) AS cTotalConteo
             FROM inventario_store st
             WHERE st.cSessionCode = ? ${inventoryWhereSql}
             ORDER BY st.id ASC`,
            [session_code, ...inventoryParams]
        );

        await attachScanTotalsToInventoryRows(sessionId, rows);
        await attachSectionTotalsToInventoryRows(sessionId, rows);

        const sectionColumns = [...new Set(
            Object.keys(rows.reduce((acc, row) => ({ ...acc, ...row }), {}))
                .filter((key) => ![
                    'id', 'cCodigoBarra', 'cCodigoBarra2', 'cCodigoBarra3', 'cReferencia',
                    'cDescripcion', 'cDepartamento', 'cSeccion', 'cFamilia', 'cSubFamilia',
                    'cTalla', 'cColor', 'cEsencia', 'cStyleDesc', 'cStock', 'cConteo', 'cTotalConteo'
                ].includes(key))
        )].sort();

        const columns = [
            { key: 'cCodigoBarra', header: 'CODIGOBARRAS' },
            { key: 'cCodigoBarra2', header: 'CODIGOBARRAS2' },
            { key: 'cCodigoBarra3', header: 'CODIGOBARRAS3' },
            { key: 'cReferencia', header: 'REFERENCIA' },
            { key: 'cDescripcion', header: 'DESCRIPCION' },
            { key: 'cDepartamento', header: 'DEPARTAMENTO' },
            { key: 'cSeccion', header: 'SECCION' },
            { key: 'cFamilia', header: 'FAMILIA' },
            { key: 'cSubFamilia', header: 'SUBFAMILIA' },
            { key: 'cTalla', header: 'TALLA' },
            { key: 'cColor', header: 'COLOR' },
            { key: 'cEsencia', header: 'ESENCIA' },
            { key: 'cStyleDesc', header: 'STYLEDESCRIPTION' },
            { key: 'cStock', header: 'STOCK' },
            { key: 'cConteo', header: 'CONTEO' },
            { key: 'cTotalConteo', header: 'DIFERENCIA' },
            ...sectionColumns.map((key) => ({ key, header: key.toUpperCase() }))
        ];

        return sendCsv(res, `cruce_inventario_${session_code}.csv`, rows, columns);
    } catch (error) {
        console.error('Error en exportInventoryStoreCsv:', error);
        return res.status(500).json({ message: 'Error al exportar inventario', error: error.message });
    }
};

export const getProductsWithoutDisplay = async (req, res) => {
    const { session_code, sourceArea = 'Almacén', targetArea = 'Venta' } = req.query;
    const { page, pageSize, offset } = buildPagination(req.query, 100, 1000);

    if (!session_code) {
        return res.status(400).json({ error: 'El código de sesión es requerido.' });
    }

    try {
        const [sesionRows] = await pool.execute(
            `SELECT id FROM inventario_sesiones WHERE codigo_sesion = ?`,
            [session_code]
        );

        if (sesionRows.length === 0) {
            return res.status(404).json({ message: 'Sesión no encontrada.' });
        }

        const sessionId = sesionRows[0].id;
        const areaSql = areaCaseSql('sa');
        const areaTotalsSql = `
            SELECT
                product_codes.id,
                SUM(CASE WHEN scan_area.area = ? THEN scan_area.total_conteo ELSE 0 END) AS source_qty,
                SUM(CASE WHEN scan_area.area = ? THEN scan_area.total_conteo ELSE 0 END) AS target_qty
            FROM (
                SELECT id, cCodigoBarra AS sku
                FROM inventario_store
                WHERE cSessionCode = ?
                  AND cCodigoBarra IS NOT NULL
                  AND cCodigoBarra <> ''
                UNION ALL
                SELECT id, cCodigoBarra2 AS sku
                FROM inventario_store
                WHERE cSessionCode = ?
                  AND cCodigoBarra2 IS NOT NULL
                  AND cCodigoBarra2 <> ''
                UNION ALL
                SELECT id, cCodigoBarra3 AS sku
                FROM inventario_store
                WHERE cSessionCode = ?
                  AND cCodigoBarra3 IS NOT NULL
                  AND cCodigoBarra3 <> ''
            ) product_codes
            INNER JOIN (
                SELECT
                    es.sku,
                    ${areaSql} AS area,
                    SUM(es.cantidad) AS total_conteo
                FROM inventario_escaneos es
                LEFT JOIN secciones_asginados sa ON sa.id = es.seccion_id
                WHERE es.sesion_id = ?
                GROUP BY es.sku, area
            ) scan_area ON scan_area.sku = product_codes.sku
            GROUP BY product_codes.id
        `;

        const areaParams = [
            sourceArea,
            targetArea,
            session_code,
            session_code,
            session_code,
            sessionId
        ];

        const [countRows] = await pool.execute(
            `SELECT COUNT(*) AS total_rows
             FROM inventario_store st
             INNER JOIN (${areaTotalsSql}) area_totals ON area_totals.id = st.id
             WHERE st.cSessionCode = ?
               AND COALESCE(area_totals.source_qty, 0) > 0
               AND COALESCE(area_totals.target_qty, 0) = 0`,
            [...areaParams, session_code]
        );

        const [rows] = await pool.execute(
            `SELECT
                st.id,
                st.cCodigoTienda,
                st.cCodigoArticulo,
                st.cCodigoBarra,
                st.cCodigoBarra2,
                st.cCodigoBarra3,
                st.cReferencia,
                st.cDescripcion,
                st.cDepartamento,
                st.cSeccion,
                st.cFamilia,
                st.cSubFamilia,
                st.cTemporada,
                st.cTalla,
                st.cColor,
                st.cStock,
                COALESCE(area_totals.source_qty, 0) AS source_qty,
                COALESCE(area_totals.target_qty, 0) AS target_qty
             FROM inventario_store st
             INNER JOIN (${areaTotalsSql}) area_totals ON area_totals.id = st.id
             WHERE st.cSessionCode = ?
               AND COALESCE(area_totals.source_qty, 0) > 0
               AND COALESCE(area_totals.target_qty, 0) = 0
             ORDER BY st.id ASC
             LIMIT ${pageSize} OFFSET ${offset}`,
            [...areaParams, session_code]
        );

        return res.status(200).json({
            success: true,
            sourceArea,
            targetArea,
            products: rows,
            pagination: {
                page,
                pageSize,
                totalRows: Number(countRows[0]?.total_rows || 0),
                totalPages: Math.ceil(Number(countRows[0]?.total_rows || 0) / pageSize)
            }
        });
    } catch (error) {
        console.error('Error en getProductsWithoutDisplay:', error);
        return res.status(500).json({ message: 'Error al obtener productos sin exhibir', error: error.message });
    }
};

export const getInventoryStoreStatistics = async (req, res) => {
    const { session_code } = req.query;
    const allowedFields = new Set(['cDepartamento', 'cSeccion', 'cFamilia', 'cSubFamilia']);
    const statField = allowedFields.has(req.query.statField) ? req.query.statField : 'cDepartamento';

    if (!session_code) {
        return res.status(400).json({ error: 'Falta parámetro requerido: session_code' });
    }

    try {
        const [sessionRows] = await pool.execute(
            `SELECT id FROM inventario_sesiones WHERE codigo_sesion = ?`,
            [session_code]
        );

        const sessionId = sessionRows[0]?.id;
        if (!sessionId) {
            return res.status(404).json({ error: 'Sesión no encontrada.' });
        }

        await syncStoreScanTotals(sessionId, session_code);

        const [byField] = await pool.query(
            `SELECT
                COALESCE(NULLIF(TRIM(st.${statField}), ''), 'Otros') AS label,
                COALESCE(SUM(ABS(COALESCE(st.cTotalConteo, 0))), 0) AS value,
                COALESCE(SUM(COALESCE(st.cTotalConteo, 0)), 0) AS signed_value
             FROM inventario_store st
             WHERE st.cSessionCode = ?
             GROUP BY label
             HAVING value > 0
             ORDER BY value DESC
             LIMIT 50`,
            [session_code]
        );

        const areaSql = areaCaseSql('sa');
        const [byArea] = await pool.execute(
            `SELECT
                area AS label,
                COALESCE(SUM(total_conteo), 0) AS value
             FROM (
                SELECT
                    ${areaSql} AS area,
                    es.cantidad AS total_conteo
                FROM inventario_escaneos es
                LEFT JOIN secciones_asginados sa ON sa.id = es.seccion_id
                WHERE es.sesion_id = ?
             ) grouped_scans
             GROUP BY area
             HAVING value > 0
             ORDER BY value DESC`,
            [sessionId]
        );

        return res.status(200).json({ byField, byArea, statField });
    } catch (error) {
        console.error('Error en getInventoryStoreStatistics:', error);
        return res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
};

export const postInventoryResStore = async (req, res) => {
    try {
        const dataBody = req.body;

        if (!dataBody || dataBody.length === 0) {
            return res.status(400).json({ message: "El cuerpo de la petición está vacío" });
        }

        const sessionCode = dataBody[0]['cSessionCode'];
        console.log("Sesión:", sessionCode);

        const values = dataBody.map((d) => [
                d.cSessionCode ?? null,
                d.cCodigoTienda ?? null,
                d.cCodigoArticulo ?? null,
                d.cReferencia ?? null,
                d.cCodigoBarra ?? null,
                d.cDescripcion ?? null,
                d.cDepartamento ?? null,
                d.cSeccion ?? null,
                d.cFamilia ?? null,
                d.cSubFamilia ?? null,
                d.cTalla ?? null,
                d.cColor ?? null,
                d.cStock ?? 0,
                d.cTemporada ?? '',
                d.cConteo ?? 0,
                d.cTotalConteo ?? 0,
                d.cEsencia ?? '',
                d.cStyleDesc ?? '',
                d.cCodigoBarra2 ?? null,
                d.cCodigoBarra3 ?? null
        ]);

        const BATCH = 1000;
        let insertedRows = 0;

        for (let i = 0; i < values.length; i += BATCH) {
            const batch = values.slice(i, i + BATCH);
            const [result] = await pool.query(
                `INSERT INTO inventario_store (cSessionCode, cCodigoTienda, cCodigoArticulo, cReferencia, cCodigoBarra, cDescripcion, cDepartamento, cSeccion, cFamilia, cSubFamilia, cTalla, cColor, cStock, cTemporada, cConteo, cTotalConteo, cEsencia, cStyleDescription, cCodigoBarra2, cCodigoBarra3) 
                 VALUES ?`,
                [batch]
            );
            insertedRows += result.affectedRows || batch.length;
        }

        // 3. Actualizamos el estado de la sesión
        await pool.execute(
            `UPDATE inventario_sesiones SET inventario_registrado = 1 WHERE codigo_sesion = ?`,
            [sessionCode]
        );

        // 4. Emitimos un evento liviano; no reenviamos 100k filas al navegador.
        getIO().to(sessionCode).emit('res_inv_store', {
            sessionCode,
            insertedRows,
            refresh: true
        });

        // 5. IMPORTANTE: Responder a la petición HTTP para que no se quede colgada
        return res.status(200).json({
            message: "Inventario registrado y sesión actualizada correctamente",
            insertedRows
        });

    } catch (error) {
        // Si hay CUALQUIER error en la BD, entra aquí, no crashea la app, y se le avisa al cliente
        console.error("Error al registrar inventario:", error);
        return res.status(500).json({ error: error.message });
    }
}

export const postInventoryImport = async (req, res) => {

    try {
        const dataBody = req.body;
        let mensaje = 'Inventario Registrado';
        if (dataBody) {
            console.log(dataBody[0]['cSessionCode']);

            const [getSesion] = await pool.execute(`SELECT * FROM inventario_sesiones WHERE codigo_sesion = ?`, [session_code]);
            const invExist = ((getSesion || [])[0] || {}).inventario_registrado || 0;

            if (!invExist) {
                const data = await dataBody.map(async (d) => {
                    await pool.execute(
                        `INSERT INTO inventario_store (cSessionCode,cCodigoTienda,cCodigoArticulo,cReferencia,cCodigoBarra,cDescripcion,cDepartamento,
             cSeccion,cFamilia,cSubFamilia,cTalla,cColor,cStock,cTemporada,cConteo,cTotalConteo,cEsencia,cStyleDescription,cCodigoBarra2,cCodigoBarra3) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                        [d.cSessionCode, d.cCodigoTienda, d.cCodigoArticulo, d.cReferencia, d.cCodigoBarra, d.cDescripcion, d.cDepartamento,
                        d.cSeccion, d.cFamilia, d.cSubFamilia, d.cTalla, d.cColor, d.cStock, (d || {}).cTemporada || '', d.cConteo, d.cTotalConteo, (d || {}).cEsencia || '', (d || {}).cStyleDesc || '', (d || {}).cCodigoBarra2 || null, (d || {}).cCodigoBarra3 || null]
                    );
                });

                const sesion = await pool.execute(`UPDATE inventario_sesiones SET inventario_registrado = 1 WHERE codigo_sesion = ?`,
                    [dataBody[0]['cSessionCode']]
                );

                Promise.all(data, sesion);
            } else {
                mensaje = 'Esta sesion ya tiene un inventario registrado.'
            }

            res.json({ message: mensaje });
        }
    } catch (error) {
        res.status(500).json({ message: 'Error en las consultas', error });
    }

}

export const getInventoryResStore = async (req, res) => {
    const dataBody = req.body;
    if (dataBody) {
        console.log(dataBody[0]['cSessionCode']);
        getIO().to(dataBody[0]['cSessionCode']).emit('res_inv_store', {
            sessionCode: dataBody[0]['cSessionCode'],
            insertedRows: dataBody.length,
            refresh: true
        });
    }
}


export const getPocketScan = async (req, res) => {
    try {
        const { session_code } = req.params;
        const userId = req.user.id;

        const [promiseSession] = await pool.execute('SELECT * FROM inventario_sesiones WHERE codigo_sesion = ?', [session_code]);

        const [promisePocketScan] = await pool.execute(`SELECT cantidad as quantity,fecha_escaneo as scanned_at,seccion_id,codigo_sesion as session_code,sku,estado as synced FROM 
                inventario_escaneos ie
                INNER JOIN inventario_sesiones i ON i.id = ie.sesion_id
                WHERE sesion_id = ? and escaneado_por = ?;`, [promiseSession[0]['id'], userId]);

        res.json(promisePocketScan);
    } catch (error) {
        res.status(500).json({ message: 'Error en las consultas', error });
    }
}


export const updateEndedSession = async (req, res) => {
    const { codeSession } = req.body;

    if (!codeSession) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (CLOSE SESSION LOCK) ---
    // Bloqueamos usando el código de la sesión para que nadie más intente alterarla en este milisegundo
    const lockKey = `lock:session:close:${codeSession}`;

    try {
        // Ponemos un bloqueo de 3 segundos
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de finalizar la sesión bloqueado: ${codeSession}`);
            return res.status(429).json({
                message: 'La sesión ya está siendo finalizada por otra solicitud en curso.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [result] = await pool.execute(
            'UPDATE inventario_sesiones SET estado = ? WHERE codigo_sesion = ?',
            ['FINALIZADO', codeSession]
        );

        // Opcional: Si el UPDATE no afectó a ninguna fila (ej. el código no existía)
        if (result.affectedRows === 0) {
            await redis.del(lockKey);
            return res.status(404).json({ message: 'No se encontró la sesión especificada.' });
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // Como el estado cambió correctamente en MySQL, liberamos el candado inmediatamente
        await redis.del(lockKey);

        res.json({ message: 'Sesion Finalizada' });

    } catch (error) {
        // Si el motor de base de datos falla, limpiamos Redis para no dejar la sesión "congelada"
        await redis.del(lockKey);
        res.status(500).json({ message: error.message });
    }
};

export const updateStartSession = async (req, res) => {
    const { codeSession } = req.body;

    if (!codeSession) {
        return res.status(400).json({ message: 'El código de sesión es requerido.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (START SESSION LOCK) ---
    // Bloqueamos usando el código de la sesión para evitar que múltiples hilos alteren el estado en paralelo
    const lockKey = `lock:session:start:${codeSession}`;

    try {
        // Ponemos un bloqueo rápido de 3 segundos
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de activar la sesión bloqueado: ${codeSession}`);
            return res.status(429).json({
                message: 'La sesión ya está siendo activada por otra solicitud en curso.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [result] = await pool.execute(
            'UPDATE inventario_sesiones SET estado = ? WHERE codigo_sesion = ?',
            ['ACTIVO', codeSession]
        );

        // Validación preventiva: Si el código de sesión enviado no existía en la BD
        if (result.affectedRows === 0) {
            await redis.del(lockKey);
            return res.status(404).json({ message: 'No se encontró la sesión especificada.' });
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // El estado en MySQL cambió a 'ACTIVO' correctamente, liberamos el candado de inmediato
        await redis.del(lockKey);

        res.json({ message: 'Sesion Activada' });

    } catch (error) {
        // En caso de un fallo en el motor de base de datos, limpiamos el lock para permitir reintentos manuales
        await redis.del(lockKey);
        res.status(500).json({ message: error.message });
    }
}


export const updateConteoPocket = async (req, res) => {
    const { id, cantidad } = req.body;

    if (!id || cantidad === undefined) {
        return res.status(400).json({ message: 'El ID del escaneo y la cantidad son requeridos.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (UPDATE COUNT LOCK) ---
    // Bloqueamos por el ID del registro de escaneo específico para evitar colisiones en el mismo segundo
    const lockKey = `lock:scan:update:${id}`;

    try {
        // Ponemos un bloqueo ultracorto de 3 segundos
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 3);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de actualizar conteo bloqueado para el ID: ${id}`);
            return res.status(429).json({
                message: 'Ya se está procesando una actualización para este registro. Por favor, espere.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [result] = await pool.execute(
            'UPDATE inventario_escaneos SET cantidad = ? WHERE id = ?',
            [cantidad, id]
        );

        // Validación preventiva: Si el ID enviado no existía en la BD
        if (result.affectedRows === 0) {
            await redis.del(lockKey);
            return res.status(404).json({ message: 'No se encontró el registro de escaneo especificado.' });
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // Como MySQL aplicó el cambio con éxito, borramos el candado de inmediato
        await redis.del(lockKey);

        res.json({ message: 'Conteo actualizado correctamente' });

    } catch (error) {
        // En caso de que falle la base de datos, limpiamos el lock para permitir reintentos legítimos
        await redis.del(lockKey);
        res.status(500).json({ message: error.message });
    }
};

export const updateCheckedRow = async (req, res) => {
    const { id, checked } = req.body;

    if (id === undefined || checked === undefined) {
        return res.status(400).json({ message: 'El ID y el estado checked son requeridos.' });
    }

    // --- ARQUITECTURA DE DEDUPLICACIÓN (ROW CHECK LOCK) ---
    // Bloqueamos por el ID de la fila específica para evitar actualizaciones paralelas en la misma celda
    const lockKey = `lock:store:check:${id}`;

    try {
        // Ponemos un bloqueo ultracorto de 2 segundos (tiempo más que suficiente para un UPDATE simple)
        const lockAcquired = await redis.set(lockKey, 'PROCESSING', 'NX', 'EX', 2);

        if (!lockAcquired) {
            console.warn(`[DEDUPLICACIÓN] Intento duplicado de cambiar check bloqueado para el ID: ${id}`);
            return res.status(429).json({
                message: 'Se está procesando un cambio para esta fila. Por favor, espere.'
            });
        }

        // --- TU LÓGICA DE NEGOCIO ORIGINAL ---
        const [result] = await pool.execute(
            'UPDATE inventario_store SET checking = ? WHERE id = ?',
            [checked, id]
        );

        // Validación preventiva: Si el ID enviado no existía en la tabla
        if (result.affectedRows === 0) {
            await redis.del(lockKey);
            return res.status(404).json({ message: 'No se encontró el registro especificado.' });
        }

        // --- ¡LIBERACIÓN EXITOSA! ---
        // El cambio se aplicó correctamente en MySQL, removemos el candado de inmediato
        await redis.del(lockKey);

        res.json({ message: 'Check Registrado' });

    } catch (error) {
        // En caso de error en la base de datos, limpiamos Redis para permitir reintentos normales
        await redis.del(lockKey);
        res.status(500).json({ message: error.message });
    }
};

export const impExtraStore = async (req, res) => {
    
};
