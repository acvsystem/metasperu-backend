import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const fail = (status, message) => Object.assign(new Error(message), { status });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeScans(scans) {
    if (!Array.isArray(scans) || !scans.length || scans.length > 200) {
        throw fail(400, 'Envie entre 1 y 200 escaneos por lote.');
    }
    const seen = new Set();
    return scans.map(scan => {
        if (!scan || !uuid.test(scan.client_scan_id || '')) throw fail(400, 'Actualice Pocket: falta el identificador del escaneo.');
        const id = scan.client_scan_id.toLowerCase();
        const quantity = Number(scan.quantity);
        const section = Number(scan.seccion_id);
        const at = new Date(scan.scanned_at);
        if (seen.has(id) || typeof scan.sku !== 'string' || !scan.sku.trim() || scan.sku.length > 255 ||
            !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(section) || section <= 0 ||
            !scan.scanned_at || !Number.isFinite(at.getTime())) throw fail(400, 'Escaneo invalido o identificador repetido en el lote.');
        seen.add(id);
        const payload = { sku: scan.sku.trim(), quantity, seccion_id: section, scanned_at: at.toISOString() };
        return { ...payload, client_scan_id: id, hash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
    }).sort((a, b) => a.client_scan_id.localeCompare(b.client_scan_id));
}

export function createPocketSync(pool, notify = () => {}) {
    let schemaReady;
    async function ensureSchema() {
        if (!schemaReady) schemaReady = readFile(new URL('../../sql/pocket-receipts.sql', import.meta.url), 'utf8')
            .then(sql => pool.query(sql)).catch(error => { schemaReady = undefined; throw error; });
        await schemaReady;
    }
    return async (sessionCode, userId, input) => {
        if (typeof sessionCode !== 'string' || !sessionCode.trim()) throw fail(400, 'Sesion requerida.');
        const scans = normalizeScans(input);
        await ensureSchema();
        const connection = await pool.getConnection();
        let inserted = [];
        try {
            await connection.beginTransaction();
            const [[session]] = await connection.query('SELECT id, estado FROM inventario_sesiones WHERE codigo_sesion = ? FOR SHARE', [sessionCode]);
            if (!session) throw fail(404, 'Sesion no encontrada.');
            const batch = randomUUID();
            // The unique receipt and the inventory rows commit atomically, even across server processes.
            await connection.query(`INSERT INTO inventario_pocket_receipts
                (client_scan_id, session_id, user_id, payload_hash, batch_id) VALUES ?
                ON DUPLICATE KEY UPDATE client_scan_id = inventario_pocket_receipts.client_scan_id`,
                [scans.map(s => [s.client_scan_id, session.id, userId, s.hash, batch])]);
            const [receipts] = await connection.query('SELECT * FROM inventario_pocket_receipts WHERE client_scan_id IN (?) FOR UPDATE', [scans.map(s => s.client_scan_id)]);
            const byId = new Map(receipts.map(row => [row.client_scan_id, row]));
            for (const scan of scans) {
                const receipt = byId.get(scan.client_scan_id);
                if (!receipt || Number(receipt.session_id) !== Number(session.id) || Number(receipt.user_id) !== Number(userId) || receipt.payload_hash !== scan.hash) {
                    throw fail(409, 'El identificador ya pertenece a otro escaneo. No modifique un envio sin confirmar.');
                }
                if (receipt.batch_id === batch) inserted.push(scan);
            }
            if (inserted.length) {
                if (session.estado !== 'ACTIVO') throw fail(409, 'Sesion finalizada: no admite nuevos escaneos.');
                const sections = [...new Set(inserted.map(s => s.seccion_id))];
                const [assigned] = await connection.query('SELECT id FROM secciones_asginados WHERE codigo_sesion = ? AND id IN (?)', [sessionCode, sections]);
                if (assigned.length !== sections.length) throw fail(400, 'Una seccion no pertenece a esta sesion.');
                await connection.query(`INSERT INTO inventario_escaneos
                    (sesion_id, sku, cantidad, escaneado_por, fecha_escaneo, seccion_id) VALUES ?`,
                    [inserted.map(s => [session.id, s.sku, s.quantity, userId, new Date(s.scanned_at), s.seccion_id])]);
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        // A socket failure must not turn a committed upload into a failed HTTP response.
        if (inserted.length) {
            try { notify(sessionCode, inserted); } catch (error) { console.error('Pocket notification:', error.message); }
        }
        return { acknowledged: scans.map(s => s.client_scan_id), inserted: inserted.length, duplicates: scans.length - inserted.length };
    };
}
