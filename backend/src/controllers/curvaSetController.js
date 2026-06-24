'use strict';

const curvaSetService = require('../services/curvaSetService');

/**
 * Wrapper para errores: loguea stack completo, devuelve JSON siempre.
 */
function handleError(res, error, label) {
  console.error(`[${label}]`, error.stack || error);

  const isNotFound = error.message && error.message.includes('no encontrad');
  if (isNotFound) {
    return res.status(404).json({ error: error.message });
  }

  const payload = { error: error.message || 'Error interno' };
  if (process.env.NODE_ENV !== 'production') {
    payload.stack = error.stack;
  }
  return res.status(500).json(payload);
}

const getCurvaSets = async (req, res) => {
  try {
    const { materialUso, estado, isActive } = req.query;
    const sets = await curvaSetService.getCurvaSets(req.db, {
      materialUso: materialUso || undefined,
      estado: estado || undefined,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
    res.status(200).json(sets);
  } catch (error) {
    handleError(res, error, 'getCurvaSets');
  }
};

const getCurvaSet = async (req, res) => {
  try {
    const set = await curvaSetService.getCurvaSet(req.db, req.params.id);
    if (!set) return res.status(404).json({ error: 'Set no encontrado' });
    res.status(200).json(set);
  } catch (error) {
    handleError(res, error, 'getCurvaSet');
  }
};

const createCurvaSet = async (req, res) => {
  try {
    const nuevo = await curvaSetService.createCurvaSet(req.db, req.body);
    res.status(201).json(nuevo);
  } catch (error) {
    handleError(res, error, 'createCurvaSet');
  }
};

const updateCurvaSet = async (req, res) => {
  try {
    const actualizado = await curvaSetService.updateCurvaSet(req.db, req.params.id, req.body);
    res.status(200).json(actualizado);
  } catch (error) {
    handleError(res, error, 'updateCurvaSet');
  }
};

const deleteCurvaSet = async (req, res) => {
  try {
    const result = await curvaSetService.deleteCurvaSet(req.db, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error, 'deleteCurvaSet');
  }
};

const createIRAM1627Total = async (req, res) => {
  try {
    const { tmnMm, createABC } = req.body;
    const curveLetter = req.body.curveLetter ?? req.body.letter ?? undefined;
    if (!tmnMm) {
      return res.status(400).json({ error: 'tmnMm es requerido' });
    }
    const result = await curvaSetService.createIRAM1627Total(req.db, {
      tmnMm: Number(tmnMm),
      createABC: createABC === true,
      curveLetter: curveLetter || undefined,
    });
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, 'createIRAM1627Total');
  }
};

module.exports = {
  getCurvaSets,
  getCurvaSet,
  createCurvaSet,
  updateCurvaSet,
  deleteCurvaSet,
  createIRAM1627Total,
};
