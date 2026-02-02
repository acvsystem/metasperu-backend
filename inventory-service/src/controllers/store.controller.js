import { pool } from '../config/db.js';

export const storeController = {

    getTiendas: async (req, res) => {
        try {
            const [rows] = await pool.execute('SELECT * FROM tiendas');
            res.json(rows);
        } catch (error) {
            res.status(500).json({ message: 'Error al obtener tiendas', error });
        }
    },

    createTienda: async (req, res) => {
        const { serie, nombre_tienda, estado } = req.body;
        try {
            const [result] = await pool.execute(
                'INSERT INTO tiendas (serie, nombre_tienda, estado) VALUES (?, ?, ?)',
                [serie, nombre_tienda, estado || 'ACTIVO']
            );

            const [rows] = await pool.execute('SELECT * FROM tiendas');

            res.status(201).json({ data: rows, message: 'Tienda creada' });
        } catch (error) {
            res.status(500).json({ message: 'Error al crear tienda', error });
        }
    },

    updateTienda: async (req, res) => {
        const { id, serie, nombre_tienda, estado } = req.body;

        console.log(serie, nombre_tienda, estado);

        try {
            await pool.execute(
                'UPDATE tiendas SET serie = ?, nombre_tienda = ?, estado = ? WHERE id = ?',
                [serie, nombre_tienda, estado, id]
            );

            res.json({ message: 'Tienda actualizada correctamente' });
        } catch (error) {
            res.status(500).json({ message: 'Error al actualizar', error });
        }
    },

    deleteTienda: async (req, res) => {
        const { id } = req.params;
        try {
            // Podrías hacer un borrado físico o lógico (cambiar estado a DESHABILITADO)
            await pool.execute('DELETE FROM tiendas WHERE id = ?', [id]);
            res.json({ message: 'Tienda eliminada' });
        } catch (error) {
            res.status(500).json({ message: 'Error al eliminar', error });
        }
    }
}