'use strict';

/**
 * Rutas /api/override-requests (Bloque K.3).
 *
 * Política de roles:
 *  - Listar/obtener: cualquier usuario autenticado.
 *  - Crear (solicitar): Operador, Responsable o Director Técnico.
 *  - Aprobar/Rechazar: chequeo dinámico por ámbito, hecho en el controller
 *    (OBRA → Director Técnico; AUTOCONTROL_PLANTA → Responsable o DT).
 *  - Revocar un override APROBADO: Responsable o Director Técnico.
 */

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/overrideRequestController');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireRole } = require('../middlewares/permissions');
const { ROLES } = require('../domain/roles');

const ROLES_SOLICITANTE = [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];
const ROLES_REVOCADOR   = [ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];

router.get('/',                 verifyJwt,                                    ctrl.listar);
router.get('/:id',              verifyJwt,                                    ctrl.obtener);
router.post('/',                verifyJwt, requireRole(...ROLES_SOLICITANTE), ctrl.crear);
router.post('/:id/approve',     verifyJwt,                                    ctrl.aprobar);
router.post('/:id/reject',      verifyJwt,                                    ctrl.rechazar);
router.post('/:id/revoke',      verifyJwt, requireRole(...ROLES_REVOCADOR),   ctrl.revocar);

module.exports = router;
