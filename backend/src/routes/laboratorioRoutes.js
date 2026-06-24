const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/laboratorioController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/:id', verifyJwt, ctrl.getLaboratorio);
router.get('/', verifyJwt, ctrl.getLaboratorios);
router.post('/', verifyJwt, ctrl.createLaboratorio);
router.put('/:id', verifyJwt, ctrl.updateLaboratorio);
router.delete('/:id', verifyJwt, ctrl.deleteLaboratorio);

module.exports = router;
