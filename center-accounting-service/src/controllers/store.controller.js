import { getIO } from '../config/socket.js';
import axios from 'axios';
const inventariosPorMarca = new Map();

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
        // 1. Configuración del Token (Mejor si viene de un .env)
        const API_TOKEN = '8a02ec4cc1f4618487ff6a58100299a7dd02bc4ec60e3c8959d97dfd7becdf6b';
        const URL = 'https://apiperu.dev/api/tipo-de-cambio';

        // 2. Obtener fecha del body o query (formato YYYY-MM-DD)
        const { fecha } = req.body;

        if (!fecha) {
            return res.status(400).json({
                success: false,
                message: "La fecha es requerida (YYYY-MM-DD)"
            });
        }

        try {
            const response = await axios.post(URL,
                { fecha: fecha }, // Body
                {
                    headers: {
                        'Authorization': `Bearer ${API_TOKEN}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            // ApiPeru suele devolver { success: true, data: { compra: 3.7, venta: 3.8, ... } }
            res.status(200).json(response.data);

        } catch (error) {
            console.error('❌ Error consultando ApiPeru:', error.response?.data || error.message);

            res.status(error.response?.status || 500).json({
                success: false,
                message: 'Error al obtener tipo de cambio desde el proveedor externo',
                error: error.response?.data || error.message
            });
        }
    }
};
