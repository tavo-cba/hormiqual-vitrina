const express = require('express');
const router = express.Router();
const materialController = require('../controllers/materialController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Tipos de material
router.get('/tipos', verifyJwt, materialController.getTipos);

// CRUD de materiales
router.get('/',    verifyJwt, materialController.getMateriales);
router.post('/',   verifyJwt, materialController.createMaterial);
router.post('/restore', verifyJwt, materialController.restoreMaterial);
router.get('/:id', verifyJwt, materialController.getMaterial);
router.put('/:id', verifyJwt, materialController.updateMaterial);
router.delete('/:id', verifyJwt, materialController.deleteMaterial);

module.exports = router;
