import nodemailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars'; // <-- Cambiado de require a import
import path from 'path';

const transporter = nodemailer.createTransport({
    host: smtp.gmail.com,
    port: 465,
    auth: {
        user: 'itperu@metasperu.com',
        pass: 'lpieqykwqpdzkhgt'
    }
});

// Configurar plantillas
transporter.use('compile', hbs({
    viewEngine: {
        partialsDir: path.resolve('./src/templates/'),
        defaultLayout: false,
    },
    viewPath: path.resolve('./src/templates/'),
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

