'use strict';

const svc = require('../services/cementoPlantaService');

const listarPorCemento = async (req, res) => {
  try {
    const rows = await svc.listarPorCemento(req.db, req.params.idCemento);
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al listar plantas del cemento' });
  }
};

const listarPorPlanta = async (req, res) => {
  try {
    const rows = await svc.listarPorPlanta(req.db, req.params.idPlanta, {
      includeInactivos: req.query.includeInactivos === 'true',
    });
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al listar cementos de la planta' });
  }
};

const upsert = async (req, res) => {
  try {
    const { idCemento, idPlanta } = req.params;
    const row = await svc.upsert(req.db, idCemento, idPlanta, req.body || {});
    res.json(row);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al asignar cemento a planta' });
  }
};

const actualizarPorId = async (req, res) => {
  try {
    const row = await svc.actualizarPorId(req.db, req.params.id, req.body || {});
    res.json(row);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al actualizar configuración' });
  }
};

const desasignar = async (req, res) => {
  try {
    const result = await svc.desasignar(req.db, req.params.idCemento, req.params.idPlanta);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al desasignar' });
  }
};

module.exports = { listarPorCemento, listarPorPlanta, upsert, actualizarPorId, desasignar };
