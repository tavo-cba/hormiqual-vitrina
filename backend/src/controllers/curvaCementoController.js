'use strict';

const svc = require('../services/curvaCementoService');
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// const { extractCurvaCementoPdf } = require('../services/curvaCementoPdfExtractor'); // importación por IA

const getCurvasCemento = async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const idPlanta = req.query.idPlanta != null && req.query.idPlanta !== '' ? Number(req.query.idPlanta) : null;
    const data = await svc.getCurvasCemento(req.db, { includeArchived, idPlanta });
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const getCurvaCemento = async (req, res) => {
  try {
    const data = await svc.getCurvaCemento(req.db, req.params.id);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const createCurvaCemento = async (req, res) => {
  try {
    const data = await svc.createCurvaCemento(req.db, req.body);
    res.status(201).json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const updateCurvaCemento = async (req, res) => {
  try {
    const data = await svc.updateCurvaCemento(req.db, req.params.id, req.body);
    res.json(data);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const deleteCurvaCemento = async (req, res) => {
  try {
    const result = await svc.deleteCurvaCemento(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// (extracción de curva de cemento desde PDF por IA — curvaCementoPdfExtractor)
const analizarPdf = async (req, res) =>
  res.status(501).json({ error: 'Importación de curva por PDF no disponible en la versión vitrina. Cargá la curva manualmente.' });

module.exports = { getCurvasCemento, getCurvaCemento, createCurvaCemento, updateCurvaCemento, deleteCurvaCemento, analizarPdf };
