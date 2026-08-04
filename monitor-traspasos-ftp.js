require('dotenv').config({ path: '/home/aplication/backend/microservices/metasperu-backend/.env' });

const ftp = require('basic-ftp');
const https = require('https');
const { URL } = require('url');

// ─── CONFIGURACIÓN ───
const FTP_HOST     = process.env.FTP_HOST;
const FTP_USER     = process.env.FTP_USER;
const FTP_PASS     = process.env.FTP_PASS;
const FTP_PATH     = process.env.FTP_PATH || '/'; // carpeta a monitorear
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const INTERVALO_MS = (process.env.FTP_INTERVAL_SEC || 30) * 1000; // cada 30 seg
// ─────────────────────

const hostname = require('os').hostname();
let habiaArchivos = false; // memoria del estado anterior

function enviarSlack(mensaje) {
  const url = new URL(SLACK_WEBHOOK_URL);
  const payload = JSON.stringify({
    text: mensaje,
    username: 'FTP Monitor',
    icon_emoji: ':inbox_tray:',
  });

  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = https.request(options, (res) => {
    res.on('data', () => {});
    res.on('end', () => {
      console.log(`[${new Date().toLocaleString()}] ✅ Slack: ${mensaje.split('\n')[0]}`);
    });
  });

  req.on('error', (e) => console.error('❌ Error Slack:', e.message));
  req.write(payload);
  req.end();
}

async function revisarFTP() {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASS,
      secure: false, // cambia a true si usas FTPS
    });

    const lista = await client.list(FTP_PATH);
    const archivos = lista.filter(item => item.type === 1 || item.type === 2); // archivos o links
    const cantidad = archivos.length;

    console.log(`[${new Date().toLocaleString()}] 📂 ${FTP_HOST}${FTP_PATH} → ${cantidad} archivo(s)`);

    // Transición: había archivos → ahora no hay
    if (habiaArchivos && cantidad === 0) {
      enviarSlack(`✅ *Proceso FTP completado*\n\nLa carpeta \`${FTP_PATH}\` en \`${FTP_HOST}\` está ahora **vacía**.\nEl sistema terminó de procesar todos los archivos.\n\n*Servidor:* ${hostname}\n*Hora:* ${new Date().toLocaleString()}`);
    }

    habiaArchivos = cantidad > 0;

  } catch (err) {
    console.error(`[${new Date().toLocaleString()}] ❌ Error FTP:`, err.message);
    // No enviamos alerta de error a Slack para no spamear, solo log local
  } finally {
    client.close();
  }
}

// Primera revisión
revisarFTP();

// Revisar periódicamente
setInterval(revisarFTP, INTERVALO_MS);

console.log(`🔍 Monitor FTP iniciado → ${FTP_HOST}${FTP_PATH} cada ${INTERVALO_MS/1000}s`);