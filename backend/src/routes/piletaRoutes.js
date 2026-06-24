const express = require('express');
const router = express.Router();
const piletaController = require('../controllers/piletaController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/alertas', verifyJwt, piletaController.getAlertas);
router.post('/bulk-assign-lab', verifyJwt, piletaController.bulkAssignLab);
router.get('/planta/:idPlanta', verifyJwt, piletaController.getPiletasByPlanta);
router.get('/:id/temperatura', verifyJwt, piletaController.getTemperatureHistory);
router.get('/:id/consumo', verifyJwt, piletaController.getConsumo);
router.get('/:id/correlacion-ambiente', verifyJwt, piletaController.getCorrelacionAmbiente);
router.get('/:id/resistencias-on', verifyJwt, piletaController.getResistenciasOnRanges);
router.get('/:id/comandos', verifyJwt, piletaController.getComandosRecientes);
router.post('/:id/comandos', verifyJwt, piletaController.crearComando);
router.get('/:id', verifyJwt, piletaController.getPileta);
router.get('/', verifyJwt, piletaController.getPiletas);
router.post('/', verifyJwt, piletaController.createPileta);
router.put('/:id', verifyJwt, piletaController.updatePileta);
router.delete('/:id', verifyJwt, piletaController.deletePileta);

module.exports = router;
