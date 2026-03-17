import nodemailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars'; // <-- Cambiado de require a import
import path from 'path';
import { fileURLToPath } from 'url';

const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
        user: 'itperu@metasperu.com',
        pass: 'lpieqykwqpdzkhgt'
    }
})

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)
const viewPath = path.resolve(__dirname, './templates/');

// Configurar plantillas
transporter.use('compile', hbs({
    viewEngine: {
        partialsDir: viewPath,
        defaultLayout: false,
    },
    viewPath: viewPath,
    extName: '.hbs'
}));

export const mailer = {
    sendMail: async (to, subject, template, context, archivo = null) => {
        let mailOptions = {
            from: '"Metas Perú" <itperu@metasperu.com>', // Usamos el correo autenticado para evitar spam
            to: to,
            subject: subject,
            template: template,
            context: context,
            attachments: []
        };

        // Si existe un archivo, lo añadimos al array de adjuntos
        if (archivo && archivo.content) {
            mailOptions.attachments.push({
                filename: archivo.filename,
                content: archivo.content,
                encoding: 'base64', // <--- IMPORTANTE: Nodemailer sabrá qué hacer
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
        }

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log("Email enviado con éxito: %s", info.messageId);
            return info;
        } catch (error) {
            console.error("Error al enviar email:", error);
            throw error;
        }
    }
}

