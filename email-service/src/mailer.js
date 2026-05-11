import 'dotenv/config'; // Carga las variables del .env
import nodemailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import path from 'path';
import { fileURLToPath } from 'url';

const passwordBrevo = process.env.MAIL_PASS;


// --- CONFIGURACIÓN PARA ZOHO ---
const configBevo = {
    host: 'smtp-relay.brevo.com', // Servidor SMTP de Zoho para cuentas profesionales
    port: 587,                // Puerto para SSL
    secure: false,             // true para puerto 465
    auth: {
        user: 'aaf3a3001@smtp-brevo.com', // Tu nuevo correo de Zoho
        pass: `${passwordBrevo}`
    },
    tls: {
        rejectUnauthorized: false
    }
};
console.log(configBevo, `${passwordBrevo}`);
const transporter = nodemailer.createTransport(configBevo);



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viewPath = path.resolve(__dirname, './templates/');

// Configurar plantillas (se mantiene igual)
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
            from: '"Metas Perú" <notificacion@metasperu.net.pe>', // DEBE coincidir con el user de auth
            to: to,
            subject: subject,
            template: template,
            context: context,
            attachments: []
        };

        if (archivo && archivo.content) {
            mailOptions.attachments.push({
                filename: archivo.filename,
                content: archivo.content,
                encoding: 'base64',
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
        }

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log("Email enviado vía Zoho: %s", info.messageId);
            return info;
        } catch (error) {
            const passwordBrevo = process.env.MAIL_PASS;
            console.log(configBevo, `${passwordBrevo}`);
            console.error("Error al enviar email con Zoho:", error);
            throw error;
        }
    }
}