'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/materialPlantaController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Plantas habilitadas para un material (aditivo|adicion|fibra)
router.get('/:source/:sourceId/plantas', verifyJwt, ctrl.listarPlantasDeMaterial);

// Materiales habilitados activos en una planta
router.get('/:source/planta/:idPlanta', verifyJwt, ctrl.listarMaterialesDePlanta);

// Sincronizar el conjunto de plantas para un material (envía plantasConfig[])
router.put('/:source/:sourceId/plantas', verifyJwt, ctrl.sincronizarPlantas);

// Asignar/reconfigurar una sola planta
router.post('/:source/:sourceId/plantas/:idPlanta', verifyJwt, ctrl.upsertPlanta);

// Desasignar una planta (soft → activo=false)
router.delete('/:source/:sourceId/plantas/:idPlanta', verifyJwt, ctrl.desasignarPlanta);

module.exports = router;
