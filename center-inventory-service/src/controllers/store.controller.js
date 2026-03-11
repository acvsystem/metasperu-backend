import { getIO } from '../config/socket.js';

const inventarioGlobal = new Map();

export const storeController = {
    postReqInventory: async (req, res) => {
        const { stockData } = req.body;

        // Validación básica de entrada
        if (!stockData) {
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
        if (!inventarioGlobal.has(item.cCodigoBarra)) {
            inventarioGlobal.set(item.cCodigoBarra, {
                'cCodigoTienda': serieTienda,
                'cCodigoArticulo': item.cCodigoArticulo,
                'cReferencia': item.cReferencia,
                'cCodigoBarra': item.cCodigoBarra,
                'cDescripcion': item.cDescripcion,
                'cDepartamento': item.cDepartamento,
                'cSeccion': item.cSeccion,
                'cFamilia': item.cFamilia,
                'cSubFamilia': item.cSubFamilia,
                'cTalla': item.cTalla,
                'cColor': item.cColor,
                'cStock': item.cStock,
                'cTemporada': item.cTemporada
            });
        }
        inventarioGlobal.get(item.cCodigoBarra).cStock[serieStore] = item.cStock;
    });

    console.log(inventarioGlobal);
    console.log(`✅ Inventario actualizado para tienda ${serieStore}. Total SKUs en mapa: ${inventarioGlobal.size}`);
    // Una vez procesado, avisamos por Socket al Dashboard de Angular
    // getIO().emit('update_inventory', { storeId });

}