const garitaService = require('./garita.service');
const cargaCsvService = require('./carga-csv.service');
const aforoService = require('./aforo.service');

async function registrarGarita(req, res) {
    const { username, password, nombreCompleto } = req.body;

    if (!username || !password || !nombreCompleto) {
        return res.status(400).json({
            error: 'Faltan campos obligatorios (username, password, nombreCompleto).'
        });
    }

    try {
        const nuevoOperador = await garitaService.crearOperadorGarita({
            username,
            password,
            nombreCompleto
        });

        return res.status(201).json({
            mensaje: 'Operador de Garita creado exitosamente.',
            operador: nuevoOperador
        });
    } catch (error) {
        const status = error.message.includes('ya se encuentra') ? 409 : 500;
        return res.status(status).json({ error: error.message });
    }
}

async function obtenerGaritas(req, res) {
    try {
        const lista = await garitaService.listarOperadoresGarita();
        return res.status(200).json(lista);
    } catch (error) {
        console.error('[Admin Controller Error - Garitas]:', error.message);
        return res.status(500).json({ error: 'Error al consultar los operadores de Garita.' });
    }
}

async function subirPadronAlumnos(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: 'Debe adjuntar un archivo .csv válido en el campo archivoCsv.' });
    }

    try {
        const resumen = await cargaCsvService.procesarPadronCsv(req.file.buffer);
        return res.status(200).json({
            mensaje: 'Padrón académico procesado correctamente.',
            resumen
        });
    } catch (error) {
        console.error('[Admin Controller Error - CSV]:', error.message);
        return res.status(400).json({ error: error.message });
    }
}

async function obtenerAforo(req, res) {
    try {
        const estado = await aforoService.obtenerEstadoAforoHoy();
        return res.status(200).json(estado);
    } catch (error) {
        console.error('[Admin Controller Error - Aforo]:', error.message);
        return res.status(500).json({ error: 'Error al obtener el estado del aforo.' });
    }
}

async function configurarAforoMensual(req, res) {
    const { mesAnio, capacidadMensual } = req.body;

    if (capacidadMensual === undefined || capacidadMensual === null) {
        return res.status(400).json({ error: 'Debe indicar la capacidadMensual.' });
    }

    try {
        const adminUsername = req.usuario?.codigo || 'UTP-ADMIN';
        const config = await aforoService.actualizarAforoMensual({
            mesAnio,
            capacidadMensual,
            adminUsername
        });

        return res.status(200).json({
            mensaje: `Aforo mensual actualizado a ${config.capacidadMensual} espacios.`,
            configuracion: config
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}

async function registrarBloqueoGarita(req, res) {
    const { cuposBloqueados, motivo } = req.body;

    if (cuposBloqueados === undefined || cuposBloqueados === null) {
        return res.status(400).json({ error: 'Debe indicar la cantidad de cuposBloqueados.' });
    }

    try {
        const garitaUsername = req.usuario?.codigo || 'UTP-GARITA';
        const bloqueo = await aforoService.registrarBloqueoDiario({
            cuposBloqueados,
            motivo,
            garitaUsername
        });

        return res.status(200).json({
            mensaje: `Bloqueo operativo del día actualizado (${bloqueo.cuposBloqueados} cupos).`,
            bloqueo
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}

module.exports = {
    registrarGarita,
    obtenerGaritas,
    subirPadronAlumnos,
    obtenerAforo,
    configurarAforoMensual,
    registrarBloqueoGarita
};