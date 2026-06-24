'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/materialPrecioController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Bulk vigente prices (POST to avoid URL length issues)
router.post('/vigentes-bulk', verifyJwt, ctrl.getPreciosVigentesBulk);

// Bulk import
router.post('/importar', verifyJwt, ctrl.importarPrecios);

// CRUD by material
router.get('/:source/:sourceId', verifyJwt, ctrl.getPrecios);
router.get('/:source/:sourceId/vigente', verifyJwt, ctrl.getPrecioVigente);
router.post('/', verifyJwt, ctrl.createPrecio);
router.put('/:id', verifyJwt, ctrl.updatePrecio);
router.delete('/:id', verifyJwt, ctrl.deletePrecio);

module.exports = router;
