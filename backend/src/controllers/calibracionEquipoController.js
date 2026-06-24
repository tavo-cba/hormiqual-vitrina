const svc = require('../services/calibracionEquipoService');

const sendError = (res, err, fallback = 'Error inesperado') => {
    const status = err?.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err?.message || fallback });
};

exports.getCalibraciones = async (req, res) => {
    try {
        const { idEquipo, soloActivas } = req.query;
        const list = await svc.getCalibraciones(req.db, {
            idEquipo: idEquipo ? Number(idEquipo) : null,
            soloActivas: soloActivas !== 'false',
        });
        res.json(list);
    } catch (err) { sendError(res, err, 'Error al obtener calibraciones'); }
};

exports.getCalibracion = async (req, res) => {
    try {
        const cal = await svc.getCalibracion(req.db, req.params.id);
        res.json(cal);
    } catch (err) { sendError(res, err, 'Error al obtener la calibración'); }
};

exports.createCalibracion = async (req, res) => {
    try {
        const created = await svc.createCalibracion(req.db, req.body);
        res.status(201).json(created);
    } catch (err) { sendError(res, err, 'Error al registrar la calibración'); }
};

exports.updateCalibracion = async (req, res) => {
    try {
        const updated = await svc.updateCalibracion(req.db, req.params.id, req.body);
        res.json(updated);
    } catch (err) { sendError(res, err, 'Error al actualizar la calibración'); }
};

exports.deleteCalibracion = async (req, res) => {
    try {
        await svc.deleteCalibracion(req.db, req.params.id);
        res.json({ message: 'Calibración anulada' });
    } catch (err) { sendError(res, err, 'Error al anular la calibración'); }
};
