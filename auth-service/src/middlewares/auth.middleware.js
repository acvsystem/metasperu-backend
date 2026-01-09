import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "No se proporcionó un token" });
    }

    const token = authHeader.split(' ')[1]; // Extrae el token después de "Bearer "

    // Aquí verificas el JWT (ej. jwt.verify)
    try {
        const decoded = jwt.verify(token, 'una_clave_muy_segura_y_larga_123456');
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Token inválido o expirado" });
    }
};