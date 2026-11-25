require('dotenv').config();
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes/api.routes');

const app = express();

// Evita respuestas 304 para devolver siempre 200 OK
app.set('etag', false);

app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// Verificación de estado para despliegue
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'OK',
        servicio: 'PriorityParking API Backend',
        version: 'v1'
    });
});

app.use('/api', apiRoutes);

app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint no encontrado',
        ruta: req.originalUrl
    });
});

app.use((err, req, res, next) => {
    console.error('[Error de Servidor]:', err.stack);
    res.status(500).json({ error: 'Ocurrió un error interno en el servidor.' });
});

module.exports = app;