// backend/controllers/aditivoController.js
const aditivoService = require("../services/aditivoService");

/* ───────────────  CRUD  ─────────────── */
const getAditivos = async (req, res) => {
  try {
    const idPlanta = req.query.idPlanta != null ? Number(req.query.idPlanta) : null;
    const includeArchived = req.query.includeArchived === 'true';
    const data = await aditivoService.getAditivos(req.db, { idPlanta, includeArchived });
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener aditivos" });
  }
};

const getAditivo = async (req, res) => {
  try {
    const { id } = req.params;
    const aditivo = await aditivoService.getAditivo(req.db, id);
    if (!aditivo) return res.status(404).json({ error: "Aditivo no encontrado" });
    res.status(200).json(aditivo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener el aditivo" });
  }
};

const createAditivo = async (req, res) => {
  try {
    const nuevo = await aditivoService.createAditivo(req.db, req.body);
    res.status(201).json(nuevo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear el aditivo" });
  }
};

const updateAditivo = async (req, res) => {
  try {
    const { id } = req.params;
    const actualizado = await aditivoService.updateAditivo(req.db, id, req.body);
    res.status(200).json(actualizado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el aditivo" });
  }
};

const deleteAditivo = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await aditivoService.deleteAditivo(req.db, id);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar el aditivo" });
  }
};

/* ───────────────  Catálogo  ─────────────── */
const getUnidadesMedida = async (req, res) => {
  try {
    const unidades = await aditivoService.getUnidadesMedida(req.db);
    res.status(200).json(unidades);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener unidades de medida" });
  }
};

module.exports = {
  getAditivos,
  getAditivo,
  createAditivo,
  updateAditivo,
  deleteAditivo,
  getUnidadesMedida,
};
