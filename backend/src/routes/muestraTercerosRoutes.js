const express = require('express');
const router = express.Router();
const controller = require('../controllers/muestraTercerosController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/', verifyJwt, controller.getMuestrasTerceros);
router.get('/:id/ficha', verifyJwt, controller.getFichaMuestraTerceros);
router.get('/:id', verifyJwt, controller.getMuestraTerceros);
router.post('/', verifyJwt, controller.createMuestraTerceros);
router.put('/:id', verifyJwt, controller.updateMuestraTerceros);
router.put('/confirmar/:id', verifyJwt, controller.confirmarMuestraTerceros);
router.delete('/:id', verifyJwt, controller.deleteMuestraTerceros);

module.exports = router;