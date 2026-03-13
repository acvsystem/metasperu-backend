import { getIO } from '../config/socket.js';

const inventariosPorMarca = new Map();

export const storeController = {
    postReqInventory: async (req, res) => {
        const { stockData, marca } = req.body; // Asegúrate que Python envíe la marca

        if (!stockData || !marca) {
            return res.status(400).json({ message: 'Data y Marca son requeridos' });
        }

        try {
            // Inicializar el mapa para la marca si no existe
            if (!inventariosPorMarca.has(marca)) {
                inventariosPorMarca.set(marca, new Map());
            }

            setImmediate(() => {
                actualizarMapaPorMarca(marca, stockData[0].cCodigoTienda, stockData);
            });

            res.status(200).json({ message: 'Procesando...' });
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },

    callInventoryStore: async (req, res) => { // Cuando el Dashboard de Angular pide actualizar
        const { marca } = req.params;
        try {
            console.log(`📢 Pidiendo inventario a todas las tiendas de: ${marca}`);
            getIO().to(marca).emit('py_request_inventory');
            res.json({ message: 'Se emitio señal de comprobacion.', online: await getActiveStoresByBrand(marca) });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },

    getConsolidatedInventory: async (req, res) => {
        const { marca } = req.params; // Viene de la URL /inventory/:marca
        try {
            const mapaMarca = inventariosPorMarca.get(marca);

            if (!mapaMarca) {
                return res.json({ inventory: [], online: await getActiveStoresByBrand(marca) });
            }

            const consolidated = Array.from(mapaMarca.values());
            res.json({
                inventory: consolidated,
                online: await getActiveStoresByBrand(marca)
            });
        } catch (error) {
            res.status(500).json({ message: 'Error', error });
        }
    }
};

async function getActiveStoresByBrand(marca) {
    // Obtenemos todos los sockets que están en la sala (VICTORIA o BATH_BODY)
    const sockets = await getIO().in(marca).fetchSockets();

    // Extraemos el tiendaId que guardamos al momento del register_store
    const onlineStores = sockets.map(socket => ({
        tiendaId: socket.tiendaId, // El ID que asignamos en el evento 'register_store'
        lastConnected: new Date()
    }));
    console.log(`Tiendas activas para marca ${marca}:`, onlineStores);
    return onlineStores;
}

function actualizarMapaPorMarca(marca, serieStore, data) {
    const mapaMarca = inventariosPorMarca.get(marca);

    data.forEach(item => {
        if (!mapaMarca.has(item.cCodigoBarra)) {
            mapaMarca.set(item.cCodigoBarra, {
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
                'cTemporada': item.cTemporada,
                'cStock': {}, // Aquí guardaremos los stocks de cada tienda
                'marca': marca
            });
        }
        // Asignamos el stock de la tienda específica
        mapaMarca.get(item.cCodigoBarra).cStock[serieStore] = item.cStock;
    });

    console.log(`✅ [${marca}] Actualizada tienda ${serieStore}. SKUs: ${mapaMarca.size}`);
    getIO().emit('update_inventory', { serieStore, marca });
}