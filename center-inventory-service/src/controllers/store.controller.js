import { getIO } from '../config/socket.js';

export const storeController = {
    postReqInventory: async (req, res) => {
        const { stockData } = req.body;

        // Validación básica de entrada
        if (!globalInventory) {
            return res.status(400).json({ message: 'Inventario global es requerido' });
        }

        try {

            // Procesamiento asíncrono para no bloquear el API
            setImmediate(() => {
                actualizarMapaGlobal(stockData[0].cCodigoTienda, stockData);
            });

        } catch (error) {
            console.error('Error en postReqInventory:', error); // Log para debug
            res.status(500).json({
                message: 'Error interno del servidor',
                error: process.env.NODE_ENV === 'development' ? error : {}
            });
        }
    },

    callInventoryStore: async (req, res) => { // Cuando el Dashboard de Angular pide actualizar
        const { marca } = req.body;
        try {
            console.log(`📢 Pidiendo inventario a todas las tiendas de: ${marca}`);
            getIO().to(marca).emit('py_request_inventory');
            res.json({ message: 'Se emitio señal de comprobacion.' });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    }
};

function actualizarMapaGlobal(serieStore, data) {
    data.forEach(item => {
        if (!globalStockMap.has(item.sku)) {
            globalStockMap.set(item.sku, { n: item.nombre, s: {} });
        }
        globalStockMap.get(item.sku).s[serieStore] = item.cantidad;
    });

    // Una vez procesado, avisamos por Socket al Dashboard de Angular
    getIO().emit('update_inventory', { storeId });

}