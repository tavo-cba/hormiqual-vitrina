const estadisticasDespachoService = require('../services/estadisticasDespachoService');

exports.getEstadisticas = async (req, res, next) => {
  try {
    const data = await estadisticasDespachoService.getEstadisticas(req.db, req.query, req.user);
    res.json(data);
  } catch (err) {
    next(err);
  }
};
