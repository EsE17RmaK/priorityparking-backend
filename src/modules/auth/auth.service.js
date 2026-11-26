// src/modules/auth/auth.service.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

/**
 * Busca un estudiante usando su correo institucional.
 */
async function buscarEstudiantePorCorreo(correo) {
    return await prisma.estudianteHabilitado.findUnique({
        where: { correoInstitucional: correo }
    });
}

/**
 * Limpia OTPs previos del alumno y guarda el nuevo código en PostgreSQL.
 */
async function registrarLogOtp(codigoAlumno, codigoOtp) {
    await prisma.registroOtp.deleteMany({
        where: { codigoAlumno: codigoAlumno }
    });

    await prisma.registroOtp.create({
        data: {
            codigoAlumno: codigoAlumno,
            codigoOtp: codigoOtp,
            expirado: false
        }
    });

    console.log(`[Database] OTP '${codigoOtp}' registrado para el alumno: ${codigoAlumno}`);
    return true;
}

/**
 * Valida el código OTP de un estudiante (vigencia de 5 minutos).
 */
async function validarCodigoOtp(codigoAlumno, otpIngresado) {
    const cincoMinutosAtras = new Date(Date.now() - 5 * 60 * 1000);

    const registro = await prisma.registroOtp.findFirst({
        where: {
            codigoAlumno: codigoAlumno,
            expirado: false,
            fechaGeneracion: { gte: cincoMinutosAtras }
        },
        orderBy: { fechaGeneracion: 'desc' }
    });

    if (!registro) return false;

    if (registro.codigoOtp === otpIngresado) {
        await prisma.registroOtp.update({
            where: { idOtp: registro.idOtp },
            data: { expirado: true }
        });
        return true;
    }
    return false;
}

/**
 * Valida credenciales de operadores (ADMIN o GARITA) contra PostgreSQL usando bcrypt.
 */
async function validarUsuarioSistema(username, passwordPlano) {
    const usuario = await prisma.usuarioSistema.findUnique({
        where: { username: username }
    });

    if (!usuario || !usuario.activo) {
        return null;
    }

    const coincide = await bcrypt.compare(passwordPlano, usuario.passwordHash);
    if (!coincide) {
        return null;
    }

    return {
        username: usuario.username,
        rol: usuario.rol,
        nombreCompleto: usuario.nombreCompleto
    };
}

/**
 * Verifica si un alumno cuenta con una sanción activa.
 */
async function verificarEstudiantePenalizado(codigoAlumno) {
    const penalizacion = await prisma.historialPenalizacion.findFirst({
        where: {
            codigoAlumno: codigoAlumno,
            activa: true,
            fechaFin: { gte: new Date() }
        }
    });

    if (penalizacion) {
        return {
            isPenalized: true,
            motivo: penalizacion.motivo,
            fechaFin: penalizacion.fechaFin
        };
    }

    return { isPenalized: false };
}

module.exports = {
    buscarEstudiantePorCorreo,
    registrarLogOtp,
    validarCodigoOtp,
    validarUsuarioSistema,
    verificarEstudiantePenalizado
};