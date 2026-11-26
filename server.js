// server.js
require('dotenv').config();

const app = require('./src/app');
const { iniciarVerificadorTolerancia } = require('./src/jobs/tolerance.job');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`\n🚗 ==================================================== 🚗`);
    console.log(`   PriorityParking MVP - Sede Lima Centro Activa`);
    console.log(`   Servidor ejecutándose localmente en: http://localhost:${PORT}`);
    console.log(`   Endpoints API listos bajo el prefijo: /api`);
    console.log(`🚗 ==================================================== 🚗\n`);

    // Iniciar tarea programada de tolerancia de 20 minutos
    iniciarVerificadorTolerancia();
});

process.on('unhandledRejection', (reason) => {
    console.error('⚠️ [CRÍTICO] Rechazo no manejado en promesa:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ [CRÍTICO] Excepción no controlada en el código:', error);
});