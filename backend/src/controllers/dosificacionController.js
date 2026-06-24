const service = require("../services/dosificacionService");

/* ────────────────  CRUD  ──────────────── */
const getDosificaciones = async (req, res) => {
  try {
    const data = await service.getDosificaciones(req.db);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener dosificaciones" });
  }
};

const getDosificacion = async (req, res) => {
  try {
    const { id } = req.params;
    const dos = await service.getDosificacion(req.db, id);
    if (!dos) return res.status(404).json({ error: "Dosificación no encontrada" });
    res.status(200).json(dos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener la dosificación" });
  }
};

const createDosificacion = async (req, res) => {
  try {
    const nueva = await service.createDosificacion(req.db, req.body);
    res.status(201).json(nueva);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al crear la dosificación" });
  }
};

const updateDosificacion = async (req, res) => {
  try {
    const { id } = req.params;
    const upd = await service.updateDosificacion(req.db, id, req.body);
    res.status(200).json(upd);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al actualizar la dosificación" });
  }
};

const deleteDosificacion = async (req, res) => {
  try {
    const { id } = req.params;
    await service.deleteDosificacion(req.db, id);
    res.status(200).json({ message: "Dosificación eliminada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al eliminar la dosificación" });
  }
};

/* ────────────────  Catálogos  ──────────────── */
const getCatalogosBasicos = async (req, res) => {
  try {
    const cat = await service.getCatalogosBasicos(req.db);
    res.status(200).json(cat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener catálogos" });
  }
};

/* ────────────────  Importar Excel  ──────────────── */
const importarDosificaciones = async (req, res) => {
  try {
    const { idPlanta, dosificaciones } = req.body;
    if (!idPlanta || !Array.isArray(dosificaciones)) {
      return res.status(400).json({ error: "Faltan datos: idPlanta y dosificaciones son requeridos" });
    }
    const result = await service.importarDosificaciones(req.db, idPlanta, dosificaciones);
    res.status(200).json(result);
  } catch (err) {
    console.error("Error al importar dosificaciones:", err);
    res.status(500).json({ error: err.message || "Error al importar dosificaciones" });
  }
};

module.exports = {
  getDosificaciones,
  getDosificacion,
  createDosificacion,
  updateDosificacion,
  deleteDosificacion,
  getCatalogosBasicos,
  importarDosificaciones,
};
