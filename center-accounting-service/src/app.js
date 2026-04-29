import express from 'express';
import { createServer } from 'http';
import { initSocket } from './config/socket.js';
import cors from 'cors';
import cron from 'node-cron';
import axios from 'axios';
import { pool } from './config/db.js'; // Asegúrate de que la ruta a tu DB sea correcta
import { extraServices } from './services/extra.services.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getIO } from './config/socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Esto fuerza a buscar el .env en la carpeta padre de 'src'
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const httpServer = createServer(app);

// Inicializar Sockets
initSocket(httpServer);

// Middleware
app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- AUTOMATIZACIÓN: CRON JOB A LAS 9:00 AM ---
cron.schedule('36 11 * * *', async () => {
  console.log('⏰ [Cron Job] Iniciando comprobación diaria de Tipo de Cambio...');

  // 1. Asegurar fecha correcta en Lima (evita desfases de UTC)
  const fechaHoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  // 2. Usar variables de entorno (Seguridad)
  const API_TOKEN = process.env.APIPERU_TOKEN;
  const URL_APIPERU = 'https://apiperu.dev/api/tipo-de-cambio';

  try {
    // Buscar en caché local
    const [rows] = await pool.execute(
      'SELECT compra, venta FROM tb_tipo_cambio_cache WHERE fecha = ?',
      [fechaHoy]
    );

    let datosTC = null;

    if (rows.length === 0) {
      console.log(`🌐 [Cron] Consultando API externa para ${fechaHoy}...`);

      const response = await axios.post(URL_APIPERU,
        { fecha: fechaHoy },
        { headers: { 'Authorization': `Bearer ${API_TOKEN}` } }
      );

      if (response.data.success) {
        datosTC = response.data.data;

        // Guardar/Actualizar en DB local
        await pool.execute(
          'INSERT INTO tb_tipo_cambio_cache (fecha, compra, venta) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE compra=?, venta=?',
          [fechaHoy, datosTC.compra, datosTC.venta, datosTC.compra, datosTC.venta]
        );

        await extraServices.enviarSlack(
          `✅ *Sincronización Exitosa*\n*Fecha:* ${fechaHoy}\n*Compra:* ${datosTC.compra}\n*Venta:* ${datosTC.venta}`,
          "Monitor de Tipo de Cambio"
        );
      }
    } else {
      datosTC = rows[0];
      console.log(`✅ [Cron] TC ya existe localmente para ${fechaHoy}`);

      await extraServices.enviarSlack(
        `⚠️ *Aviso:* El TC para hoy ya estaba registrado.\n*Fecha:* ${fechaHoy}\n*Venta:* ${datosTC.venta}`,
        "Monitor de Tipo de Cambio"
      );
    }

    // 3. Notificación vía Socket (Fuera del if para no repetir código)
    if (datosTC) {
     
      getIO().to('7A').emit('py_request_exchange_rate', {
        pedido_por: 'cron_accounting',
        init: fechaHoy,
        end: fechaHoy,
        data: datosTC
      });
      console.log(`📡 Evento de socket emitido para la tienda 7A`);
    }

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message;
    console.error('❌ [Cron Error]:', errorMsg);
    await extraServices.enviarSlack(`🚨 *Error en Cron Job*\nDetalle: ${errorMsg}`, "Monitor de Tipo de Cambio");
  }
}, {
  scheduled: true,
  timezone: "America/Lima"
});

// Rutas
import accountingRoutes from './routes/accounting.routes.js';
app.use('/s6/center/accounting', accountingRoutes);

// Servidor
const PORT = 3006;
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
  console.log(`📅 Tarea programada configurada para las 09:00 AM (Lima)`);
});