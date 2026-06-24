'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/muestraPastonController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/', verifyJwt, ctrl.getMuestrasPastones);
// Ficha PDF de la muestra de pastón (antes de /:id para que no lo capture).
router.get('/:id/ficha', verifyJwt, ctrl.getFichaMuestraPaston);
router.get('/:id', verifyJwt, ctrl.getMuestraPaston);
router.post('/', verifyJwt, ctrl.crearMuestraDesdePaston);
router.put('/:id', verifyJwt, ctrl.updateMuestraPaston);
// Sincroniza las probetas de la muestra (corregir cantidad/tipo/edad).
// Las ya ensayadas quedan bloqueadas (ver muestraPastonService).
router.put('/:id/probetas', verifyJwt, ctrl.sincronizarProbetas);
router.delete('/:id', verifyJwt, ctrl.deleteMuestraPaston);

module.exports = router;
