import nodemailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import path from 'path';
import { fileURLToPath } from 'url';



// --- CONFIGURACIÓN PARA ZOHO ---
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST, // Servidor SMTP de Zoho para cuentas profesionales
    port: process.env.MAIL_PORT,                // Puerto para SSL
    secure: true,             // true para puerto 465
    auth: {
        user: process.env.MAIL_USER, // Tu nuevo correo de Zoho
        pass: process.env.MAIL_PASS
    }
});



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
            console.log('CONFIGURACION', {
                host: process.env.MAIL_HOST, // Servidor SMTP de Zoho para cuentas profesionales
                port: process.env.MAIL_PORT,                // Puerto para SSL
                secure: true,             // true para puerto 465
                auth: {
                    user: process.env.MAIL_USER, // Tu nuevo correo de Zoho
                    pass: process.env.MAIL_PASS
                }
            });
            console.error("Error al enviar email con Zoho:", error);
            throw error;
        }
    }
}