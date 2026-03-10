import { mailer } from './mailer.js';
const amqp = require('amqplib');

async function startWorker() {
    try {
        // 1. Conexión al servidor de mensajería (RabbitMQ)
        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
        const channel = await connection.createChannel();

        const queue = 'email_queue';

        // 2. Asegurar que la cola existe
        await channel.assertQueue(queue, {
            durable: true // La cola sobrevive a reinicios del servidor
        });

        // Prefetch: Solo procesa 1 mensaje a la vez para no saturar el servicio
        channel.prefetch(1);

        console.log(`[📧 Email Worker] Esperando mensajes en la cola: ${queue}`);

        // 3. Consumir mensajes
        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                const payload = JSON.parse(msg.content.toString());
                const { to, subject, template, context } = payload;

                console.log(`[📩 Procesando] Enviando correo a: ${to} - Plantilla: ${template}`);

                try {
                    // Llamamos a la función de mailer.js que configuramos antes
                    await mailer.sendMail(to, subject, template, context);

                    // Confirmar que el mensaje fue procesado con éxito
                    channel.ack(msg);
                    console.log(`[✅ Éxito] Correo enviado correctamente.`);
                } catch (error) {
                    console.error(`[❌ Error] No se pudo enviar el correo:`, error);

                    // Si falla, el mensaje vuelve a la cola para reintentar después de 5 segundos
                    setTimeout(() => {
                        channel.nack(msg, false, true);
                    }, 5000);
                }
            }
        });

    } catch (error) {
        console.error("[🚨 Fatal] Error al conectar con RabbitMQ:", error);
        // Reintentar conexión si falla el broker
        setTimeout(startWorker, 10000);
    }
}

startWorker();