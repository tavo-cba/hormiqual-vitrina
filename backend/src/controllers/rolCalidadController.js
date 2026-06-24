'use strict';

const rolCalidadService = require('../services/rolCalidadService');
const { ROLES_CALIDAD, ROL_LABEL, ROL_DESCRIPCION } = require('../domain/roles/calidadGates');

/** GET /api/calidad/roles/catalogo */
exports.getCatalogo = async (req, res) => {
    const items = Object.values(ROLES_CALIDAD).map((value) => ({
        value,
        label: ROL_LABEL[value],
        descripcion: ROL_DESCRIPCION[value],
    }));
    res.json(items);
};

/** GET /api/calidad/roles/usuarios */
exports.listarCandidatos = async (req, res) => {
    try {
        const candidatos = await rolCalidadService.listarCandidatos(req.db);
        res.json(candidatos);
    } catch (err) {
        console.error('Error in listarCandidatos:', err);
        res.status(500).json({ error: err.message || 'Error listando candidatos' });
    }
};

/** PUT /api/calidad/roles/usuarios/:id */
exports.asignarRol = async (req, res) => {
    try {
        const { rol } = req.body;
        const updated = await rolCalidadService.asignarRol(req.db, req.params.id, rol);
        res.json(updated);
    } catch (err) {
        console.error('Error in asignarRol:', err);
        res.status(400).json({ error: err.message || 'Error asignando rol' });
    }
};
