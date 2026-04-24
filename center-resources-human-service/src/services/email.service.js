import amqp from 'amqplib';

export const emailService = {

    async pushToEmailQueue(data, archivo = null) {
        console.log("Enviando mensaje a la cola de correos:", data);
        const conn = await amqp.connect('amqp://dunamisserver:J4s0nd34d@192.168.0.200:5672');
        const channel = await conn.createChannel();
        const queue = 'email_queue';

        await channel.assertQueue(queue, { durable: true });

        // El payload debe coincidir con lo que espera el worker
        const payload = {
            to: data.email,
            subject: data.subject,
            template: data.template,
            context: data.variables,
            archivo: data.archivo ? {
                filename: data.archivo.filename,
                // Convertimos el Buffer a string Base64
                content: data.archivo.content.toString('base64'),
                encoding: 'base64' // Añadimos esta pista para el worker
            } : []
        };

        channel.sendToQueue(queue, Buffer.from(JSON.stringify(payload)), {
            persistent: true
        });

        console.log("Mensaje enviado a la cola de correos");
        setTimeout(() => conn.close(), 500);

        return "Los correos se enviaron a la cola de envios"; // Puedes retornar algo si quieres confirmar que se envió a la cola

    }

}