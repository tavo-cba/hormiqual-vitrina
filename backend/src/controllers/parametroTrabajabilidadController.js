'use strict';

/**
 * parametroTrabajabilidadController.js
 *
 * Controller HTTP para `/api/parametros-trabajabilidad`. Solo parsea
 * request, despacha al service y serializa la respuesta. Sin acceso
 * directo a Sequelize (auditoría 01-calidad C9 / Fase D — sesión 2026-05-07).
 */

const svc = require('../services/parametroTrabajabilidadService');

const getAll = async (req, res) => {
  try {
    const grouped = await svc.listAgrupados(req.db);
    res.json(grouped);
  } catch (err) {
    console.error('[parametroTrabajabilidadController] getAll error:', err);
    res.status(500).json({ error: 'Error al obtener parametros de trabajabilidad' });
  }
};

const create = async (req, res) => {
  try {
    const row = await svc.crear(req.db, req.body);
    res.status(201).json(row);
  } catch (err) {
    console.error('[parametroTrabajabilidadController] create error:', err);
    res.status(500).json({ error: 'Error al crear parametro de trabajabilidad' });
  }
};

const update = async (req, res) => {
  try {
    const row = await svc.actualizar(req.db, req.params.id, req.body);
    res.json(row);
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    console.error('[parametroTrabajabilidadController] update error:', err);
    res.status(500).json({ error: 'Error al actualizar parametro de trabajabilidad' });
  }
};

const remove = async (req, res) => {
  try {
    const result = await svc.eliminar(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    console.error('[parametroTrabajabilidadController] remove error:', err);
    res.status(500).json({ error: 'Error al eliminar parametro de trabajabilidad' });
  }
};

module.exports = { getAll, create, update, remove };
