const express = require('express');
const router = express.Router();
const cementoController = require('../controllers/cementoController');
const { verifyJwt } = require('../middlewares/verifyToken');

// CRUD de Cemento
router.get('/', verifyJwt, cementoController.getCementos);
router.get('/:id', verifyJwt, cementoController.getCemento);
router.post('/', verifyJwt, cementoController.createCemento);
router.put('/:id', verifyJwt, cementoController.updateCemento);
router.delete('/:id', verifyJwt, cementoController.deleteCemento);

module.exports = router;
