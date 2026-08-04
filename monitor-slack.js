require('dotenv').config();
const pm2 = require('pm2');
const https = require('https');
const { URL } = require('url');

// ─── CONFIGURA AQUÍ ───
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const INTERVALO_SEGUNDOS = 5;
// ──────────────────────

const hostname = require('os').hostname();
let estadosAnteriores = {};

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
    res.on('data', () => {});
    res.on('end', () => {
      console.log(`[${new Date().toLocaleString()}] ✅ Slack: ${mensaje.split('\n')[0]}`);
    });
  });

  req.on('error', (e) => {
    console.error('❌ Error Slack:', e.message);
  });

  req.write(payload);
  req.end();
}

function verificarProcesos() {
  pm2.list((err, procesos) => {
    if (err) {
      console.error('Error listando procesos:', err);
      return;
    }

    procesos.forEach((proc) => {
      const nombre = proc.name;
      const estado = proc.pm2_env.status;
      const id = proc.pm_id;
      const anterior = estadosAnteriores[nombre];

      // Ignorar el propio monitor para no alertar de sí mismo
      if (nombre === 'monitor-slack') return;

      if (anterior && anterior !== estado) {
        const hora = new Date().toLocaleString();

        if (estado === 'online' && (anterior === 'stopped' || anterior === 'errored')) {
          // ✅ RECUPERADO
          enviarSlack(`✅ *SERVICIO RECUPERADO*\n\n*Servicio:* \`${nombre}\` (ID: ${id})\n*Servidor:* ${hostname}\n*Hora:* ${hora}\n\nEl servicio volvió a estar online.`);
        }
        else if (estado === 'stopped' || estado === 'errored') {
          // 🚨 CAÍDO
          const logPath = proc.pm2_env.pm_out_log_path || 'N/A';
          enviarSlack(`🚨 *ALERTA: Servicio caído*\n\n*Servicio:* \`${nombre}\` (ID: ${id})\n*Estado:* ${estado}\n*Servidor:* ${hostname}\n*Hora:* ${hora}\n\nRevisa logs: \`pm2 logs ${nombre}\``);
        }
      }

      estadosAnteriores[nombre] = estado;
    });
  });
}

pm2.connect((err) => {
  if (err) {
    console.error('Error conectando a PM2:', err);
    process.exit(2);
  }

  console.log('🔍 Monitor de PM2 + Slack iniciado (modo polling)...');

  // Primera lectura para inicializar estados
  pm2.list((err, procesos) => {
    if (!err) {
      procesos.forEach((proc) => {
        if (proc.name !== 'monitor-slack') {
          estadosAnteriores[proc.name] = proc.pm2_env.status;
        }
      });
      console.log('📋 Procesos monitoreados:', Object.keys(estadosAnteriores).join(', '));
    }
  });

  // Revisar cada X segundos
  setInterval(verificarProcesos, INTERVALO_SEGUNDOS * 1000);
});