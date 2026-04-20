import axios from 'axios';

export const extraServices = {

    enviarSlack: async (mensaje, emisor) => {
        try {
            await axios.post(process.env.SLACK_WEBHOOK_URL, {
                text: mensaje,
                // Puedes personalizarlo más:
                username: emisor,
                icon_emoji: ":money_with_wings:"
            });
        } catch (error) {
            console.error('Error enviando a Slack:', error.message);
        }
    }
}