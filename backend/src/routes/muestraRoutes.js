'use strict';
// src/routes/muestraRoutes.js
const express = require("express");
const router = express.Router();
const muestraController = require("../controllers/muestraController");
const { verifyJwt } = require("../middlewares/verifyToken");
const { requireRole } = require("../middlewares/permissions");
const { ROLES } = require("../domain/roles");
const { cacheResponse } = require("../cache");

// ============================================================================
// RBAC — Bloque 1 auditoría 08 (probetas/ensayos/muestras).
// Ver routes/probetaRoutes.js para la filosofía completa. Mantener sincronizado
// con hormiqual-frontend/src/lib/roles/useCanPerform.js.
// ============================================================================
const ROLES_INTERNOS   = [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];
const ROLES_OPERATIVOS = [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];
const ROLES_APROBACION = [ROLES.RESPONSABLE, ROLES.ADMIN];

/* Catalogos (cacheados 1 hora) — lectura para todo rol interno autenticado */
router.get("/tipoprobeta",   verifyJwt, requireRole(...ROLES_INTERNOS), cacheResponse('catalogos', 3600), muestraController.getTipoProbeta);
router.get("/tipohormigon",  verifyJwt, requireRole(...ROLES_INTERNOS), cacheResponse('catalogos', 3600), muestraController.getTipoHormigon);
router.get("/modalidades",   verifyJwt, requireRole(...ROLES_INTERNOS), cacheResponse('catalogos', 3600), muestraController.getModalidades);

/* CRUD muestra */
router.get(   "/",              verifyJwt, requireRole(...ROLES_INTERNOS),   muestraController.getMuestras);
// N-06 auditoría 08: ficha consolidada de la muestra (payload para PDF).
// Definida ANTES de "/:id" para que el matcher de Express priorice esta ruta.
router.get(   "/:id/ficha",     verifyJwt, requireRole(...ROLES_INTERNOS),   muestraController.getFichaMuestra);
router.get(   "/:id",           verifyJwt, requireRole(...ROLES_INTERNOS),   muestraController.getMuestra);
router.post(  "/",              verifyJwt, requireRole(...ROLES_OPERATIVOS), muestraController.createMuestra);
router.put(   "/:id",           verifyJwt, requireRole(...ROLES_OPERATIVOS), muestraController.updateMuestra);
// Confirmación: asigna número de lote y "publica" la muestra (transición operativa, sin doble check humano)
router.put(   "/confirmar/:id", verifyJwt, requireRole(...ROLES_OPERATIVOS), muestraController.confirmarMuestra);
// Eliminación: pierde evidencia normativa, solo Responsable/Admin
router.delete("/:id",           verifyJwt, requireRole(...ROLES_APROBACION), muestraController.deleteMuestra);

module.exports = router;
