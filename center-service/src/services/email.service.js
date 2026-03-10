import amqp from 'amqplib';

export const emailService = {

    async pushToEmailQueue(data) {
        console.log("Enviando mensaje a la cola de correos:", data);
        const conn = await amqp.connect('amqp://dunamisserver:J4s0nd34d@192.168.0.200:5672');
        const channel = await conn.createChannel();
        const queue = 'email_queue';

        await channel.assertQueue(queue, { durable: true });

        // El payload debe coincidir con lo que espera el worker
        const payload = {
            to: data.email,
            subject: data.subject,
            template: data.template, // ej: 'welcome'
            context: data.variables   // ej: { name: 'Usuario', store: 'Lince' }
        };

        channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
            persistent: true // El mensaje se guarda en disco
        });

        console.log("Mensaje enviado a la cola de correos");
        setTimeout(() => conn.close(), 500);
    }

}