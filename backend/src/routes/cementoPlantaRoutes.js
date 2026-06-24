'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/cementoPlantaController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/cemento/:idCemento', verifyJwt, ctrl.listarPorCemento);
router.get('/planta/:idPlanta', verifyJwt, ctrl.listarPorPlanta);
router.post('/cemento/:idCemento/planta/:idPlanta', verifyJwt, ctrl.upsert);
router.put('/:id', verifyJwt, ctrl.actualizarPorId);
router.delete('/cemento/:idCemento/planta/:idPlanta', verifyJwt, ctrl.desasignar);

module.exports = router;
