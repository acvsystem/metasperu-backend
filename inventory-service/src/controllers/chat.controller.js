import { pool } from '../config/db.js';
import { emitToUser } from '../config/socket.js';

let schema;
const staff = role => ['administrador', 'auditor'].includes(role);
async function ready() {
    if (!schema) schema = pool.query(`CREATE TABLE IF NOT EXISTS inventory_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL, recipient_id INT NOT NULL,
        client_id VARCHAR(80) NOT NULL, body VARCHAR(2000) NOT NULL,
        created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), read_at TIMESTAMP NULL,
        UNIQUE KEY message_retry (sender_id, client_id),
        KEY inbox (recipient_id, read_at, id), KEY conversation (sender_id, recipient_id, id)
    )`).catch(error => { schema = null; throw error; });
    await schema;
}
async function identity(req) {
    const [[user]] = await pool.query('SELECT id, role FROM usuarios WHERE id = ? AND estado = 1', [req.user.id]);
    if (!user) throw Object.assign(new Error('Usuario no disponible'), { status: 403 });
    return user;
}
async function peer(req, user) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0 || id === Number(user.id)) throw Object.assign(new Error('Destinatario invalido'), { status: 400 });
    const [[other]] = await pool.query('SELECT id, role FROM usuarios WHERE id = ? AND estado = 1', [id]);
    if (!other || (!staff(user.role) && !staff(other.role))) throw Object.assign(new Error('Conversacion no permitida'), { status: 403 });
    return id;
}
export const chat = handler => async (req, res) => {
    try { await ready(); await handler(req, res, await identity(req)); }
    catch (error) { console.error('Chat:', error.message); res.status(error.status || 500).json({ message: error.status ? error.message : 'No se pudo conectar al chat.' }); }
};
export const contacts = chat(async (req, res, user) => {
    const [rows] = await pool.query(`SELECT u.id, u.username, u.role,
        (SELECT COUNT(*) FROM inventory_messages m WHERE m.sender_id=u.id AND m.recipient_id=? AND m.read_at IS NULL) AS unread
        FROM usuarios u WHERE u.estado=1 AND u.id<>? ${staff(user.role) ? '' : "AND u.role IN ('administrador','auditor')"} ORDER BY unread DESC, u.username`, [user.id, user.id]);
    res.json(rows);
});
export const messages = chat(async (req, res, user) => {
    const id = await peer(req, user);
    const before = Number(req.query.before || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before <= 0) return res.status(400).json({ message: 'Pagina invalida' });
    const [rows] = await pool.query(`SELECT id, body, created_at, read_at, sender_id = ? AS mine FROM inventory_messages
        WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND id < ? ORDER BY id DESC LIMIT 50`, [user.id, user.id, id, id, user.id, before]);
    res.json(rows.reverse());
});
export const send = chat(async (req, res, user) => {
    const id = await peer(req, user);
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    const client = req.body.client_id;
    if (!body || body.length > 2000 || typeof client !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(client)) return res.status(400).json({ message: 'Mensaje invalido (maximo 2000 caracteres).' });
    await pool.query('INSERT INTO inventory_messages (sender_id,recipient_id,client_id,body) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', [user.id, id, client, body]);
    const [[saved]] = await pool.query(`SELECT m.id, m.sender_id, m.recipient_id, m.body, m.created_at, m.read_at, u.username AS sender_username
        FROM inventory_messages m JOIN usuarios u ON u.id=m.sender_id WHERE m.sender_id=? AND m.client_id=?`, [user.id, client]);
    if (Number(saved.recipient_id) !== id || saved.body !== body) return res.status(409).json({ message: 'Identificador de mensaje ya utilizado.' });
    emitToUser(saved.recipient_id, 'chat_message', { ...saved, peer_id: saved.sender_id, mine: false });
    emitToUser(saved.sender_id, 'chat_message', { ...saved, peer_id: saved.recipient_id, mine: true });
    res.json({ sent: true, message: { ...saved, peer_id: saved.recipient_id, mine: true } });
});
export const read = chat(async (req, res, user) => {
    const id = await peer(req, user);
    const through = Number(req.body.through);
    if (!Number.isSafeInteger(through) || through <= 0) return res.status(400).json({ message: 'Mensaje invalido' });
    await pool.query('UPDATE inventory_messages SET read_at=CURRENT_TIMESTAMP WHERE recipient_id=? AND sender_id=? AND id<=? AND read_at IS NULL', [user.id, id, through]);
    emitToUser(id, 'chat_read', { peer_id: user.id, through });
    res.json({ read: true });
});
