// src/routes/api.routes.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { verificarRol } = require('../middlewares/auth.middleware');

// Importar controladores
const authController = require('../modules/auth/auth.controller');
const reservasController = require('../modules/reservas/reservas.controller');
const adminController = require('../modules/admin/admin.controller');

// Configuración en memoria para recepción de archivos CSV (límite 2 MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 }
});

/**
 * ==========================================
 * RUTAS PÚBLICAS: AUTENTICACIÓN
 * ==========================================
 */
router.post('/auth/solicitar-otp', authController.solicitarOtp);
router.post('/auth/verificar-otp', authController.verificarOtp);

/**
 * =================================================================
 * RUTAS PROTEGIDAS CON AUTENTICACIÓN JWT Y CONTROL DE ROLES
 * =================================================================
 */

// 1. Garita, Aforo Operativo y Espacios
router.get('/garita/espacios', verificarRol(['ESTUDIANTE', 'GARITA', 'ADMIN']), reservasController.obtenerEspaciosGarita);
router.post('/garita/registrar-ingreso', verificarRol(['GARITA', 'ADMIN']), reservasController.registrarIngresoVehiculo);
router.post('/garita/registrar-salida', verificarRol(['GARITA', 'ADMIN']), reservasController.registrarSalidaVehiculo);
router.post('/garita/bloqueo-diario', verificarRol(['GARITA', 'ADMIN']), adminController.registrarBloqueoGarita);

// 2. Reservas de Estudiantes
router.post('/reservas/crear', verificarRol(['ESTUDIANTE']), reservasController.crearReservaAlumno);
router.post('/reservas/cancelar', verificarRol(['ESTUDIANTE']), reservasController.cancelarReservaAlumno);
router.get('/reservas/mis-reservas', verificarRol(['ESTUDIANTE', 'ADMIN']), reservasController.listarMisReservas);

// 3. Administración UTP 
router.get('/admin/aforo', verificarRol(['ESTUDIANTE', 'ADMIN', 'GARITA']), adminController.obtenerAforo);
router.put('/admin/aforo', verificarRol(['ADMIN']), adminController.configurarAforoMensual);
router.post('/admin/garitas', verificarRol(['ADMIN']), adminController.registrarGarita);
router.get('/admin/garitas', verificarRol(['ADMIN']), adminController.obtenerGaritas);
router.post('/admin/estudiantes/csv', verificarRol(['ADMIN']), upload.single('archivoCsv'), adminController.subirPadronAlumnos);

module.exports = router;