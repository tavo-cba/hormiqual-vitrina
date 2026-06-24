'use strict';

const svc = require('../services/tipologiaHormigonService');

const listar = async (req, res) => {
  try {
    const rows = await svc.listar(req.db);
    res.json(rows);
  } catch (err) {
    console.error('[tipologiaHormigon] listar:', err);
    res.status(500).json({ error: 'Error al listar tipologías' });
  }
};

const obtener = async (req, res) => {
  try {
    const row = await svc.obtener(req.db, req.params.id);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    res.json(row);
  } catch (err) {
    console.error('[tipologiaHormigon] obtener:', err);
    res.status(500).json({ error: err.message });
  }
};

const obtenerPorCodigo = async (req, res) => {
  try {
    const row = await svc.obtenerPorCodigo(req.db, req.params.codigo);
    if (!row) return res.status(404).json({ error: 'No encontrada' });
    res.json(row);
  } catch (err) {
    console.error('[tipologiaHormigon] obtenerPorCodigo:', err);
    res.status(500).json({ error: err.message });
  }
};

const crear = async (req, res) => {
  try {
    const row = await svc.crear(req.db, req.body);
    res.status(201).json(row);
  } catch (err) {
    console.error('[tipologiaHormigon] crear:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

const actualizar = async (req, res) => {
  try {
    const row = await svc.actualizar(req.db, req.params.id, req.body);
    res.json(row);
  } catch (err) {
    console.error('[tipologiaHormigon] actualizar:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

const eliminar = async (req, res) => {
  try {
    const result = await svc.eliminar(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[tipologiaHormigon] eliminar:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

const restaurarDefaults = async (req, res) => {
  try {
    const row = await svc.restaurarDefaults(req.db, req.params.id);
    res.json(row);
  } catch (err) {
    console.error('[tipologiaHormigon] restaurarDefaults:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
};

module.exports = { listar, obtener, obtenerPorCodigo, crear, actualizar, eliminar, restaurarDefaults };
