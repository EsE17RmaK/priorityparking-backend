const pool = require('../../config/database');
const QRCode = require('qrcode');

async function buscarReservaActiva(codigoAlumno, fechaReserva) {
    const query = `
        SELECT id_reserva, hora_llegada_programada, estado_reserva
        FROM reservas 
        WHERE codigo_alumno = $1 
          AND fecha_reserva = $2 
          AND estado_reserva = 'PENDIENTE'
        LIMIT 1
    `;
    const { rows } = await pool.query(query, [codigoAlumno, fechaReserva]);
    return rows[0];
}

async function ejecutarIngresoTransaccional(idReserva) {
    const queryReserva = `
        UPDATE reservas 
        SET estado_reserva = 'EN_CURSO' 
        WHERE id_reserva = $1::integer AND estado_reserva = 'PENDIENTE'
        RETURNING *
    `;
    const { rows } = await pool.query(queryReserva, [idReserva]);
    if (!rows.length) {
        throw new Error('La reserva ya fue utilizada o no está pendiente.');
    }
    return rows[0];
}

async function ejecutarSalidaPorAlumno(codigoAlumno) {
    const query = `
        UPDATE reservas 
        SET estado_reserva = 'FINALIZADA' 
        WHERE codigo_alumno = $1 
          AND fecha_reserva = CURRENT_DATE 
          AND estado_reserva IN ('EN_CURSO', 'COMPLETADA')
        RETURNING *
    `;
    const { rows } = await pool.query(query, [codigoAlumno]);
    if (!rows.length) {
        throw new Error(`No se encontró un vehículo dentro del campus para el alumno ${codigoAlumno}.`);
    }
    return rows[0];
}

async function obtenerMonitorDiarioGarita() {
    const query = `
        SELECT 
            r.id_reserva,
            r.codigo_alumno,
            e.nombre_completo,
            r.fecha_reserva,
            r.hora_llegada_programada,
            r.estado_reserva
        FROM reservas r
        LEFT JOIN estudiantes_habilitados e ON r.codigo_alumno = e.codigo_alumno
        WHERE r.fecha_reserva = CURRENT_DATE
          AND r.estado_reserva IN ('PENDIENTE', 'EN_CURSO', 'COMPLETADA')
        ORDER BY 
            CASE WHEN r.estado_reserva IN ('EN_CURSO', 'COMPLETADA') THEN 1 ELSE 2 END,
            r.hora_llegada_programada ASC
    `;
    const { rows } = await pool.query(query);
    return rows;
}

