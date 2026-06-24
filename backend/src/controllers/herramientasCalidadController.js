'use strict';

const svc = require('../services/herramientasCalidadService');

const sendError = (res, err, fallback = 'Error inesperado') => {
    const status = err?.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err?.message || fallback });
};

exports.verificarTabla25 = async (req, res) => {
    try {
        const r = await svc.verificarTabla25(req.db, req.body || {});
        res.json(r);
    } catch (err) { sendError(res, err, 'Error al verificar Tabla 2.5'); }
};

exports.verificarTabla43 = async (req, res) => {
    try {
        const r = await svc.verificarTabla43(req.db, req.body || {});
        res.json(r);
    } catch (err) { sendError(res, err, 'Error al verificar Tabla 4.3'); }
};

exports.verificarTabla44 = async (req, res) => {
    try {
        const r = await svc.verificarTabla44(req.db, req.body || {});
        res.json(r);
    } catch (err) { sendError(res, err, 'Error al verificar Tabla 4.4'); }
};

exports.listarClasesExposicion = async (req, res) => {
    try {
        const r = await svc.listarClasesExposicion(req.db);
        res.json(r);
    } catch (err) { sendError(res, err, 'Error al cargar clases de exposición'); }
};

exports.listarTmnTabla43 = async (req, res) => {
    try {
        const r = await svc.listarTmnTabla43(req.db);
        res.json(r);
    } catch (err) { sendError(res, err, 'Error al cargar TMNs'); }
};

exports.listarPulverulentoMinimo = async (req, res) => {
    try {
        const r = await svc.listarPulverulentoMinimo(req.db);
        res.json(r);
    } catch (err) { sendError(res, err, 'Error al cargar Tabla 4.4'); }
};

exports.estimarACDesdeFc = async (req, res) => {
    try {
        const r = await svc.estimarACDesdeFc(req.db, req.body || {});
        res.json(r);
    } catch (err) { sendError(res, err, 'Error al estimar a/c'); }
};

exports.listarCurvasAC = async (req, res) => {
    try {
        const r = await svc.listarCurvasAC(req.db);
        res.json(r);
    } catch (err) { sendError(res, err, 'Error al cargar curvas a/c'); }
};
