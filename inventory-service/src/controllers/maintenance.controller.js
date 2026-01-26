import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';

export const getSections = async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT seccion_id,nombre_seccion FROM secciones_escaneos;
        `);

        res.json(rows);
    } catch (error) {
        res.status(500).json({
            message: 'Error al obtener las secciones',
            error: error.message
        });
    }
};


export const postSections = async (req, res) => {
    const { nombre_seccion } = req.body;

    try {
        await pool.execute(
            'INSERT INTO secciones_escaneos (nombre_seccion) VALUES (?)',
            [nombre_seccion]
        );

        res.status(200).json({ message: 'Seccion registrada correctamente' });

    } catch (error) {
        res.status(500).json({ message: 'Error al registrar seccion', error: error.message });
    }

};


export const putSecitons = async (req, res) => {
    const { seccion_id, nombre_seccion } = req.body;

    try {
        await pool.execute(
            'UPDATE secciones_escaneos SET nombre_seccion = ? WHERE seccion_id = ?;',
            [nombre_seccion, seccion_id]
        );

        res.status(200).json({ message: 'Seccion actualizada correctamente' });

    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar seccion', error: error.message });
    }

};


export const delSecitons = async (req, res) => {
    const { seccion_id } = req.params;
    console.log(req.params);
    try {
        await pool.execute(
            'DELETE FROM secciones_escaneos WHERE seccion_id = ?;',
            [seccion_id]
        );

        res.status(200).json({ message: 'Seccion eliminada correctamente' });

    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar seccion', error: error.message });
    }

};