const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/equipoLaboratorioController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/tipos', verifyJwt, ctrl.getTipos);
router.post('/bulk-assign-lab', verifyJwt, ctrl.bulkAssignLab);
router.get('/:id', verifyJwt, ctrl.getEquipo);
router.get('/', verifyJwt, ctrl.getEquipos);
router.post('/', verifyJwt, ctrl.createEquipo);
router.put('/:id', verifyJwt, ctrl.updateEquipo);
router.delete('/:id', verifyJwt, ctrl.deleteEquipo);

module.exports = router;
