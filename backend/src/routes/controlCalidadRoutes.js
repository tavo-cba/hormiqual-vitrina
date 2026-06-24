const express = require('express');
const router = express.Router();
const controller = require('../controllers/controlCalidadController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/dashboard', verifyJwt, controller.getDashboard);
router.get('/control-chart', verifyJwt, controller.getControlChart);
router.get('/cusum', verifyJwt, controller.getCusum);
router.get('/tipos-hormigon', verifyJwt, controller.getTiposHormigon);

module.exports = router;
