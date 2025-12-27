
import express from 'express';
import { createServer } from 'http';
import cookieParser from 'cookie-parser';
import { initSocket } from './config/socket.js'; // 1. Importar primero
import cors from 'cors';

const app = express();
const httpServer = createServer(app);

initSocket(httpServer);

app.use(cors({
    origin: 'http://localhost:4200',
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());


import authRoutes from './routes/auth.routes.js';
app.use('/security', authRoutes);

const PORT = 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});