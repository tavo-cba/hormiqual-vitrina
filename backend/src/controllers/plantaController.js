const plantaService = require('../services/plantaService');

const getPlantas = async (req, res) => {
    try {
        const plantas = await plantaService.getPlantas(req.db);
        res.status(200).json(plantas);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener plantas' });
    }
};

const getPlanta = async (req, res) => {
    try {
        const idPlanta = req.params.id;
        const planta = await plantaService.getPlanta(req.db, idPlanta);
        res.status(200).json(planta);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener la planta' });
    }
};

const createPlanta = async (req, res) => {
    try {
        const nuevaPlanta = await plantaService.createPlanta(req.db, req.body);
        res.status(201).json(nuevaPlanta);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear la planta' });
    }
};

const updatePlanta = async (req, res) => {
    try {
        const idPlanta = req.params.id;
        const plantaActualizada = await plantaService.updatePlanta(req.db, idPlanta, req.body);
        res.status(200).json(plantaActualizada);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar la planta' });
    }
};

// Patch dedicado de calibración HRDC por planta. La UI lo usa desde Calidad →
// Catálogos → Parámetros del motor → Calibración HRDC (no desde el form
// general de Planta en Administrar → Plantas).
const updateCalibracionHRDC = async (req, res) => {
    try {
        const idPlanta = req.params.id;
        const plantaActualizada = await plantaService.updateCalibracionHRDC(req.db, idPlanta, req.body);
        res.status(200).json(plantaActualizada);
    } catch (error) {
        if (error.status === 404) return res.status(404).json({ error: error.message });
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar calibración HRDC' });
    }
};

const getDosificacionesParaDespacho = async (req, res) => {
    try {
        const idPlanta = req.params.id;
        const result = await plantaService.getDosificacionesParaDespacho(req.db, idPlanta);
        res.status(200).json(result);
    } catch (error) {
        console.error('Error obteniendo dosificaciones para despacho:', error);
        res.status(500).json({ error: error.message || 'Error al obtener dosificaciones' });
    }
};

const deletePlanta = async (req, res) => {
    try {
        const idPlanta = req.params.id;
        await plantaService.deletePlanta(req.db, idPlanta);
        res.status(200).json({ message: 'Planta eliminada correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar la planta' });
    }
};

module.exports = {
    getPlantas,
    getPlanta,
    createPlanta,
    updatePlanta,
    updateCalibracionHRDC,
    getDosificacionesParaDespacho,
    deletePlanta,
};
