'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tipologiaHormigonController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/',              verifyJwt, ctrl.listar);
router.get('/codigo/:codigo', verifyJwt, ctrl.obtenerPorCodigo);
router.get('/:id',           verifyJwt, ctrl.obtener);
router.post('/',             verifyJwt, ctrl.crear);
router.put('/:id',           verifyJwt, ctrl.actualizar);
router.delete('/:id',        verifyJwt, ctrl.eliminar);
router.post('/:id/restaurar-defaults', verifyJwt, ctrl.restaurarDefaults);

module.exports = router;
