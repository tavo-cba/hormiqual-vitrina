'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/herramientasCalidadController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Catálogos para llenar dropdowns del frontend.
router.get('/clases-exposicion',     verifyJwt, ctrl.listarClasesExposicion);
router.get('/tmn-tabla-4-3',         verifyJwt, ctrl.listarTmnTabla43);
router.get('/pulverulento-minimo',   verifyJwt, ctrl.listarPulverulentoMinimo);
router.get('/curvas-ac',             verifyJwt, ctrl.listarCurvasAC);

// Verificaciones (delegan a engines puros de `domain/`).
router.post('/verificar-tabla-2-5', verifyJwt, ctrl.verificarTabla25);
router.post('/verificar-tabla-4-3', verifyJwt, ctrl.verificarTabla43);
router.post('/verificar-tabla-4-4', verifyJwt, ctrl.verificarTabla44);
router.post('/estimar-ac',          verifyJwt, ctrl.estimarACDesdeFc);

module.exports = router;
