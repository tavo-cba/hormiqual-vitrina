const axios = require('axios');
const obraService = require('../services/obraService');
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// const obraCosteoService = require('../services/obraCosteoService');
const { getPortalTenant } = require('../config/portalTenantMap');

const PORTAL_URL = process.env.PORTAL_URL || 'http://localhost:4011';

/**
 * Elimina del Portal los usuarios creados para una obra (para liberar esos
 * emails y reutilizarlos). Filtra explícitamente por idObra del lado del
 * backend principal por seguridad: si el Portal aún corre código viejo y
 * devuelve todos los usuarios, el filtro evita borrados masivos accidentales.
 */
const eliminarUsuariosPortalDeObra = async (req, idObra) => {
    try {
        const headers = { 'x-portal-tenant': getPortalTenant(req.headers['x-tenant'] || '') };
        const { data } = await axios.get(`${PORTAL_URL}/api/auth/admin/usuarios`, { params: { idObra }, headers });
        const usuarios = (Array.isArray(data) ? data : []).filter(
            (u) => Number(u.idObra) === Number(idObra)
        );
        await Promise.allSettled(
            usuarios.map((u) => axios.delete(`${PORTAL_URL}/api/auth/admin/usuarios/${u.id}`, { headers }))
        );
    } catch (err) {
        console.error('No se pudieron eliminar los usuarios del portal de la obra:', err.message);
    }
};

const getObras = async (req, res) => {
    try {
        const obras = await obraService.getObras(req.db);
        res.status(200).json(obras);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener obras' });
    }
};

const getObra = async (req, res) => {
    try {
        const idObra = req.params.id;
        const obra = await obraService.getObra(req.db, idObra);
        res.status(200).json(obra);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener la obra' });
    }
};

const getObrasPropias = async (req, res) => {
    try {
        const obras = await obraService.getObrasPropias(req.db);
        res.status(200).json(obras);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener obras propias' });
    }
};

// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// (resumen de costeo de obra — obraCosteoService)
const getResumenObra = async (req, res) =>
    res.status(501).json({ error: 'Función no disponible en la versión vitrina (módulo Calidad).' });

const createObra = async (req, res) => {
    try {
        const newObra = await obraService.createObra(req.db, req.body);
        res.status(201).json(newObra);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear la obra' });
    }
};

const updateObra = async (req, res) => {
    try {
        const idObra = req.params.id;
        const updatedObra = await obraService.updateObra(req.db, idObra, req.body);
        res.status(200).json(updatedObra);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar la obra' });
    }
};

const deleteObra = async (req, res) => {
    try {
        const idObra = req.params.id;
        await obraService.deleteObra(req.db, idObra);
        // Eliminar las cuentas del Portal de Obra de esta obra (libera los emails)
        await eliminarUsuariosPortalDeObra(req, idObra);
        res.status(200).json({ message: 'Obra eliminada correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar la obra' });
    }
};

module.exports = {
    getObras,
    getObra,
    getObrasPropias,
    getResumenObra,
    createObra,
    updateObra,
    deleteObra
};