async function ejecutarReservaTransaccional(codigoAlumno, codigoOtpUsado, fechaReserva, horaLlegadaProgramada) {
    const clienteBD = await pool.connect();
    try {
        await clienteBD.query('BEGIN');

        const penRes = await clienteBD.query(
            `SELECT motivo FROM historial_penalizaciones
             WHERE codigo_alumno = $1 AND activa = true AND fecha_fin >= now()
             LIMIT 1`,
            [codigoAlumno]
        );
        if (penRes.rows.length > 0) {
            throw new Error(`No puedes reservar: tienes una suspensión activa por "${penRes.rows[0].motivo}".`);
        }

        const existenteRes = await clienteBD.query(
            `SELECT id_reserva, estado_reserva FROM reservas 
             WHERE codigo_alumno = $1 AND fecha_reserva = $2::date
             FOR UPDATE`,
            [codigoAlumno, fechaReserva]
        );
        const reservaPrevia = existenteRes.rows[0];

        if (reservaPrevia) {
            if (['PENDIENTE', 'EN_CURSO', 'COMPLETADA'].includes(reservaPrevia.estado_reserva)) {
                throw new Error(`Ya cuentas con una reserva activa para el día ${fechaReserva}.`);
            }
            if (reservaPrevia.estado_reserva === 'EXPIRADA') {
                throw new Error(`Tu reserva del ${fechaReserva} expiró por inasistencia en garita; no puedes volver a reservar hoy.`);
            }
        }

        const mesAnio = String(fechaReserva).slice(0, 7);
        const capRes = await clienteBD.query(
            `SELECT capacidad_mensual FROM configuracion_aforo 
             WHERE mes_anio = $1 
             UNION ALL
             SELECT capacidad_mensual FROM configuracion_aforo ORDER BY 1 DESC LIMIT 1`,
            [mesAnio]
        );
        const capacidadMensual = capRes.rows[0]?.capacidad_mensual ?? 70;

        const bloqRes = await clienteBD.query(
            `SELECT cupos_bloqueados FROM bloqueos_diarios WHERE fecha = $1::date`,
            [fechaReserva]
        );
        const bloqueadosDia = bloqRes.rows[0]?.cupos_bloqueados ?? 0;

        const ocupadasRes = await clienteBD.query(
            `SELECT id_reserva FROM reservas 
             WHERE fecha_reserva = $1::date 
               AND estado_reserva IN ('PENDIENTE', 'EN_CURSO', 'COMPLETADA')
             FOR UPDATE`,
            [fechaReserva]
        );
        const disponibles = capacidadMensual - bloqueadosDia - ocupadasRes.rows.length;

        if (disponibles <= 0) {
            throw new Error('Aforo completo para la fecha seleccionada. No quedan cupos disponibles.');
        }

        let resultadoReserva;
        if (reservaPrevia && reservaPrevia.estado_reserva === 'CANCELADA') {
            resultadoReserva = await clienteBD.query(
                `UPDATE reservas 
                 SET codigo_otp_usado = $1,
                     hora_llegada_programada = $2,
                     estado_reserva = 'PENDIENTE',
                     id_espacio = NULL
                 WHERE id_reserva = $3
                 RETURNING *;`,
                [codigoOtpUsado, horaLlegadaProgramada, reservaPrevia.id_reserva]
            );
        } else {
            resultadoReserva = await clienteBD.query(
                `INSERT INTO reservas (codigo_alumno, id_espacio, codigo_otp_usado, fecha_reserva, hora_llegada_programada, estado_reserva)
                 VALUES ($1, NULL, $2, $3, $4, 'PENDIENTE')
                 RETURNING *;`,
                [codigoAlumno, codigoOtpUsado, fechaReserva, horaLlegadaProgramada]
            );
        }

        await clienteBD.query('COMMIT');

        const payloadQR = JSON.stringify({
            idReserva: resultadoReserva.rows[0].id_reserva,
            codigoAlumno,
            fechaReserva,
            horaLlegadaProgramada
        });
        const qrCodeBase64 = await QRCode.toDataURL(payloadQR, { margin: 2, width: 250 });

        return {
            reserva: resultadoReserva.rows[0],
            qrCode: qrCodeBase64
        };
    } catch (error) {
        await clienteBD.query('ROLLBACK');
        throw error;
    } finally {
        clienteBD.release();
    }
}

async function ejecutarCancelacionTransaccional(codigoAlumno, fechaReserva) {
    const clienteBD = await pool.connect();
    try {
        await clienteBD.query('BEGIN');

        const buscarQuery = `
            SELECT id_reserva FROM reservas 
            WHERE codigo_alumno = $1 AND fecha_reserva = $2 AND estado_reserva = 'PENDIENTE'
            FOR UPDATE
        `;
        const { rows } = await clienteBD.query(buscarQuery, [codigoAlumno, fechaReserva]);

        if (rows.length === 0) {
            throw new Error('No se encontró ninguna reserva pendiente para cancelar en la fecha seleccionada.');
        }

        await clienteBD.query(
            "UPDATE reservas SET estado_reserva = 'CANCELADA' WHERE id_reserva = $1",
            [rows[0].id_reserva]
        );

        await clienteBD.query('COMMIT');
        return true;
    } catch (error) {
        await clienteBD.query('ROLLBACK');
        throw error;
    } finally {
        clienteBD.release();
    }
}

async function obtenerReservasPorAlumno(codigoAlumno) {
    const query = `
        SELECT 
            id_reserva,
            codigo_alumno,
            codigo_otp_usado,
            fecha_reserva,
            hora_llegada_programada,
            estado_reserva
        FROM reservas
        WHERE codigo_alumno = $1
        ORDER BY fecha_reserva DESC, hora_llegada_programada DESC
    `;
    const { rows } = await pool.query(query, [codigoAlumno]);
    return rows;
}

module.exports = {
    buscarReservaActiva,
    ejecutarIngresoTransaccional,
    ejecutarSalidaPorAlumno,
    obtenerMonitorDiarioGarita,
    ejecutarReservaTransaccional,
    ejecutarCancelacionTransaccional,
    obtenerReservasPorAlumno
};