import { randomInt, createHash } from 'node:crypto';
import { fail } from '../../../shared/inventory-security.mjs';

async function transaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createSession(pool, body, userId) {
  const storeId = Number(body.tienda_id);
  const sections = body.assigned_section;
  if (
    !Number.isSafeInteger(storeId) ||
    storeId <= 0 ||
    !Array.isArray(sections) ||
    !sections.length ||
    sections.length > 10000 ||
    sections.some(
      (s) =>
        !Number.isSafeInteger(Number(s?.seccion_id)) ||
        Number(s.seccion_id) <= 0 ||
        typeof s.nombre_seccion !== 'string' ||
        !s.nombre_seccion.trim() ||
        s.nombre_seccion.length > 255,
    )
  ) {
    throw fail(400, 'Seleccione una tienda y secciones válidas.');
  }
  const ids = sections.map((s) => Number(s.seccion_id));
  if (new Set(ids).size !== ids.length) throw fail(400, 'Hay secciones repetidas.');
  return transaction(pool, async (connection) => {
    const [[store]] = await connection.query(
      'SELECT id FROM tiendas WHERE id = ? AND estado = ? FOR SHARE',
      [storeId, 'ACTIVO'],
    );
    if (!store) throw fail(400, 'Tienda no disponible.');
    const [known] = await connection.query(
      'SELECT seccion_id AS id FROM secciones_escaneos WHERE seccion_id IN (?)',
      [ids],
    );
    if (known.length !== ids.length) throw fail(400, 'Una sección no existe.');
    // Cryptographic randomness; the unique session-code index guards collisions across processes.
    const code = randomInt(36 ** 6)
      .toString(36)
      .padStart(6, '0')
      .toUpperCase();
    const [result] = await connection.query(
      'INSERT INTO inventario_sesiones (codigo_sesion, tienda_id, estado, creado_por) VALUES (?, ?, ?, ?)',
      [code, storeId, 'ACTIVO', userId],
    );
    await connection.query(
      'INSERT INTO secciones_asginados (codigo_sesion, seccion_id_fk, nombre_seccion) VALUES ?',
      [sections.map((s) => [code, Number(s.seccion_id), s.nombre_seccion.trim()])],
    );
    return { id: result.insertId, session_code: code, message: 'Sesión de inventario iniciada' };
  });
}

export async function editCount(pool, body, user) {
  const id = Number(body.id),
    quantity = Number(body.cantidad);
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    body.cantidad === null ||
    (typeof body.cantidad === 'string' && !body.cantidad.trim()) ||
    !['number', 'string'].includes(typeof body.cantidad) ||
    !Number.isSafeInteger(quantity) ||
    Math.abs(quantity) > 999999999
  ) {
    throw fail(400, 'Ingrese un ID válido y una cantidad entera entre -999999999 y 999999999.');
  }
  return transaction(pool, async (connection) => {
    const [[scan]] = await connection.query(
      `SELECT e.id, e.sesion_id, e.escaneado_por, e.cantidad, s.estado
            FROM inventario_escaneos e INNER JOIN inventario_sesiones s ON s.id = e.sesion_id WHERE e.id = ? FOR UPDATE`,
      [id],
    );
    if (!scan) throw fail(404, 'No se encontró el escaneo.');
    if (user.role !== 'administrador' && Number(scan.escaneado_por) !== Number(user.id))
      throw fail(403, 'Solo puede modificar sus propios escaneos.');
    if (scan.estado !== 'ACTIVO') throw fail(409, 'La sesión está finalizada.');
    if (Number(scan.cantidad) !== quantity) {
      await connection.query('UPDATE inventario_escaneos SET cantidad = ? WHERE id = ?', [
        quantity,
        id,
      ]);
      await connection.query(
        'INSERT INTO inventory_scan_audit (scan_id, session_id, user_id, old_quantity, new_quantity) VALUES (?, ?, ?, ?, ?)',
        [id, scan.sesion_id, user.id, scan.cantidad, quantity],
      );
    }
    return { sessionId: scan.sesion_id, message: 'Conteo actualizado correctamente' };
  });
}

