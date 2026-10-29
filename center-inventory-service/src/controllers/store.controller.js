import { reportCenterError } from '../../../shared/center-diagnostics.mjs';
import { createTransferHistory,createTransferRegistration } from '../../../shared/center-transfers.mjs';
import { getIO } from '../config/socket.js';
import { buildCenterWorkbook } from '../../../shared/center-workbook.mjs';
import { emailService } from '../services/email.service.js';
import { Client } from "basic-ftp"
import fs from 'fs';
import { pool } from '../config/db.js';

const inventariosPorMarca = new Map();

export const storeController = {
    postReqInventory: async (req, res) => {
        const { stockData, marca, socketId } = req.body; // Asegúrate que Python envíe la marca

        if (!stockData || !marca) {
            return res.status(400).json({ message: 'Data y Marca son requeridos' });
        }

        try {
            if (stockData.length > 0) {
                // Inicializar el mapa para la marca si no existe
                if (!inventariosPorMarca.has(marca)) {
                    inventariosPorMarca.set(marca, new Map());
                }
                console.log("center-inventory-service: evento procesado (store.controller.js:25)");
                setImmediate(() => {
                    actualizarMapaPorMarca(marca, stockData[0].cCodigoTienda, stockData, socketId);
                });

                res.status(200).json({ message: 'Procesando...' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error interno' });
        }
    },
    postSendInventoryStoreEmail: async (req, res) => {
        const { stockData, email, nombre, serie } = req.body;
        console.log("Solicitud de envío de inventario a email:");

        try {

            if (!stockData || !email || !nombre || !serie) {
                return res.status(400).json({ message: 'No se proporcionaron sedes válidas.' });
            }

            // 1. Generar el Excel (Asumiendo que dataNotFound viene de algún proceso previo o del store)
            const dataToExport = stockData || []; // Usa los datos reales de la tienda
            const xlsFile=await buildCenterWorkbook(import.meta.resolve('exceljs/dist/exceljs.min.js'),{rows:dataToExport,sheetName:'Inventario'});

            // 2. Encolar el email
            const results = await emailService.pushToEmailQueue({
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
            reportCenterError('center-inventory-service.store.controller.79',error);
            return res.status(500).json({ message: 'Error al procesar el envío de inventarios' });
        }
    },
    callInventoryStore: async (req, res) => { // Cuando el Dashboard de Angular pide actualizar
        const { marca, socketId } = req.params;
        try {
            console.log("center-inventory-service: evento procesado (store.controller.js:86)");
            getIO().to(marca).emit('py_request_inventory', { email: "", isEmail: false, socketId: socketId }); // El email es opcional aquí, solo queremos que respondan con su stock actual
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
    getTraspasos: createTransferHistory(pool),
    postTraspasoBD: createTransferRegistration(pool),
    callTraspasosFTP: async (req, res) => {
        // 1. Validaciones iniciales
        if (!req.file) {
            return res.status(400).send('No se recibió ningún archivo.');
        }

        if(!req.file)return res.status(422).json({message:'Seleccione un archivo XLSX o CSV.'});
        const { path: filePath, originalname: fileName } = req.file;
        const { ftpDirectorio, origenStore, destinoStore, email } = req.body;
        if(typeof ftpDirectorio!=='string'||!/^[a-zA-Z0-9 _/-]{1,120}$/.test(ftpDirectorio)||ftpDirectorio.includes('..')) return res.status(422).json({message:'Directorio de destino invalido.'});


        // Obtenemos la hora para el template
        const ahora = new Date();
        const fechaPE = ahora.toLocaleDateString('es-PE');
        const horaPE = ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

        const client = new Client();
        client.ftp.verbose = false; // Desactivar en producción para no llenar logs

        try {
            // 2. Conexión al FTP (Idealmente usar variables de entorno)
            await client.access({ host:process.env.CENTER_FTP_HOST, user:process.env.CENTER_FTP_USER,
                password:process.env.CENTER_FTP_PASSWORD, secure:true });

            // 3. Subida al FTP
            // Usamos la ruta dinámica que viene en el body o la de prueba
            const targetDir = `ITPERU/${ftpDirectorio}` || `ITPERU/PRUEBA`;
            await client.ensureDir(targetDir);
            await client.uploadFrom(filePath, fileName);

            // 4. Preparar el contenido para RabbitMQ
            // Leemos el archivo para enviarlo como Buffer/Base64
            const fileBuffer = await fs.promises.readFile(filePath);

            let emailQueued=true;
            try { await emailService.pushToEmailQueue({
                email: ['carlosmoron@metasperu.com', 'paulodosreis@metasperu.com', 'itperu@metasperu.com', 'johnnygermano@metasperu.com'], // Fallback si no viene en req.body
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
            }); } catch { emailQueued=false; }

            res.status(200).json({
                emailQueued,
                status: 'success',
                message: emailQueued?'Archivo de traspaso enviado.':'Archivo enviado; el aviso de correo no fue confirmado.'
            });

        } catch (err) {
            reportCenterError('center-inventory-service.store.controller.209',undefined);
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
                        if (unlinkErr) reportCenterError('center-inventory-service.store.controller.222',undefined);
                    });
                }
            });
        }
    },
    callInventorySearchCodebar: async (req, res) => {
        const { codigo_barra, marca, socketId } = req.body;
        try {

            if (!marca.length || !socketId.length || !codigo_barra.length) {
                return res.json({ message: 'Código de barra ,marca y  ID de socket son requeridos' });
            }

            const io = getIO();

            // 1. Obtenemos la sala desde el adapter
            const sala = io.sockets.adapter.rooms.get(marca);

            // 2. Verificamos si existe y si tiene miembros
            if (sala && sala.size > 0) {
                console.log("center-inventory-service: evento procesado (store.controller.js:243)");
            } else {
                console.log("center-inventory-service: evento procesado (store.controller.js:245)");
            }

            getIO().to(marca).emit('py_request_one_store_inventory', { pedido_por: socketId, dataCode: [{ 'codigo_barra': codigo_barra, 'cantidad_solicitada': '1' }] });

            res.status(200).json({ message: 'Solicitud de inventario enviada correctamente' });
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
    console.log("center-inventory-service: evento procesado (store.controller.js:266)");
    return onlineStores;
}

function actualizarMapaPorMarca(marca, serieStore, data, socketId) {
    const mapaMarca = inventariosPorMarca.get(marca);

    // 1. Creamos un Set con los códigos de barra que vienen en el nuevo envío para búsqueda rápida
    const codigosNuevos = new Set(data.map(item => item.cCodigoBarra));

    // 2. Primero, limpiamos/ponemos en 0 el stock de los productos que YA NO vienen en esta tienda
    for (const [cCodigoBarra, producto] of mapaMarca.entries()) {
        // Si el producto tiene stock registrado en esta tienda, pero ya no vino en la data nueva
        if (producto.cStock[serieStore] !== undefined && !codigosNuevos.has(cCodigoBarra)) {
            producto.cStock[serieStore] = 0; // O puedes usar 'delete producto.cStock[serieStore]' si prefieres removerlo por completo
        }
    }

    // 3. Procesamos y actualizamos con la data nueva (tu lógica original mejorada)
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
                'cEsnencia': item.cEsnencia,
                'cStyleDesc': item.cStyleDesc,
                'cStock': {}, // Aquí guardaremos los stocks de cada tienda
                'marca': marca
            });
        }
        // Asignamos el stock real de la tienda específica
        mapaMarca.get(item.cCodigoBarra).cStock[serieStore] = item.cStock;
    });

    console.log("center-inventory-service: evento procesado (store.controller.js:309)");
    getIO().to(socketId).emit('update_inventory', { serieStore, marca });
}


function generarCodigoSerie(numero, prefijo = 'T', longitud = 6) {
    const numeroFormateado = numero.toString().padStart(longitud, '0');
    return `${prefijo}${numeroFormateado}`;
}