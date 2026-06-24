const svc = require('../services/laboratorioService');

const sendError = (res, err, fallback = 'Error inesperado') => {
    const status = err?.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err?.message || fallback });
};

exports.getLaboratorios = async (req, res) => {
    try {
        const { idPlanta, soloActivos } = req.query;
        const labs = await svc.getLaboratorios(req.db, {
            idPlanta: idPlanta ? Number(idPlanta) : null,
            soloActivos: soloActivos !== 'false',
        });
        res.json(labs);
    } catch (err) { sendError(res, err, 'Error al obtener laboratorios'); }
};

exports.getLaboratorio = async (req, res) => {
    try {
        const lab = await svc.getLaboratorio(req.db, req.params.id);
        res.json(lab);
    } catch (err) { sendError(res, err, 'Error al obtener el laboratorio'); }
};

exports.createLaboratorio = async (req, res) => {
    try {
        const lab = await svc.createLaboratorio(req.db, req.body);
        res.status(201).json(lab);
    } catch (err) { sendError(res, err, 'Error al crear el laboratorio'); }
};

exports.updateLaboratorio = async (req, res) => {
    try {
        const lab = await svc.updateLaboratorio(req.db, req.params.id, req.body);
        res.json(lab);
    } catch (err) { sendError(res, err, 'Error al actualizar el laboratorio'); }
};

exports.deleteLaboratorio = async (req, res) => {
    try {
        await svc.deleteLaboratorio(req.db, req.params.id);
        res.json({ message: 'Laboratorio dado de baja' });
    } catch (err) { sendError(res, err, 'Error al eliminar el laboratorio'); }
};
