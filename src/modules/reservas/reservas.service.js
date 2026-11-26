// src/modules/reservas/reservas.service.js
const pool = require('../../config/database');
const QRCode = require('qrcode');

/**
 * Busca la reserva pendiente del alumno para la fecha indicada (sin exigir slot físico).
 */
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

/**
 * Procesa el ingreso físico del vehículo pasando la reserva de PENDIENTE a EN_CURSO.
 */
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

/**
 * Registra la salida física del vehículo pasando la reserva de EN_CURSO a FINALIZADA.
 */
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

/**
 * Lista las reservas activas de hoy (PENDIENTE y EN_CURSO) para el monitor de Garita.
 */
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

/**
 * Crea una reserva de forma atómica validando el aforo total del mes menos los bloqueos del día.
 */
async function ejecutarReservaTransaccional(codigoAlumno, codigoOtpUsado, fechaReserva, horaLlegadaProgramada) {
    const clienteBD = await pool.connect();
    try {
        await clienteBD.query('BEGIN');

        // 1. Verificar que el alumno no tenga ya una reserva activa ese día
        const dupRes = await clienteBD.query(
            `SELECT id_reserva FROM reservas 
             WHERE codigo_alumno = $1 AND fecha_reserva = $2 
               AND estado_reserva IN ('PENDIENTE', 'EN_CURSO', 'COMPLETADA')`,
            [codigoAlumno, fechaReserva]
        );
        if (dupRes.rows.length > 0) {
            throw new Error(`Ya cuentas con una reserva registrada para el día ${fechaReserva}.`);
        }

        // 2. Obtener capacidad mensual configurada por el Admin (o 70 por defecto)
        const mesAnio = String(fechaReserva).slice(0, 7);
        const capRes = await clienteBD.query(
            `SELECT capacidad_mensual FROM configuracion_aforo 
             WHERE mes_anio = $1 
             UNION ALL
             SELECT capacidad_mensual FROM configuracion_aforo ORDER BY 1 DESC LIMIT 1`,
            [mesAnio]
        );
        const capacidadMensual = capRes.rows[0]?.capacidad_mensual ?? 70;

        // 3. Obtener cupos bloqueados por Garita para esa fecha
        const bloqRes = await clienteBD.query(
            `SELECT cupos_bloqueados FROM bloqueos_diarios WHERE fecha = $1::date`,
            [fechaReserva]
        );
        const bloqueadosDia = bloqRes.rows[0]?.cupos_bloqueados ?? 0;

        // 4. Bloquear filas de reservas del día para evitar sobreventa concurrente
        const ocupadasRes = await clienteBD.query(
            `SELECT id_reserva FROM reservas 
             WHERE fecha_reserva = $1::date 
               AND estado_reserva IN ('PENDIENTE', 'EN_CURSO', 'COMPLETADA')
             FOR UPDATE`,
            [fechaReserva]
        );
        const cuposUsados = ocupadasRes.rows.length;
        const disponibles = capacidadMensual - bloqueadosDia - cuposUsados;

        if (disponibles <= 0) {
            throw new Error('Aforo completo para la fecha seleccionada. No quedan cupos disponibles.');
        }

        // 5. Insertar la reserva sin asignación de slot físico (id_espacio = NULL)
        const insertarReservaQuery = `
            INSERT INTO reservas (codigo_alumno, id_espacio, codigo_otp_usado, fecha_reserva, hora_llegada_programada, estado_reserva)
            VALUES ($1, NULL, $2, $3, $4, 'PENDIENTE')
            RETURNING *;
        `;
        const resultadoReserva = await clienteBD.query(insertarReservaQuery, [
            codigoAlumno,
            codigoOtpUsado,
            fechaReserva,
            horaLlegadaProgramada
        ]);

        await clienteBD.query('COMMIT');

        // 6. Generar credencial QR con datos de la reserva por aforo
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

/**
 * Cancela una reserva pendiente de forma atómica liberando el cupo en el aforo del día.
 */
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

/**
 * Consulta el listado de reservas históricas y futuras de un alumno específico.
 */
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