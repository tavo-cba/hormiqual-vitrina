const service = require('../services/controlCalidadService');

const getDashboard = async (req, res) => {
  try {
    const data = await service.getDashboard(req.db, req.query, req.user);
    res.json(data);
  } catch (err) {
    console.error('Error en getDashboard calidad:', err);
    res.status(500).json({ error: 'Error al obtener dashboard de calidad' });
  }
};

const getControlChart = async (req, res) => {
  try {
    const data = await service.getControlChartData(req.db, req.query, req.user);
    res.json(data);
  } catch (err) {
    console.error('Error en getControlChart:', err);
    res.status(500).json({ error: 'Error al obtener datos de control' });
  }
};

const getCusum = async (req, res) => {
  try {
    const data = await service.getCusumData(req.db, req.query, req.user);
    res.json(data);
  } catch (err) {
    console.error('Error en getCusum:', err);
    res.status(500).json({ error: 'Error al obtener datos CUSUM' });
  }
};

const getTiposHormigon = async (req, res) => {
  try {
    const data = await service.getTiposHormigon(req.db);
    res.json(data);
  } catch (err) {
    console.error('Error en getTiposHormigon:', err);
    res.status(500).json({ error: 'Error al obtener tipos de hormigón' });
  }
};

module.exports = { getDashboard, getControlChart, getCusum, getTiposHormigon };
