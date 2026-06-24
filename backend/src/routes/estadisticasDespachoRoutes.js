const express = require('express');
const router = express.Router();
const { verifyJwt } = require('../middlewares/verifyToken');
const { cacheResponse } = require('../cache/cacheMiddleware');
const estadisticasDespachoController = require('../controllers/estadisticasDespachoController');

// GET /api/estadisticas-despachos
// Cache por 5 minutos, por usuario (permisos de planta difieren)
router.get(
  '/',
  verifyJwt,
  cacheResponse('estadisticasDespachos', 300, { perUser: true }),
  estadisticasDespachoController.getEstadisticas,
);

module.exports = router;
