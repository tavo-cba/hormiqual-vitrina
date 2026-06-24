'use strict';

const svc = require('../services/materialPrecioService');

const getPrecios = async (req, res) => {
  try {
    const { source, sourceId } = req.params;
    const idPlanta = req.query.idPlanta != null ? Number(req.query.idPlanta) : null;
    const precios = await svc.getPrecios(req.db, source, Number(sourceId), idPlanta);
    res.json(precios);
  } catch (err) {
    console.error('Error al obtener precios:', err);
    res.status(500).json({ error: 'Error al obtener precios' });
  }
};

const getPrecioVigente = async (req, res) => {
  try {
    const { source, sourceId } = req.params;
    const idPlanta = req.query.idPlanta != null ? Number(req.query.idPlanta) : null;
    const precio = await svc.getPrecioVigente(req.db, source, Number(sourceId), idPlanta);
    res.json(precio);
  } catch (err) {
    console.error('Error al obtener precio vigente:', err);
    res.status(500).json({ error: 'Error al obtener precio vigente' });
  }
};

const getPreciosVigentesBulk = async (req, res) => {
  try {
    const { materiales } = req.body; // [{ materialSource, materialSourceId }]
    if (!Array.isArray(materiales)) {
      return res.status(400).json({ error: 'Se requiere un array de materiales' });
    }
    const precios = await svc.getPreciosVigentesBulk(req.db, materiales);
    res.json(precios);
  } catch (err) {
    console.error('Error al obtener precios vigentes bulk:', err);
    res.status(500).json({ error: 'Error al obtener precios vigentes' });
  }
};

const createPrecio = async (req, res) => {
  try {
    const precio = await svc.createPrecio(req.db, req.body);
    res.status(201).json(precio);
  } catch (err) {
    console.error('Error al crear precio:', err);
    res.status(500).json({ error: 'Error al crear precio' });
  }
};

const updatePrecio = async (req, res) => {
  try {
    const precio = await svc.updatePrecio(req.db, req.params.id, req.body);
    res.json(precio);
  } catch (err) {
    console.error('Error al actualizar precio:', err);
    res.status(500).json({ error: err.message || 'Error al actualizar precio' });
  }
};

const deletePrecio = async (req, res) => {
  try {
    const result = await svc.deletePrecio(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('Error al eliminar precio:', err);
    res.status(500).json({ error: err.message || 'Error al eliminar precio' });
  }
};

const importarPrecios = async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se requiere un array de items' });
    }
    const result = await svc.importarPrecios(req.db, items);
    res.status(201).json(result);
  } catch (err) {
    console.error('Error al importar precios:', err);
    res.status(500).json({ error: 'Error al importar precios' });
  }
};

module.exports = {
  getPrecios,
  getPrecioVigente,
  getPreciosVigentesBulk,
  createPrecio,
  updatePrecio,
  deletePrecio,
  importarPrecios,
};
