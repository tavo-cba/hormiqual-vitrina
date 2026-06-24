'use strict';

const svc = require('../services/recetaObraService');

const calcular = async (req, res) => {
  try {
    const { resultado, humedades, volumenBachada } = req.body;
    const calc = svc.calcularRecetaObra(resultado, humedades, volumenBachada);
    res.json(calc);
  } catch (err) {
    console.error('[recetaObra] calcular:', err.message);
    res.status(400).json({ error: err.message });
  }
};

const guardar = async (req, res) => {
  try {
    const result = await svc.guardarReceta(req.db, req.body);
    res.status(201).json(result);
  } catch (err) {
    console.error('[recetaObra] guardar:', err.message);
    const status = err.message.includes('no encontrada') ? 404
      : err.message.includes('No se pueden crear') ? 403
      : 400;
    res.status(status).json({ error: err.message });
  }
};

const listar = async (req, res) => {
  try {
    const { dosificacionId } = req.params;
    const rows = await svc.listarRecetas(req.db, dosificacionId);
    res.json(rows);
  } catch (err) {
    console.error('[recetaObra] listar:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const obtener = async (req, res) => {
  try {
    const receta = await svc.obtenerReceta(req.db, req.params.id);
    res.json(receta);
  } catch (err) {
    console.error('[recetaObra] obtener:', err.message);
    res.status(err.message.includes('no encontrada') ? 404 : 500).json({ error: err.message });
  }
};

const eliminar = async (req, res) => {
  try {
    const result = await svc.eliminarReceta(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[recetaObra] eliminar:', err.message);
    res.status(err.message.includes('no encontrada') ? 404 : 500).json({ error: err.message });
  }
};

const obtenerUltimasHumedades = async (req, res) => {
  try {
    const rows = await svc.obtenerUltimasHumedadesEnsayo(req.db, req.params.dosificacionId);
    res.json(rows);
  } catch (err) {
    console.error('[recetaObra] humedades:', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { calcular, guardar, listar, obtener, eliminar, obtenerUltimasHumedades };
