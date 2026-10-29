import 'dotenv/config';
import {setTimeout as delay} from 'node:timers/promises';
import {pool} from '../src/config/db.js';
import {emailService} from '../src/services/email.service.js';
import {deliverNotification} from '../../shared/center-notification-outbox.mjs';
import {reportCenterError} from '../../shared/center-diagnostics.mjs';
if(process.env.MAIL_DELIVERY_ENABLED!=='true')throw new Error('La entrega de correo esta desactivada.');
let stopping=false,deadline;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;deadline=setTimeout(()=>process.exit(1),15000);deadline.unref();});
try {
  while(!stopping){
    try{if(!await deliverNotification(pool,emailService))await delay(1000);}
    catch(error){reportCenterError('notification.delivery_failed',error);await delay(2000);}
  }
}finally{await Promise.allSettled([pool.end(),emailService.close()]);clearTimeout(deadline);}
