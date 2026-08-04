const pm2 = require('pm2');
const https = require('https');
const { URL } = require('url');
const { exec } = require('child_process');

// ─── CONFIGURA AQUÍ ───
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const MAX_LOG_LINES = 15; // Cuántas líneas del log incluir en la alerta
// ──────────────────────

const hostname = require('os').hostname();

function enviarSlack(mensaje) {
  const url = new URL(SLACK_WEBHOOK_URL);
  const payload = JSON.stringify({
    text: mensaje,
    username: 'PM2 Monitor',
    icon_emoji: ':warning:',
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
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log(`[${new Date().toLocaleString()}] ✅ Alerta enviada a Slack`);
      } else {
        console.error(`❌ Error Slack: ${res.statusCode} - ${data}`);
      }
    });
  });

  req.on('error', (e) => {
    console.error('Error enviando a Slack:', e.message);
  });

  req.write(payload);
  req.end();
}

// Obtiene las últimas líneas del log de un proceso
function obtenerLog(procName, callback) {
  exec(`pm2 logs ${procName} --lines ${MAX_LOG_LINES} --nostream`, (error, stdout) => {
    if (error) {
      callback('No se pudo obtener el log.');
      return;
    }
    // Limpiamos y truncamos el log para Slack
    const logLimpio = stdout
      .split('\n')
      .slice(-MAX_LOG_LINES)
      .join('\n')
      .substring(0, 2800); // Slack tiene límite de ~4000 chars
    callback(logLimpio || 'Log vacío');
  });
}

pm2.connect((err) => {
  if (err) {
    console.error('Error conectando a PM2:', err);
    process.exit(2);
  }

  console.log('🔍 Monitor de PM2 + Slack iniciado...');

  pm2.launchBus((err, bus) => {
    if (err) throw err;

    // 🚨 SERVICIO CAÍDO
    bus.on('process:exit', (packet) => {
      console.log('>>> EVENTO EXIT DISPARADO:', packet.process.name)
      const proc = packet.process;
      const nombre = proc.name;
      const id = proc.pm_id;

      obtenerLog(nombre, (log) => {
        const mensaje = `🚨 *ALERTA: Servicio caído*\n\n*Servicio:* \`${nombre}\` (ID: ${id})\n*Servidor:* ${hostname}\n*Hora:* ${new Date().toLocaleString()}\n\n*Últimas líneas del log:*\n\`\`\`\n${log}\n\`\`\``;

        enviarSlack(mensaje);
      });
    });

    // ⚠️ EXCEPCIÓN NO MANEJADA
    bus.on('process:exception', (packet) => {
        console.log('>>> EVENTO EXIT DISPARADO:', packet.process.name);
      const proc = packet.process;
      const errorMsg = packet.data?.message || packet.data || 'Error desconocido';

      const mensaje = `⚠️ *EXCEPCIÓN EN SERVICIO*\n\n*Servicio:* \`${proc.name}\`\n*Error:* \`${errorMsg}\`\n*Servidor:* ${hostname}\n*Hora:* ${new Date().toLocaleString()}\n\nRevisa con: \`pm2 logs ${proc.name}\``;

      enviarSlack(mensaje);
    });

    // ✅ SERVICIO RECUPERADO (online)
    bus.on('process:online', (packet) => {
        console.log('>>> EVENTO EXIT DISPARADO:', packet.process.name);
      const proc = packet.process;
      const nombre = proc.name;
      const id = proc.pm_id;

      const mensaje = `✅ *SERVICIO RECUPERADO*\n\n*Servicio:* \`${nombre}\` (ID: ${id})\n*Servidor:* ${hostname}\n*Hora:* ${new Date().toLocaleString()}\n\nEl servicio está funcionando correctamente de nuevo.`;

      enviarSlack(mensaje);
    });
  });
});