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


        let mail = {
            from: '"Metas Perú" <noreply@metasperu.com>',
            to: to,
            subject: `${subject}`,
            template: template,
            context: context,
            attachments: []
        }


        if (archivo != null) {
            (mail || {}).attachments = [
                {
                    content: Buffer.from(archivo),
                    contentType: 'application/octet-stream',
                }
            ]
        }

        await transporter.sendMail(mail);
    }
}

