const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/calibracionEquipoController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/:id', verifyJwt, ctrl.getCalibracion);
router.get('/', verifyJwt, ctrl.getCalibraciones);
router.post('/', verifyJwt, ctrl.createCalibracion);
router.put('/:id', verifyJwt, ctrl.updateCalibracion);
router.delete('/:id', verifyJwt, ctrl.deleteCalibracion);

module.exports = router;
