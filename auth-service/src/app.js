import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initSocket } from './config/socket.js';
import authRoutes from './routes/auth.routes.js';

const app = express();
const httpServer = createServer(app);

// Inicializar Sockets
initSocket(httpServer);

// Middlewares
app.use(cors({
    origin: 'http://localhost:4200', // Tu PWA Angular
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Rutas
app.use('/security', authRoutes);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Auth Service corriendo en puerto ${PORT}`);
});