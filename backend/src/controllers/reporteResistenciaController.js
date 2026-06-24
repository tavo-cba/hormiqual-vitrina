const reporteResistenciaService = require('../services/reporteResistenciaService');

const getReportes = async (req, res) => {
    try {
        const data = await reporteResistenciaService.getReportes(req.db, req.query);
        res.status(200).json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener reportes de resistencia' });
    }
};

const getReporte = async (req, res) => {
    try {
        const reporte = await reporteResistenciaService.getReporte(req.db, req.params.id);
        res.status(200).json(reporte);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al obtener el reporte' });
    }
};

const createReporte = async (req, res) => {
    try {
        const reporte = await reporteResistenciaService.createReporte(
            req.db,
            req.body,
            req.user?.idEmpleado,
        );
        res.status(201).json(reporte);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al crear el reporte' });
    }
};

const updateReporte = async (req, res) => {
    try {
        const reporte = await reporteResistenciaService.updateReporte(
            req.db,
            req.params.id,
            req.body,
        );
        res.status(200).json(reporte);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al actualizar el reporte' });
    }
};

const deleteReporte = async (req, res) => {
    try {
        const data = await reporteResistenciaService.deleteReporte(req.db, req.params.id);
        res.status(200).json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al eliminar el reporte' });
    }
};

module.exports = {
    getReportes,
    getReporte,
    createReporte,
    updateReporte,
    deleteReporte,
};