'use strict';

/**
 * materialLivianoRoutes — Sesión 2026-05-29 (Hormigón Alivianado).
 *
 * Catálogo de materiales livianos (telgopor / EPS / perlita / arcilla
 * expandida). Endpoint pegado a `/api/materiales-livianos`. Backend del
 * formulario "Calidad → Catálogos → Materiales livianos" del frontend.
 *
 * Listar/obtener: cualquier usuario autenticado.
 * Crear/actualizar/archivar: requireRole(...ROLES_CATALOGO).
 */

const express = require('express');
const router = express.Router();
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireRole } = require('../middlewares/permissions');
const { ROLES } = require('../domain/roles');
const svc = require('../services/materialLivianoService');

const ROLES_CATALOGO = [ROLES.RESPONSABLE_CALIDAD, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];

router.get('/', verifyJwt, async (req, res) => {
    try {
        const incluyeArchivados = String(req.query.includeArchived || '').toLowerCase() === 'true';
        const lista = await svc.listar(req.db, { includeArchived: incluyeArchivados });
        res.json({ materiales: lista });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

router.get('/:id', verifyJwt, async (req, res) => {
    try {
        const mat = await svc.obtener(req.db, req.params.id);
        if (!mat) return res.status(404).json({ error: 'Material liviano no encontrado.' });
        res.json(mat);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

router.post('/', verifyJwt, requireRole(...ROLES_CATALOGO), async (req, res) => {
    try {
        const creado = await svc.crear(req.db, req.body || {});
        res.status(201).json(creado);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

router.put('/:id', verifyJwt, requireRole(...ROLES_CATALOGO), async (req, res) => {
    try {
        const actualizado = await svc.actualizar(req.db, req.params.id, req.body || {});
        if (!actualizado) return res.status(404).json({ error: 'Material liviano no encontrado.' });
        res.json(actualizado);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

router.delete('/:id', verifyJwt, requireRole(...ROLES_CATALOGO), async (req, res) => {
    try {
        const archivado = await svc.archivar(req.db, req.params.id);
        if (!archivado) return res.status(404).json({ error: 'Material liviano no encontrado.' });
        res.json(archivado);
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
});

module.exports = router;
