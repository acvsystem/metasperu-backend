import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
    // 1. Extraer el token de las cookies
    const token = req.cookies.auth_token;

    if (!token) {
        return res.status(401).json({ message: 'No hay token, autorización denegada' });
    }

    try {
        // 2. Verificar el token usando la clave secreta
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 3. Inyectar los datos del usuario en la petición
        req.user = decoded;
        
        next(); // Continuar al siguiente paso
    } catch (error) {
        return res.status(401).json({ message: 'Token no es válido' });
    }
};
