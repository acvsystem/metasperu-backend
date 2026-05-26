import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'una_clave_muy_segura_y_larga_123456';

export const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "No se proporciono un token" });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Token invalido o expirado" });
    }
};
