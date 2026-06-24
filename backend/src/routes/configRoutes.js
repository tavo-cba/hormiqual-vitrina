const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireAdmin } = require('../middlewares/permissions');
const { cacheResponse } = require('../cache');

router.get('/health', verifyJwt, requireAdmin, configController.getConfigHealth);
router.get('/keys', verifyJwt, configController.getKeys);
router.get('/resolve-map-link', verifyJwt, configController.resolveMapShortLink);
router.get('/probetas', verifyJwt, cacheResponse('config', 3600), configController.getProbetasConfig);
router.get('/all', verifyJwt, requireAdmin, configController.getAllConfig);
router.get('/facturacion', verifyJwt, configController.getFacturacionConfig);
router.get('/planilla', verifyJwt, configController.getPlanillaConfig);
router.get('/logo', configController.getLogo);
router.get('/', cacheResponse('config', 3600), configController.getConfig);
router.put('/', verifyJwt, configController.updateConfig);

module.exports = router;
