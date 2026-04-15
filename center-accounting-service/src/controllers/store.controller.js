import { getIO } from '../config/socket.js';
import axios from 'axios';
import { pool } from '../config/db.js';

export const storeController = {

    getKardexStore: async (req, res) => {
        const { serieStore, socketId, init, end } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_kardex_store', { pedido_por: socketId, init: init, end: end });

            res.json({
                message: 'Se emitio señal de kardex'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    postKardexCamposLibres: async (req, res) => {
        const { serieStore, socketId, body } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_kardex_campos_libres', { pedido_por: socketId, body: body });

            res.json({
                message: 'Se emitio señal de kardex campos libres'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    getCuoStore: async (req, res) => {
        const { serieStore, socketId, init, end } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_cuo', { pedido_por: socketId, init: init, end: end });

            res.json({
                message: 'Se emitio señal de CUO'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    postCuoInsert: async (req, res) => {
        const { serieStore, socketId, data } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_insert_cuo', { pedido_por: socketId, data: data });

            res.json({
                message: 'Se emitio señal de CUO'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    getExchangeRateStore: async (req, res) => {
        const { serieStore, socketId, init, end } = req.body;
        try {

            getIO().to(serieStore).emit('py_request_exchange_rate', { pedido_por: socketId, init: init, end: end });

            res.json({
                message: 'Se emitio señal de tipo de cambio'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },

    postExchangeRateSunat: async (req, res) => {
        const API_TOKEN = '8a02ec4cc1f4618487ff6a58100299a7dd02bc4ec60e3c8959d97dfd7becdf6b';
        const URL = 'https://apiperu.dev/api/tipo-de-cambio';
        const { fecha } = req.body; // Formato YYYY-MM-DD

        if (!fecha) return res.status(400).json({ success: false, message: "Fecha requerida" });

        try {
            // --- PASO 1: BUSCAR EN DB LOCAL ---
            const [localRows] = await pool.execute(
                'SELECT compra, venta FROM tb_tipo_cambio_cache WHERE fecha = ?',
                [fecha]
            );

            if (localRows.length > 0) {
                console.log(`⚡ [Cache DB] Retornando fecha: ${fecha}`);
                return res.status(200).json({
                    success: true,
                    data: {
                        fecha,
                        compra: localRows[0].compra,
                        venta: localRows[0].venta,
                        origen: 'local_cache'
                    }
                });
            }

            // --- PASO 2: SI NO ESTÁ, CONSULTAR API EXTERNA ---
            console.log(`🌐 [API Exterior] Consultando ApiPeru para fecha: ${fecha}`);
            const response = await axios.post(URL, { fecha }, {
                headers: {
                    'Authorization': `Bearer ${API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            const apiData = response.data;

            if (apiData.success && apiData.data) {
                const { compra, venta } = apiData.data;

                // --- PASO 3: GUARDAR EN DB LOCAL PARA LA PRÓXIMA VEZ ---
                await pool.execute(
                    'INSERT INTO tb_tipo_cambio_cache (fecha, compra, venta) VALUES (?, ?, ?)',
                    [fecha, compra, venta]
                );

                return res.status(200).json(apiData);
            } else {
                return res.status(404).json({ success: false, message: "No se encontró tipo de cambio en SUNAT" });
            }

        } catch (error) {
            console.error('❌ Error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    }
};
