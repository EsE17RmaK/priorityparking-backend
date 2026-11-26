// src/modules/reservas/reservas.controller.js
const pool = require('../../config/database');
const reservasService = require('./reservas.service');

/**
 * Validar Ingreso en Garita controlando los 20 minutos de tolerancia estricta (por código/QR)
 * URL: POST /api/garita/registrar-ingreso
 */
async function registrarIngresoVehiculo(req, res) {
    const codigoAlumnoLimpio = req.body.codigo_alumno || req.body.codigoAlumno;

    if (!codigoAlumnoLimpio) {
        return res.status(400).json({ error: 'Debe ingresar el código de alumno o escanear el QR.' });
    }

    const parametroAlumno = String(codigoAlumnoLimpio).trim().toUpperCase();
    const parametroFecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id_reserva,
                    hora_llegada_programada::text AS hora_text,
                    ((now() AT TIME ZONE 'America/Lima')::time
                        > hora_llegada_programada + interval '20 minutes') AS vencida
             FROM reservas
             WHERE codigo_alumno = $1
               AND fecha_reserva = $2::date
               AND estado_reserva = 'PENDIENTE'
             FOR UPDATE`,
            [parametroAlumno, parametroFecha]
        );

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `No se localizó una reserva PENDIENTE para el alumno ${parametroAlumno} hoy (${parametroFecha}).`
            });
        }

        const { id_reserva: idReserva, hora_text: horaProgramada, vencida } = rows[0];

        if (vencida) {
            await client.query(
                `UPDATE reservas SET estado_reserva = 'EXPIRADA' WHERE id_reserva = $1`,
                [idReserva]
            );
            await client.query(
                `INSERT INTO historial_penalizaciones (codigo_alumno, motivo, fecha_fin)
                 VALUES ($1, $2, now() + interval '3 days')`,
                [parametroAlumno, 'Excedió los 20 minutos de tolerancia en garita.']
            );
            await client.query('COMMIT');

            return res.status(403).json({
                error: `Acceso denegado: excediste los 20 minutos de tolerancia (hora programada: ${horaProgramada}). Cupo liberado al aforo.`
            });
        }

        await client.query(
            `UPDATE reservas SET estado_reserva = 'EN_CURSO' WHERE id_reserva = $1`,
            [idReserva]
        );

        await client.query('COMMIT');

        return res.status(200).json({
            mensaje: `Ingreso validado para ${parametroAlumno}. (+1 vehículo en planta)`
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[Garita] ERROR:', error.message);
        return res.status(500).json({ error: 'Fallo interno al procesar el ingreso vehicular en garita.' });
    } finally {
        client.release();
    }
}

/**
 * Registra la salida del vehículo liberando un cupo en el aforo del día.
 * URL: POST /api/garita/registrar-salida
 */
async function registrarSalidaVehiculo(req, res) {
    const codigoAlumno = req.body.codigo_alumno || req.body.codigoAlumno;

    if (!codigoAlumno) {
        return res.status(400).json({ error: 'Falta el parámetro requerido (codigo_alumno).' });
    }

    try {
        const parametroAlumno = String(codigoAlumno).trim().toUpperCase();
        await reservasService.ejecutarSalidaPorAlumno(parametroAlumno);

        return res.status(200).json({
            mensaje: `Salida procesada para ${parametroAlumno}. (-1 vehículo en planta, cupo liberado)`
        });
    } catch (error) {
        console.error('[Reservas Controller Error - Salida]:', error.message);
        return res.status(400).json({ error: error.message || 'Fallo interno al procesar la salida vehicular.' });
    }
}

/**
 * Obtiene el movimiento operativo diario (reservas pendientes y vehículos en planta).
 * URL: GET /api/garita/espacios
 */
async function obtenerEspaciosGarita(req, res) {
    try {
        const movimientos = await reservasService.obtenerMonitorDiarioGarita();
        return res.status(200).json(movimientos);
    } catch (error) {
        console.error('[Reservas Controller Error]:', error.message);
        return res.status(500).json({ error: 'Fallo interno al obtener el monitor diario.' });
    }
}

/**
 * Procesa la solicitud del alumno para reservar cupo por aforo (sin slot físico).
 * URL: POST /api/reservas/crear
 */
async function crearReservaAlumno(req, res) {
    const { codigo_alumno, otp_verificado, fecha_reserva, hora_llegada } = req.body;

    if (!codigo_alumno || !fecha_reserva || !hora_llegada) {
        return res.status(400).json({
            error: 'Faltan parámetros obligatorios (codigo_alumno, fecha_reserva, hora_llegada).'
        });
    }

    try {
        const resultado = await reservasService.ejecutarReservaTransaccional(
            String(codigo_alumno).trim().toUpperCase(),
            otp_verificado || '000000',
            fecha_reserva,
            hora_llegada
        );

        return res.status(200).json({
            success: true,
            mensaje: `Cupo reservado con éxito para el día ${fecha_reserva} a las ${hora_llegada}. Tienes 20 min de tolerancia.`,
            reserva: resultado.reserva,
            qrCode: resultado.qrCode
        });
    } catch (error) {
        console.error('[Reservas Controller Error]:', error.message);
        if (error.message.includes('unique_reserva_por_dia_alumno') || error.code === '23505') {
            return res.status(400).json({ error: `Ya cuentas con una reserva registrada para el día ${fecha_reserva}.` });
        }
        return res.status(400).json({ error: error.message || 'Fallo interno al procesar la reserva.' });
    }
}

/**
 * Permite al alumno cancelar de forma voluntaria su reserva pactada.
 * URL: POST /api/reservas/cancelar
 */
async function cancelarReservaAlumno(req, res) {
    const { codigo_alumno, fecha_reserva } = req.body;

    if (!codigo_alumno || !fecha_reserva) {
        return res.status(400).json({ error: 'Faltan parámetros obligatorios (codigo_alumno, fecha_reserva).' });
    }

    try {
        await reservasService.ejecutarCancelacionTransaccional(
            String(codigo_alumno).trim().toUpperCase(),
            fecha_reserva
        );

        return res.status(200).json({
            mensaje: `Reserva para el día ${fecha_reserva} cancelada con éxito. El cupo vuelve al aforo disponible.`
        });
    } catch (error) {
        console.error('[Cancelación Controller Error]:', error.message);
        return res.status(400).json({ error: error.message || 'Fallo interno al procesar la cancelación.' });
    }
}

/**
 * Devuelve todas las reservas de un estudiante para la pantalla Mis Reservas.
 * URL: GET /api/reservas/mis-reservas
 */
async function listarMisReservas(req, res) {
    try {
        const codigoAlumno = req.query.codigoAlumno || req.usuario?.codigoAlumno || req.body?.codigo_alumno;

        if (!codigoAlumno) {
            return res.status(400).json({ error: 'Falta el parámetro obligatorio: codigoAlumno.' });
        }

        const reservas = await reservasService.obtenerReservasPorAlumno(String(codigoAlumno).trim().toUpperCase());
        return res.status(200).json(reservas);
    } catch (error) {
        console.error('[Reservas Controller Error - listarMisReservas]:', error.message);
        return res.status(500).json({ error: 'Fallo interno al consultar el listado de reservas.' });
    }
}

module.exports = {
    registrarIngresoVehiculo,
    registrarSalidaVehiculo,
    obtenerEspaciosGarita,
    crearReservaAlumno,
    cancelarReservaAlumno,
    listarMisReservas
};