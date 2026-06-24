// backend/controllers/fibraController.js
const fibraService = require("../services/fibraService");

/* ───────────────  CRUD  ─────────────── */
const getFibras = async (req, res) => {
  try {
    const idPlanta = req.query.idPlanta != null ? Number(req.query.idPlanta) : null;
    const includeArchived = req.query.includeArchived === 'true';
    const data = await fibraService.getFibras(req.db, { idPlanta, includeArchived });
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener fibras" });
  }
};

const getFibra = async (req, res) => {
  try {
    const { id } = req.params;
    const fibra = await fibraService.getFibra(req.db, id);
    if (!fibra) return res.status(404).json({ error: "Fibra no encontrada" });
    res.status(200).json(fibra);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener la fibra" });
  }
};

const createFibra = async (req, res) => {
  try {
    const nuevo = await fibraService.createFibra(req.db, req.body);
    res.status(201).json(nuevo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear la fibra" });
  }
};

const updateFibra = async (req, res) => {
  try {
    const { id } = req.params;
    const actualizado = await fibraService.updateFibra(req.db, id, req.body);
    res.status(200).json(actualizado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la fibra" });
  }
};

const deleteFibra = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await fibraService.deleteFibra(req.db, id);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la fibra" });
  }
};


module.exports = {
  getFibras,
  getFibra,
  createFibra,
  updateFibra,
  deleteFibra,
};
