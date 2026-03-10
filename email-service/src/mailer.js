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
    sendMail: async (to, subject, template, context) => {
        await transporter.sendMail({
            from: '"Metas Perú" <noreply@metasperu.com>',
            to,
            subject,
            template, // nombre del archivo .hbs
            context   // variables para el HTML (nombre del usuario, etc)
        });
    }
}

