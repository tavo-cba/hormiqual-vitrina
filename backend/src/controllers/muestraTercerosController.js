const service = require('../services/muestraTercerosService');

exports.getMuestrasTerceros = async (req, res, next) => {
  try {
    const data = await service.getMuestrasTerceros(req.db);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.getMuestraTerceros = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = await service.getMuestraTerceros(req.db, id);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.createMuestraTerceros = async (req, res, next) => {
  try {
    const data = await service.createMuestraTerceros(req.db, req.body);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
};

exports.updateMuestraTerceros = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = await service.updateMuestraTerceros(req.db, id, req.body);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

exports.confirmarMuestraTerceros = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { loteNumero, idPileta } = req.body;
    const data = await service.confirmarMuestraTerceros(req.db, id, loteNumero, idPileta);
    res.json(data);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/**
 * GET /api/muestras-terceros/:id/ficha
 * Payload consolidado para emitir el PDF de ficha. Aplica filtro de planta
 * del usuario; admin pasa null y ve todo.
 */
exports.getFichaMuestraTerceros = async (req, res, next) => {
  try {
    const { id } = req.params;
    const plantaIds = req.user?.isAdmin === true ? null : (req.user?.plantaIds || []);
    const data = await service.getFichaMuestraTerceros(req.db, id, plantaIds);
    if (!data) {
      return res.status(404).json({ error: 'Muestra no encontrada o fuera del alcance del usuario.' });
    }
    res.json(data);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /internal/muestras-terceros/:id/ficha
 * Variante para el Portal de Clientes con ownership por razonSocial + cuit.
 */
exports.getFichaMuestraTercerosWeb = async (req, res) => {
  try {
    const { razonSocial, cuit } = req.body || {};
    const data = await service.getFichaMuestraTercerosWeb(req.db, req.params.id, { razonSocial, cuit });
    if (data === 'forbidden') return res.status(403).json({ error: 'Esta muestra no pertenece a la cuenta' });
    if (data === null) return res.status(404).json({ error: 'Muestra no encontrada' });
    res.json(data);
  } catch (err) {
    console.error('Error getFichaMuestraTercerosWeb:', err);
    res.status(500).json({ error: 'Error al obtener la ficha de muestra' });
  }
};

exports.deleteMuestraTerceros = async (req, res, next) => {
  try {
    const { id } = req.params;
    await service.deleteMuestraTerceros(req.db, id);
    res.json({ message: 'Muestra eliminada' });
  } catch (err) {
    next(err);
  }
};