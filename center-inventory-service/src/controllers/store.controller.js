import { getIO } from '../config/socket.js';
import * as XLSX from 'xlsx';
import { emailService } from '../services/email.service.js';
import { Client } from "basic-ftp"
import fs from 'fs';

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
    postSendInventoryStoreEmail: async (req, res) => {
        const { stockData, email, nombre, serie } = req.body;
        console.log("Solicitud de envío de inventario a email:", email, nombre, serie);

        try {

            if (!stockData || !email || !nombre || !serie) {
                return res.status(400).json({ message: 'No se proporcionaron sedes válidas.' });
            }

            // 1. Generar el Excel (Asumiendo que dataNotFound viene de algún proceso previo o del store)
            const dataToExport = stockData || []; // Usa los datos reales de la tienda
            const workSheet = XLSX.utils.json_to_sheet(dataToExport);
            const workBook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workBook, workSheet, "Inventario");

            const xlsFile = XLSX.write(workBook, { bookType: "xlsx", type: "buffer" });

            // 2. Encolar el email
            const results = emailService.pushToEmailQueue({
                email: email,
                subject: `Inventario - ${nombre}`,
                template: 'solicitudInventario',
                variables: {
                    email: email,
                    tienda: nombre,
                    fecha: new Date().toLocaleDateString('es-PE')
                },
                // En lugar de enviar solo el buffer, enviamos un objeto descriptivo
                archivo: {
                    filename: `inventario_${nombre.replace(/\s+/g, '_')}.xlsx`,
                    content: xlsFile // Este es el Buffer generado por XLSX.write
                }
            });


            // Respondemos UNA sola vez al finalizar todo
            return res.status(200).json({
                message: 'Correos encolados exitosamente',
                detalles: results
            });

        } catch (error) {
            console.error('Error en postSendInventoryStoreEmail:', error);
            return res.status(500).json({ message: 'Error al procesar el envío de inventarios' });
        }
    },
    callInventoryStore: async (req, res) => { // Cuando el Dashboard de Angular pide actualizar
        const { marca } = req.params;
        try {
            console.log(`📢 Pidiendo inventario a todas las tiendas de: ${marca}`);
            getIO().to(marca).emit('py_request_inventory', { email: "", isEmail: false }); // El email es opcional aquí, solo queremos que respondan con su stock actual
            res.json({ message: 'Se emitio señal de comprobacion.', online: await getActiveStoresByBrand(marca) });
        } catch (error) {
            res.status(500).json({ message: 'Error en envio de señal', error });
        }
    },
    getConsolidatedInventory: async (req, res) => {
        const { marca, serieStore } = req.params; // Viene de la URL /inventory/:marca
        try {
            const mapaMarca = inventariosPorMarca.get(marca);

            if (!mapaMarca) {
                return res.json({ inventory: [], online: await getActiveStoresByBrand(marca) });
            }

            const consolidated = Array.from(mapaMarca.values());
            res.json({
                serie: serieStore,
                inventory: consolidated,
                online: await getActiveStoresByBrand(marca)
            });
        } catch (error) {
            res.status(500).json({ message: 'Error', error });
        }
    },
    callSendInventoryStoreEmail: async (req, res) => {
        const { email, serieStore } = req.body;
        try {
            if (!serieStore.length || !email) {
                return res.json({ message: 'Email y Serie de tienda son requeridos' });
            }

            serieStore.map((store) => {
                getIO().to(store.serie).emit('py_request_inventory', { email: email, isEmail: true }); // Indicamos que es para envío de email
            });

            res.json({
                message: 'Se realizo la solicitud de envio de inventario.'
            });
        } catch (error) {
            res.status(500).json({ message: 'Error', error });
        }
    },
    callInventoryOneStore: async (req, res) => {
        const { serieStore, socketId, dataCode } = req.body;
        try {

            if (!serieStore.length || !dataCode.length || !socketId.length) {
                return res.json({ message: 'Serie de tienda, código de datos y ID de socket son requeridos' });
            }

            getIO().to(serieStore).emit('py_request_one_store_inventory', { pedido_por: socketId, dataCode: dataCode });

            res.status(200).json({ message: 'Solicitud de inventario enviada correctamente' });
        } catch (error) {
            res.status(500).json({ message: 'Error', error });
        }
    },
    callTraspasosFTP: async (req, res) => {
        // 1. Validaciones iniciales
        if (!req.file) {
            return res.status(400).send('No se recibió ningún archivo.');
        }

        const { path: filePath, originalname: fileName } = req.file;
        const { ftpDirectorio, origenStore, destinoStore, email } = req.body;

        // Obtenemos la hora para el template
        const ahora = new Date();
        const fechaPE = ahora.toLocaleDateString('es-PE');
        const horaPE = ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

        const client = new Client();
        client.ftp.verbose = false; // Desactivar en producción para no llenar logs

        try {
            // 2. Conexión al FTP (Idealmente usar variables de entorno)
            await client.access({
                host: process.env.FTP_HOST || '199.89.54.31',
                port: 9879,
                user: process.env.FTP_USER || 'ftpuser25801247',
                password: process.env.FTP_PASSWORD || 'Cfz&}q)]i_^c~6MSVPI%',
                secure: false
            });

            // 3. Subida al FTP
            // Usamos la ruta dinámica que viene en el body o la de prueba
            const targetDir = ftpDirectorio || `ITPERU/PRUEBA`;
            await client.ensureDir(targetDir);
            await client.uploadFrom(filePath, fileName);

            // 4. Preparar el contenido para RabbitMQ
            // Leemos el archivo para enviarlo como Buffer/Base64
            const fileBuffer = fs.readFileSync(filePath);

            emailService.pushToEmailQueue({
                email: email || 'andrecv@gmail.com', // Fallback si no viene en req.body
                subject: `Traspaso Realizado - ${origenStore} a ${destinoStore}`,
                template: 'confirmacionTraspaso',
                variables: {
                    tienda_origen: origenStore || 'ORIGEN DESCONOCIDO',
                    tienda_destino: destinoStore || 'DESTINO DESCONOCIDO',
                    carpeta_destino: targetDir,
                    fecha: fechaPE,
                    hora: horaPE
                },
                // Usamos la estructura de adjuntos (compatible con lo anterior)
                archivo:
                {
                    filename: fileName,
                    content: fileBuffer.toString('base64')
                }
            });

            res.status(200).json({
                status: 'success',
                message: 'Traspaso realizado exitosamente.'
            });

        } catch (err) {
            console.error(`Error en Traspaso FTP: ${err.message}`);
            res.status(500).json({
                status: 'error',
                message: 'Error en el proceso de traspaso: ' + err.message
            });
        } finally {
            client.close();

            // 5. Limpieza garantizada del archivo temporal
            // Usamos la versión asíncrona para no bloquear el event loop
            fs.access(filePath, fs.constants.F_OK, (err) => {
                if (!err) {
                    fs.unlink(filePath, (unlinkErr) => {
                        if (unlinkErr) console.error(`No se pudo borrar temporal: ${filePath}`);
                    });
                }
            });
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