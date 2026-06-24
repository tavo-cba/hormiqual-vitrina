const express = require('express');
const router = express.Router();
const plantaController = require('../controllers/plantaController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Rutas CRUD de Planta
router.get('/:id', verifyJwt, plantaController.getPlanta);
router.get('/', verifyJwt, plantaController.getPlantas);
router.post('/', verifyJwt, plantaController.createPlanta);
router.put('/:id', verifyJwt, plantaController.updatePlanta);
// Patch dedicado de calibración HRDC por planta (UI en Calidad → Catálogos
// → Parámetros del motor). Solo toca los 5 campos rdc*, no el resto.
router.put('/:id/calibracion-hrdc', verifyJwt, plantaController.updateCalibracionHRDC);
// Dosificaciones disponibles para crear un Despacho en la planta
// (lee del catálogo correspondiente según `Planta.origenDosificaciones`).
router.get('/:id/dosificaciones-para-despacho', verifyJwt, plantaController.getDosificacionesParaDespacho);
router.delete('/:id', verifyJwt, plantaController.deletePlanta);

module.exports = router;
