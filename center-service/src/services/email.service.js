import amqp from 'amqplib';
import { createMailPublisher } from '../../../shared/center-mail.mjs';
export const emailService = createMailPublisher({connect:amqp.connect,url:process.env.AMQP_URL});
