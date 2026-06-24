// src/controllers/muestraController.js
const muestraService = require("../services/muestraService");

exports.getTipoProbeta = async (req, res, next) => {
  try {
    const db = req.db;
    const data = await muestraService.getTipoProbeta(db);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getTipoHormigon = async (req, res, next) => {
  try {
    const db = req.db;
    const data = await muestraService.getTipoHormigon(db);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getModalidades = async (req, res, next) => {
  try {
    const db = req.db;
    const data = await muestraService.getModalidades(db);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getMuestras = async (req, res, next) => {
  try {
    const db = req.db;
    const data = await muestraService.getMuestras(db, req.query);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getMuestra = async (req, res, next) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const data = await muestraService.getMuestra(db, id);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.createMuestra = async (req, res, next) => {
  try {
    const db = req.db;
    const data = await muestraService.createMuestra(db, req.body);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
};

exports.updateMuestra = async (req, res, next) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const data = await muestraService.updateMuestra(db, id, req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.confirmarMuestra = async (req, res, next) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const { loteNumero, idPileta } = req.body;
    const data = await muestraService.confirmarMuestra(db, id, loteNumero, idPileta);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteMuestra = async (req, res, next) => {
  try {
    const db = req.db;
    const { id } = req.params;
    await muestraService.deleteMuestra(db, id);
    res.json({ message: "Muestra eliminada" });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/muestra/:id/ficha
 * N-06 (auditoría 08, Bloque 7): payload consolidado para emitir el PDF
 * de ficha de muestra (resumen de un día de moldeo). Aplica filtro de
 * planta del usuario; admin pasa null y ve todo.
 */
exports.getFichaMuestra = async (req, res, next) => {
  try {
    const db = req.db;
    const { id } = req.params;
    const plantaIds = req.user?.isAdmin === true ? null : (req.user?.plantaIds || []);
    const data = await muestraService.getFichaMuestra(db, id, plantaIds);
    if (!data) {
      return res.status(404).json({ error: 'Muestra no encontrada o fuera del alcance del usuario.' });
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /internal/muestras/:id/ficha
 * Variante para el Portal de Clientes (body: { razonSocial, cuit }).
 */
exports.getFichaMuestraWeb = async (req, res) => {
  try {
    const { razonSocial, cuit } = req.body || {};
    const data = await muestraService.getFichaMuestraWeb(req.db, req.params.id, { razonSocial, cuit });
    if (data === 'forbidden') return res.status(403).json({ error: 'Esta muestra no pertenece a la cuenta' });
    if (data === null) return res.status(404).json({ error: 'Muestra no encontrada' });
    res.json(data);
  } catch (err) {
    console.error('Error getFichaMuestraWeb:', err);
    res.status(500).json({ error: 'Error al obtener la ficha de muestra' });
  }
};
