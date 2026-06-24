'use strict';

/**
 * Rutas /api/technical-evidence (Bloque K.1 MVP)
 *
 * Política de roles (Fase 1 RBAC):
 *  - Listar/obtener: cualquier usuario autenticado.
 *  - Crear/editar/borrar: RESPONSABLE_CALIDAD, DIRECTOR_TECNICO o ADMIN.
 *    (Operador no puede declarar evidencias técnicas; solo verlas.)
 */

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/technicalEvidenceController');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireRole } = require('../middlewares/permissions');
const { ROLES } = require('../domain/roles');

const ROLES_GESTION = [ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];

router.get('/',           verifyJwt,                              ctrl.listar);
router.get('/:id',        verifyJwt,                              ctrl.obtener);
router.post('/',          verifyJwt, requireRole(...ROLES_GESTION), ctrl.crear);
router.put('/:id',        verifyJwt, requireRole(...ROLES_GESTION), ctrl.actualizar);
router.patch('/:id',      verifyJwt, requireRole(...ROLES_GESTION), ctrl.actualizar);
router.delete('/:id',     verifyJwt, requireRole(...ROLES_GESTION), ctrl.eliminar);

module.exports = router;
