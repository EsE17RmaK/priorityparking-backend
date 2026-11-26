// src/jobs/tolerance.job.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function iniciarVerificadorTolerancia() {
    // Se ejecuta cada minuto para validar vencimiento de tolerancia
    cron.schedule('* * * * *', async () => {
        try {
            const ahora = new Date();
            const limaFechaStr = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
            const fechaHoyUTC = new Date(`${limaFechaStr}T00:00:00.000Z`);

            // Hora actual en Lima hace 20 minutos representada en base 1970-01-01 para @db.Time
            const limaHoraActual = ahora.toLocaleTimeString('en-GB', {
                timeZone: 'America/Lima',
                hour12: false
            }); // HH:mm:ss
            const limiteTolerancia = new Date(`1970-01-01T${limaHoraActual}.000Z`);
            limiteTolerancia.setMinutes(limiteTolerancia.getMinutes() - 20);

            // Buscar reservas PENDIENTES de hoy cuya hora programada superó los 20 min
            const reservasVencidas = await prisma.reserva.findMany({
                where: {
                    fechaReserva: fechaHoyUTC,
                    estadoReserva: 'PENDIENTE',
                    horaLlegadaProgramada: {
                        lt: limiteTolerancia
                    }
                }
            });

            for (const reserva of reservasVencidas) {
                const fechaFinPenalizacion = new Date();
                fechaFinPenalizacion.setDate(fechaFinPenalizacion.getDate() + 3);

                await prisma.$transaction([
                    prisma.reserva.update({
                        where: { idReserva: reserva.idReserva },
                        data: { estadoReserva: 'EXPIRADA' }
                    }),
                    prisma.historialPenalizacion.create({
                        data: {
                            codigoAlumno: reserva.codigoAlumno,
                            motivo: 'Inasistencia automática: Tolerancia de 20 min vencida.',
                            fechaFin: fechaFinPenalizacion,
                            activa: true
                        }
                    })
                ]);

                console.warn(`🚨 [Tolerancia] Alumno ${reserva.codigoAlumno} penalizado. Cupo liberado al aforo diario.`);
            }
        } catch (error) {
            console.error('Error en Cron de Tolerancia:', error.message);
        }
    });
}

module.exports = { iniciarVerificadorTolerancia };