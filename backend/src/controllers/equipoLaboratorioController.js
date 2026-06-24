const svc = require('../services/equipoLaboratorioService');

const sendError = (res, err, fallback = 'Error inesperado') => {
    const status = err?.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err?.message || fallback });
};

exports.getEquipos = async (req, res) => {
    try {
        const { tipo, idPlanta, idLaboratorio, soloActivos } = req.query;
        const equipos = await svc.getEquipos(req.db, {
            tipo: tipo || null,
            idPlanta: idPlanta ? Number(idPlanta) : null,
            idLaboratorio: idLaboratorio ? Number(idLaboratorio) : null,
            soloActivos: soloActivos !== 'false',
        });
        res.json(equipos);
    } catch (err) { sendError(res, err, 'Error al obtener equipos'); }
};

exports.getEquipo = async (req, res) => {
    try {
        const equipo = await svc.getEquipo(req.db, req.params.id);
        res.json(equipo);
    } catch (err) { sendError(res, err, 'Error al obtener el equipo'); }
};

exports.createEquipo = async (req, res) => {
    try {
        const equipo = await svc.createEquipo(req.db, req.body);
        res.status(201).json(equipo);
    } catch (err) { sendError(res, err, 'Error al crear el equipo'); }
};

exports.updateEquipo = async (req, res) => {
    try {
        const equipo = await svc.updateEquipo(req.db, req.params.id, req.body);
        res.json(equipo);
    } catch (err) { sendError(res, err, 'Error al actualizar el equipo'); }
};

exports.deleteEquipo = async (req, res) => {
    try {
        await svc.deleteEquipo(req.db, req.params.id);
        res.json({ message: 'Equipo dado de baja' });
    } catch (err) { sendError(res, err, 'Error al eliminar el equipo'); }
};

exports.bulkAssignLab = async (req, res) => {
    try {
        const result = await svc.bulkAssignLab(req.db, {
            idLaboratorio: req.body?.idLaboratorio,
            idsEquipo: req.body?.idsEquipo || req.body?.equipos,
        });
        res.json(result);
    } catch (err) { sendError(res, err, 'Error en la asignación masiva'); }
};

exports.getTipos = (_req, res) => {
    res.json([...svc.TIPOS_VALIDOS]);
};