const columns = [
  'cSessionCode',
  'codigo_sesion',
  'cCodigoTienda',
  'cCodigoArticulo',
  'cReferencia',
  'cCodigoBarra',
  'cDescripcion',
  'cDepartamento',
  'cSeccion',
  'cFamilia',
  'cSubFamilia',
  'cTalla',
  'cColor',
  'cStock',
  'cTemporada',
  'cConteo',
  'cTotalConteo',
  'cEsencia',
  'cStyleDescription',
  'cCodigoBarra2',
  'cCodigoBarra3',
];

export async function importStock(pool, rows, scope) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100000)
    throw fail(400, 'Envíe entre 1 y 100000 productos.');
  const code = rows[0]?.cSessionCode,
    store = String(rows[0]?.cCodigoTienda ?? '');
  if (typeof code !== 'string' || !/^[A-Z0-9]{4,32}$/.test(code) || !store || store.length > 50)
    throw fail(400, 'Sesión y tienda requeridas.');
  if (
    rows.some(
      (row) =>
        !row ||
        row.cSessionCode !== code ||
        String(row.cCodigoTienda ?? '') !== store ||
        row.cStock === null ||
        row.cStock === '' ||
        !['number', 'string'].includes(typeof row.cStock) ||
        !Number.isFinite(Number(row.cStock)) ||
        Math.abs(Number(row.cStock)) > 999999999 ||
        Object.values(row).some((value) => typeof value === 'string' && value.length > 2000),
    )
  )
    throw fail(400, 'El lote debe tener una sola sesión y tienda, con cantidades válidas.');
  if (scope.store && String(scope.store) !== store)
    throw fail(403, 'Este importador no tiene acceso a la tienda.');
  const values = rows.map((row) =>
    columns.map((column) => {
      if (column === 'codigo_sesion') return code;
      if (column === 'cConteo' || column === 'cTotalConteo') return 0;
      if (column === 'cStock') return Number(row.cStock);
      if (column === 'cStyleDescription') return row.cStyleDescription ?? row.cStyleDesc ?? '';
      return row[column] ?? null;
    }),
  );
  const hash = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return transaction(pool, async (connection) => {
    const [[session]] = await connection.query(
      `SELECT s.id, s.estado, s.inventario_registrado, t.serie FROM inventario_sesiones s
            INNER JOIN tiendas t ON t.id = s.tienda_id WHERE s.codigo_sesion = ? FOR UPDATE`,
      [code],
    );
    if (!session) throw fail(404, 'Sesión no encontrada.');
    if (String(session.serie) !== store)
      throw fail(403, 'La tienda del lote no corresponde a la sesión.');
    const [[receipt]] = await connection.query(
      'SELECT payload_hash, row_count FROM inventory_stock_imports WHERE session_id = ?',
      [session.id],
    );
    if (receipt) {
      if (receipt.payload_hash !== hash)
        throw fail(409, 'Esta sesión ya tiene un inventario diferente.');
      return {
        sessionCode: code,
        insertedRows: 0,
        duplicate: true,
        message: 'Este inventario ya fue registrado.',
      };
    }
    if (session.estado !== 'ACTIVO' || session.inventario_registrado)
      throw fail(409, 'La sesión está finalizada o ya tiene inventario.');
    for (let i = 0; i < values.length; i += 1000)
      await connection.query(`INSERT INTO inventario_store (${columns.join(', ')}) VALUES ?`, [
        values.slice(i, i + 1000),
      ]);
    await connection.query(
      'UPDATE inventario_sesiones SET inventario_registrado = 1 WHERE id = ?',
      [session.id],
    );
    await connection.query(
      'INSERT INTO inventory_stock_imports (session_id, payload_hash, row_count) VALUES (?, ?, ?)',
      [session.id, hash, values.length],
    );
    return {
      sessionCode: code,
      insertedRows: values.length,
      duplicate: false,
      message: 'Inventario registrado correctamente.',
    };
  });
}
