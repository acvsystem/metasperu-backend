import 'dotenv/config'; // Carga las variables del .env
import nodemailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import path from 'path';
import { fileURLToPath } from 'url';

const passwordBrevo = process.env.MAIL_PASS;

const configuration = {
    service: "Gmail",
    port: 465,
    secure: true,
    auth: {
        user: `${process.env.MAIL_USER}`,
        pass: `${passwordBrevo}`
    }
}

console.log(configuration, `${passwordBrevo}`);

const transporter = nodemailer.createTransport(configuration);



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
            from: '"Metas Perú" <itperu@metasperu.com>', // DEBE coincidir con el user de auth
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
            console.error("Error al enviar email con Zoho:", error);
            throw error;
        }
    }
}