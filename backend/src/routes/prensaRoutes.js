const express = require('express');
const router = express.Router();
const prensaController = require('../controllers/prensaController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get("/unidadesmedida", verifyJwt, prensaController.getUnidadesMedidaPrensa);

// Rutas CRUD de Prensa
router.get('/:id', verifyJwt, prensaController.getPrensa);
router.get('/', verifyJwt, prensaController.getPrensas);
router.post('/', verifyJwt, prensaController.createPrensa);
router.put('/:id', verifyJwt, prensaController.updatePrensa);
router.delete('/:id', verifyJwt, prensaController.deletePrensa);

module.exports = router;
