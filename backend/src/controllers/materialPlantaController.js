'use strict';

const svc = require('../services/materialPlantaService');

const listarPlantasDeMaterial = async (req, res) => {
  try {
    const { source, sourceId } = req.params;
    const rows = await svc.listarPlantasDeMaterial(req.db, source, sourceId);
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al listar plantas del material' });
  }
};

const listarMaterialesDePlanta = async (req, res) => {
  try {
    const { source, idPlanta } = req.params;
    const rows = await svc.listarMaterialesDePlanta(req.db, source, idPlanta);
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al listar materiales de la planta' });
  }
};

const sincronizarPlantas = async (req, res) => {
  try {
    const { source, sourceId } = req.params;
    const { plantasConfig } = req.body;
    const rows = await svc.sincronizarPlantas(req.db, source, sourceId, plantasConfig);
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al sincronizar plantas' });
  }
};

const upsertPlanta = async (req, res) => {
  try {
    const { source, sourceId, idPlanta } = req.params;
    const row = await svc.upsertPlanta(req.db, source, sourceId, idPlanta, req.body || {});
    res.json(row);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al asignar planta' });
  }
};

const desasignarPlanta = async (req, res) => {
  try {
    const { source, sourceId, idPlanta } = req.params;
    const result = await svc.desasignarPlanta(req.db, source, sourceId, idPlanta);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Error al desasignar planta' });
  }
};

module.exports = {
  listarPlantasDeMaterial,
  listarMaterialesDePlanta,
  sincronizarPlantas,
  upsertPlanta,
  desasignarPlanta,
};
