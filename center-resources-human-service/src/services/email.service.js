import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://dunamisserver:J4s0nd34d@192.168.0.200:5672';
const EMAIL_QUEUE = process.env.EMAIL_QUEUE || 'email_queue';

let connectionPromise;
let channelPromise;

const getChannel = async () => {
    if (!connectionPromise) {
        connectionPromise = amqp.connect(RABBITMQ_URL).catch((error) => {
            connectionPromise = null;
            throw error;
        });
    }

    if (!channelPromise) {
        channelPromise = connectionPromise.then(async (conn) => {
            conn.on('error', (error) => {
                console.error('RabbitMQ error:', error.message);
            });
            conn.on('close', () => {
                connectionPromise = null;
                channelPromise = null;
                console.error('RabbitMQ conexion cerrada');
            });

            const channel = await conn.createChannel();
            await channel.assertQueue(EMAIL_QUEUE, { durable: true });
            return channel;
        }).catch((error) => {
            channelPromise = null;
            throw error;
        });
    }

    return channelPromise;
};

export const emailService = {
    async pushToEmailQueue(data, archivo = null) {
        const channel = await getChannel();

        const payload = {
            to: data.email,
            subject: data.subject,
            template: data.template,
            context: data.variables,
            archivo: data.archivo ? {
                filename: data.archivo.filename,
                content: data.archivo.content.toString('base64'),
                encoding: 'base64'
            } : []
        };

        channel.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(payload)), {
            persistent: true
        });

        return "Los correos se enviaron a la cola de envios";
    }
};
