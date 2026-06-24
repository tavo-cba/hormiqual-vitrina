'use strict';

/**
 * Rutas /api/document-approvals (Fase 2 RBAC).
 *
 * Política de roles:
 *  - Listar/obtener: cualquier usuario autenticado.
 *  - Crear (solicitar firma): Operador, Responsable o Director Técnico.
 *  - Aprobar: solo Director Técnico (o Admin) — chequeo dinámico en controller.
 *  - Rechazar: Responsable, Director Técnico o Admin.
 *  - Registrar emisión: cualquier usuario autenticado (solo traza).
 */

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/documentApprovalRequestController');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireRole } = require('../middlewares/permissions');
const { ROLES } = require('../domain/roles');

const ROLES_SOLICITANTE = [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];

router.get('/',                   verifyJwt,                                    ctrl.listar);
router.get('/:id',                verifyJwt,                                    ctrl.obtener);
router.post('/',                  verifyJwt, requireRole(...ROLES_SOLICITANTE), ctrl.crear);
router.post('/:id/approve',       verifyJwt,                                    ctrl.aprobar);
router.post('/:id/reject',        verifyJwt,                                    ctrl.rechazar);
router.post('/:id/pdf-issued',    verifyJwt,                                    ctrl.registrarEmisionPdf);

module.exports = router;
