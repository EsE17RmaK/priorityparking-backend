// src/jobs/tolerance.job.js
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function iniciarVerificadorTolerancia() {
    // Se ejecuta cada minuto para validar vencimiento de tolerancia
    cron.schedule('* * * * *', async () => {
        try {
            const ahora = new Date();
            const haceVeinteMinutos = new Date(ahora.getTime() - 20 * 60 * 1000);

            // Buscar reservas PENDIENTES de hoy cuya hora programada superó los 20 min
            const reservasVencidas = await prisma.reserva.findMany({
                where: {
                    fechaReserva: ahora,
                    estadoReserva: 'PENDIENTE',
                    horaLlegadaProgramada: {
                        lt: haceVeinteMinutos
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
                    prisma.espacioEstacionamiento.update({
                        where: { idEspacio: reserva.idEspacio },
                        data: { estado: 'DISPONIBLE' }
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

                console.warn(`🚨 [Tolerancia] Alumno ${reserva.codigoAlumno} penalizado. Slot ${reserva.idEspacio} liberado.`);
            }
        } catch (error) {
            console.error('Error en Cron de Tolerancia:', error.message);
        }
    });
}

module.exports = { iniciarVerificadorTolerancia };