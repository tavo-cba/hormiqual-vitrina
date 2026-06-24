const express = require('express');
const router = express.Router();

const reporteResistenciaController = require('../controllers/reporteResistenciaController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/', verifyJwt, reporteResistenciaController.getReportes);
router.get('/:id', verifyJwt, reporteResistenciaController.getReporte);
router.post('/', verifyJwt, reporteResistenciaController.createReporte);
router.put('/:id', verifyJwt, reporteResistenciaController.updateReporte);
router.delete('/:id', verifyJwt, reporteResistenciaController.deleteReporte);

module.exports = router;