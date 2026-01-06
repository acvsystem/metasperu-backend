import jwt from 'jsonwebtoken';

export const verifyToken = (req, res, next) => {
    // 1. Intentar obtener el token de las cookies
    const token = req.cookies?.auth_token;
    console.log(req.cookies);
    if (!token) {
        return res.status(401).json({
            message: 'Acceso denegado. No se encontró un token de sesión.'
        });
    }

    try {
        // 2. Verificar el token con la clave secreta
        // IMPORTANTE: Process.env.JWT_SECRET debe ser igual en Auth e Inventario
        const decoded = jwt.verify(token, 'una_clave_muy_segura_y_larga_123456');

        // 3. Inyectamos los datos del usuario en el objeto request
        req.user = decoded;

        next(); // Continuar al controlador
    } catch (error) {
        return res.status(403).json({
            message: 'Token inválido o expirado.'
        });
    }
};