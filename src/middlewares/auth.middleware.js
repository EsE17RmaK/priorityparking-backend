// src/middlewares/auth.middleware.js
const jwt = require('jsonwebtoken');

/**
 * Middleware para verificar la validez del token JWT y autorizar según el Rol.
 * @param {Array} rolesPermitidos - Lista de roles permitidos (Ej: ['ADMIN'], ['GARITA'])
 */
function verificarRol(rolesPermitidos) {
    return (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Acceso denegado. Token de seguridad no proporcionado.' });
        }

        try {
            const claveSecreta = process.env.JWT_SECRET;
            if (!claveSecreta) {
                throw new Error('JWT_SECRET no configurado en el servidor.');
            }

            const datosUsuario = jwt.verify(token, claveSecreta);
            req.usuario = datosUsuario;

            if (!rolesPermitidos.includes(datosUsuario.rol)) {
                return res.status(403).json({
                    error: `Acceso prohibido. Tu rol '${datosUsuario.rol}' no tiene permisos para esta operación.`
                });
            }

            next();
        } catch (error) {
            console.error('[JWT Middleware Error]:', error.message);
            return res.status(403).json({ error: 'Token inválido o expirado. Inicie sesión nuevamente.' });
        }
    };
}

module.exports = { verificarRol };