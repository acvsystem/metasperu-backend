

import express from 'express';
import { createServer } from 'http';
import cookieParser from 'cookie-parser';
import { initSocket } from './config/socket.js'; // 1. Importar primero
import cors from 'cors';

const app = express();
const httpServer = createServer(app);

initSocket(httpServer);

app.use(cors({
  origin: (origin, callback) => callback(null, true), // Permite cualquier origen
  credentials: true
}));

app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

import inventoryRoutes from './routes/inventory.routes.js';
app.use('/s3/inventory', inventoryRoutes);

const PORT = 3001;
httpServer.listen(PORT, () => {
    console.log(`🚀 Servidor listo en http://localhost:${PORT}`);
});



