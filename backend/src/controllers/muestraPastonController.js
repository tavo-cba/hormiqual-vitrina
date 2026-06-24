'use strict';

const service = require('../services/muestraPastonService');

exports.getMuestrasPastones = async (req, res, next) => {
    try {
        const filtros = {
            fechaDesde: req.query.fechaDesde || null,
            fechaHasta: req.query.fechaHasta || null,
            idPlanta: req.query.idPlanta || null,
            idDosificacion: req.query.idDosificacion || null,
            idPastonPrueba: req.query.idPastonPrueba || null,
            origen: req.query.origen || null,
        };
        const data = await service.getMuestrasPastones(req.db, filtros);
        res.json(data);
    } catch (err) { next(err); }
};

exports.getMuestraPaston = async (req, res, next) => {
    try {
        const data = await service.getMuestraPastonPorId(req.db, req.params.id);
        if (!data) return res.status(404).json({ error: 'Muestra de pastón no encontrada' });
        res.json(data);
    } catch (err) { next(err); }
};

// Datos para la ficha PDF de la muestra de pastón (mismo shape que la ficha
// de muestra → reutiliza el generador fichaMuestraPdf en el frontend).
exports.getFichaMuestraPaston = async (req, res, next) => {
    try {
        // Filtro de planta del usuario; admin pasa null y ve todo (mismo
        // criterio que muestraController.getFichaMuestra).
        const plantaIds = req.user?.isAdmin === true ? null : (req.user?.plantaIds || []);
        const data = await service.getFichaMuestraPaston(req.db, req.params.id, plantaIds);
        if (!data) return res.status(404).json({ error: 'Muestra de pastón no encontrada' });
        res.json(data);
    } catch (err) { next(err); }
};

exports.crearMuestraDesdePaston = async (req, res, next) => {
    try {
        const data = await service.crearMuestraDesdePaston(req.db, req.body);
        res.status(201).json(data);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
};

exports.updateMuestraPaston = async (req, res, next) => {
    try {
        const data = await service.updateMuestraPaston(req.db, req.params.id, req.body);
        res.json(data);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
};

exports.sincronizarProbetas = async (req, res, next) => {
    try {
        const probetas = Array.isArray(req.body) ? req.body : req.body?.probetas;
        const data = await service.sincronizarProbetas(req.db, req.params.id, probetas || []);
        res.json(data);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ error: err.message });
        next(err);
    }
};

exports.deleteMuestraPaston = async (req, res, next) => {
    try {
        await service.deleteMuestraPaston(req.db, req.params.id);
        res.json({ message: 'Muestra de pastón eliminada' });
    } catch (err) { next(err); }
};
