import { getIO } from '../config/socket.js';
import * as XLSX from 'xlsx';
import { emailService } from '../services/email.service.js';
import { Client } from "basic-ftp"
import fs from 'fs';
import { pool } from '../config/db.js';

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
    getTraspasos: async (req, res) => {
        try {
            // 1. Obtenemos todas las cabeceras
            const [headers] = await pool.query(`SELECT * FROM TB_HEAD_TRASPASOS ORDER BY ID_TRASPASOS DESC;`);

            if (!headers.length) {
                return res.status(200).json(mdwErrorHandler.error({
                    status: 200, type: 'OK', message: 'OK', api: '/transfers/all', data: []
                }));
            }

            // 2. Mapeamos las cabeceras y preparamos las promesas para los detalles
            // Esto evita el problema del "if (length - 1 == i)" que es muy propenso a errores
            const responseJSON = await Promise.all(headers.map(async (header) => {
                const [details] = await pool.query(
                    `SELECT * FROM TB_DETALLE_TRASPASOS WHERE CODIGO_TRASPASO = ?;`,
                    [header.CODIGO_TRASPASO]
                );

                return {
                    code_transfer: header.CODIGO_TRASPASO,
                    unid_service: header.UNIDAD_SERVICIO,
                    store_origin: header.TIENDA_ORIGEN,
                    store_destination: header.TIENDA_DESTINO,
                    code_warehouse_origin: header.CODIGO_ALM_ORIGEN,
                    code_warehouse_destination: header.CODIGO_ALM_DESTINO,
                    datetime: header.DATETIME,
                    detail: details.map(d => ({
                        barcode: d.CODIGO_BARRA,
                        article_code: d.CODIGO_ARTICULO,
                        description: d.DESCRIPCION,
                        size: d.TALLA,
                        color: d.COLOR,
                        stock: d.STOCK,
                        stock_required: d.STOCK_SOLICITADO,
                        status: d.ESTADO,
                        code_transfers: d.CODIGO_TRASPASO
                    }))
                };
            }));

            res.status(200).json({ data: responseJSON });

        } catch (err) {
            console.error("Error en allTransfers:", err);
            res.status(500).json({ status: 'error', message: err.message });
        }
    },
    postTraspasoBD: async (req, res) => {
        const {
            unid_service, store_origin, store_destination,
            code_warehouse_origin, code_warehouse_destination,
            datetime, details
        } = req.body;

        // 1. Obtener conexión del pool para la transacción
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // 2. Generar código de transferencia
            // Nota: Es mejor contar registros dentro de la transacción para evitar duplicados concurrentes
            const [rows] = await connection.query(`SELECT COUNT(*) as total FROM TB_HEAD_TRASPASOS`);
            const code_transfer = this.generarCodigoSerie(rows[0].total + 1, 'T', 6);

            // 3. Insertar Cabecera (Usando parámetros ? para seguridad)
            const sqlHead = `INSERT INTO TB_HEAD_TRASPASOS 
            (CODIGO_TRASPASO, UNIDAD_SERVICIO, TIENDA_ORIGEN, TIENDA_DESTINO, CODIGO_ALM_ORIGEN, CODIGO_ALM_DESTINO, DATETIME) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`;

            await connection.query(sqlHead, [
                code_transfer, unid_service, store_origin, store_destination,
                code_warehouse_origin, code_warehouse_destination, datetime
            ]);

            // 4. Insertar Detalles en paralelo
            if (details && details.length > 0) {
                const sqlDetail = `INSERT INTO TB_DETALLE_TRASPASOS 
                (CODIGO_BARRA, CODIGO_ARTICULO, DESCRIPCION, TALLA, COLOR, STOCK, STOCK_SOLICITADO, CODIGO_TRASPASO) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

                // Creamos un array de promesas para ejecutar todo de golpe
                const detailPromises = details.map(det =>
                    connection.query(sqlDetail, [
                        det.barcode, det.article_code, det.description,
                        det.size, det.color, det.stock, det.stock_required, code_transfer
                    ])
                );

                await Promise.all(detailPromises);
            }

            // 5. Confirmar cambios
            await connection.commit();

            res.status(200).json({ message: 'Traspaso registrado con éxito', data: { code_transfer } });

        } catch (err) {
            // Si algo falla, deshacemos todo lo anterior (Rollback)
            await connection.rollback();
            console.error("Error en inTransfers:", err);

            res.status(400).json({ status: 'error', message: err.message, });

        } finally {
            // Siempre liberar la conexión al pool
            connection.release();
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
            const targetDir = `ITPERU/${ftpDirectorio}` || `ITPERU/PRUEBA`;
            await client.ensureDir(targetDir);
            await client.uploadFrom(filePath, fileName);

            // 4. Preparar el contenido para RabbitMQ
            // Leemos el archivo para enviarlo como Buffer/Base64
            const fileBuffer = fs.readFileSync(filePath);

            emailService.pushToEmailQueue({
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