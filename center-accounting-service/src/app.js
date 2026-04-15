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
cron.schedule('19 17 * * *', async () => {
  console.log('⏰ [Cron Job] Iniciando comprobación diaria de Tipo de Cambio...');

  const fechaHoy = new Date().toISOString().split('T')[0];
  const API_TOKEN = '8a02ec4cc1f4618487ff6a58100299a7dd02bc4ec60e3c8959d97dfd7becdf6b';
  const URL_APIPERU = 'https://apiperu.dev/api/tipo-de-cambio';

  try {
    // 1. Verificar si ya lo tenemos en nuestra tabla de caché local
    const [rows] = await pool.execute(
      'SELECT id FROM tb_tipo_cambio_cache WHERE fecha = ?',
      [fechaHoy]
    );

    if (rows.length === 0) {
      console.log(`🌐 [Cron] No hay TC local para ${fechaHoy}. Consultando API externa...`);

      const response = await axios.post(URL_APIPERU,
        { fecha: fechaHoy },
        { headers: { 'Authorization': `Bearer ${API_TOKEN}` } }
      );

      if (response.data.success) {
        const { compra, venta } = response.data.data;

        // 2. Guardar en la DB local
        await pool.execute(
          'INSERT INTO tb_tipo_cambio_cache (fecha, compra, venta) VALUES (?, ?, ?)',
          [fechaHoy, compra, venta]
        );
        console.log(`✅ [Cron] TC Guardado localmente: Compra ${compra} - Venta ${venta}`);

        await extraServices.enviarSlack(`✅ *Sincronización Exitosa*\n*Fecha:* ${fechaHoy}\n*Compra:* ${compra}\n*Venta:* ${venta}`, "Monitor de Tipo de Cambio");

        // 3. Opcional: Notificar a todas las tiendas por Socket
        const io = initSocket(); // Si tienes una función para obtener la instancia de socket
        io.to('7A').emit('py_request_exchange_rate', { pedido_por: 'cron_accounting', init: fechaHoy, end: fechaHoy });
      }
    } else {
      console.log(`✅ [Cron] El tipo de cambio para hoy (${fechaHoy}) ya existe en la DB local.${rows[0]}`);

      await extraServices.enviarSlack(`⚠️ [Cron] El tipo de cambio para hoy (${fechaHoy}), Venta: ${rows[0].venta} ya existe en la DB local.`, "Monitor de Tipo de Cambio");

      const io = initSocket(); // Si tienes una función para obtener la instancia de socket
      io.to('7A').emit('py_request_exchange_rate', { pedido_por: 'cron_accounting', init: fechaHoy, end: fechaHoy });
    }

  } catch (error) {
    console.error('❌ [Cron Error]:', error.message);
  }
}, {
  scheduled: true,
  timezone: "America/Lima" // Configurado para hora de Perú
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