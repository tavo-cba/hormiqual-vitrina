'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/recetaObraController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Cálculo puro (sin guardar)
router.post('/calcular', verifyJwt, ctrl.calcular);

// CRUD por dosificación
router.get('/dosificacion/:dosificacionId', verifyJwt, ctrl.listar);
router.post('/', verifyJwt, ctrl.guardar);
router.get('/:id', verifyJwt, ctrl.obtener);
router.delete('/:id', verifyJwt, ctrl.eliminar);

// Últimas humedades de ensayo para los agregados de una dosificación
router.get('/dosificacion/:dosificacionId/humedades-ensayo', verifyJwt, ctrl.obtenerUltimasHumedades);

module.exports = router;
