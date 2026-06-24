'use strict';

const express = require("express");
const router  = express.Router();

const probetaController = require("../controllers/probetaController");
const { verifyJwt }     = require("../middlewares/verifyToken");
const { requireRole, requireAccionCalidad } = require("../middlewares/permissions");
const { ROLES }         = require("../domain/roles");
const { ACCIONES }      = require("../domain/roles/calidadGates");

// ============================================================================
// RBAC — Bloque 1 auditoría 08 (probetas/ensayos/muestras).
//
// Espejo backend de la matriz `useCanPerform` del frontend
// (hormiqual-frontend/src/lib/roles/useCanPerform.js). Mantener sincronizado.
//
// Filosofía:
//   - Lectura: cualquier rol interno autenticado.
//   - Carga (probeta, ensayo, PDF): roles operativos (incluye OPERADOR).
//   - Revisión y aprobación (jerárquica): RESPONSABLE_CALIDAD + ADMIN.
//     DIRECTOR_TECNICO no aprueba transiciones de QA (igual que dosificación).
//   - Eliminación física de probeta: solo ADMIN (coherente con dosif.eliminar).
// ============================================================================
const ROLES_INTERNOS   = [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];
const ROLES_OPERATIVOS = [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];
const ROLES_APROBACION = [ROLES.RESPONSABLE, ROLES.ADMIN];

/* ───────── Ensayos: alta y edición (operativa) ───────── */
router.post("/ensayo", verifyJwt, requireRole(...ROLES_OPERATIVOS), probetaController.createEnsayo);
router.put ("/ensayo/:id", verifyJwt, requireRole(...ROLES_OPERATIVOS), probetaController.updateEnsayo);

/* ───────── Revisión de ensayos (Sprint 2 — gates jerárquicos) ─────────
 *
 * El listado y el detalle siguen usando requireRole — son lecturas y el
 * gate fino se hace en el service (filtros por planta del usuario).
 *
 * Las mutaciones (aprobar / desaprobar / aprobar masivo) pasan a usar
 * `requireAccionCalidad(ACCIONES.*)` que delega en el engine puro
 * `domain/roles/calidadGates.js`. Los safeguards específicos por contenido
 * (e.g. "no aprobar rojos en masivo sin DT") se aplican en el service,
 * porque dependen del payload, no del rol.
 *
 * APROBAR_ENSAYO_MASIVO_CON_DESVIOS y DESAPROBAR_ENSAYO se gobiernan
 * desde el service según el contenido del request (el RC puede entrar al
 * endpoint pero el service decide si la operación específica está
 * autorizada).
 */
router.get("/ensayos-pendientes-revision",       verifyJwt, requireRole(...ROLES_APROBACION), probetaController.getEnsayosPendientesRevision);
router.get("/ensayos-pendientes-revision/count", verifyJwt, requireRole(...ROLES_APROBACION), probetaController.getCountEnsayosPendientes);
router.get("/ensayo-revision/:id",                verifyJwt, requireRole(...ROLES_APROBACION), probetaController.getEnsayoRevisionDetalle);
router.put("/ensayo/:id/aprobar",                 verifyJwt, requireAccionCalidad(ACCIONES.APROBAR_ENSAYO),         probetaController.aprobarEnsayo);
router.put("/ensayos/aprobar-masivo",             verifyJwt, requireAccionCalidad(ACCIONES.APROBAR_ENSAYO_MASIVO),  probetaController.aprobarEnsayosMasivo);
// Mej-17 auditoría 08: desaprobar ensayo con motivo (revertir firma).
// El gate de "RC firmante original puede desaprobarse a sí mismo" lo
// aplica el service vía puedeDesaprobarEnsayo (depende del idAprobadoPor
// del registro, no se puede chequear acá en el middleware).
router.post("/ensayo/:id/desaprobar",             verifyJwt, requireRole(...ROLES_APROBACION), probetaController.desaprobarEnsayo);

/* ───────── Etiquetas QR (N-01 sesión 2026-05-09 + 2026-05-28) ───────── */
router.get( "/etiquetas-pendientes",   verifyJwt, requireRole(...ROLES_INTERNOS),   probetaController.getEtiquetasPendientes);
router.post("/etiquetas-impresas",     verifyJwt, requireRole(...ROLES_OPERATIVOS), probetaController.marcarEtiquetasImpresas);
// 2026-05-28: trae probetas activas de un set de muestras (multi-select desde
// la pantalla de Muestras). POST porque el body lleva un array de ids.
router.post("/etiquetas-por-muestras", verifyJwt, requireRole(...ROLES_INTERNOS),   probetaController.getEtiquetasPorMuestras);

/* ───────── Reportes y consultas (lectura) ───────── */
router.get( "/proximas-a-romper",  verifyJwt, requireRole(...ROLES_INTERNOS), probetaController.getProximasARomper); // N-05 auditoría 08
router.post("/aceptacion-lote",    verifyJwt, requireRole(...ROLES_INTERNOS), probetaController.getAceptacionLote);   // N-03 auditoría 08 (JSON)
router.post("/aceptacion-lote/pdf", verifyJwt, requireRole(...ROLES_INTERNOS), probetaController.getAceptacionLotePdf); // N-03: render PDF (Puppeteer)
router.get( "/estados",            verifyJwt, requireRole(...ROLES_INTERNOS), probetaController.getEstadosProbeta); // [VITRINA] reemplaza /api/despachos/estadoprobeta
router.get( "/resistencias",       verifyJwt, requireRole(...ROLES_INTERNOS), probetaController.getResistencias);
router.get( "/filtradas",          verifyJwt, requireRole(...ROLES_INTERNOS), probetaController.getProbetasFiltradas);
router.get( "/terceros",           verifyJwt, requireRole(...ROLES_INTERNOS), probetaController.getProbetasTerceros);
router.post("/pdf",                verifyJwt, requireRole(...ROLES_OPERATIVOS), probetaController.generatePDF);
router.get( "/:id/temperatura",    verifyJwt, requireRole(...ROLES_INTERNOS), probetaController.getProbetaTemperatura);

/* ───────── CRUD probeta ───────── */
router.get(   "/:id", verifyJwt, requireRole(...ROLES_INTERNOS),   probetaController.getProbeta);
router.get(   "/",    verifyJwt, requireRole(...ROLES_INTERNOS),   probetaController.getProbetas);
router.post(  "/",    verifyJwt, requireRole(...ROLES_OPERATIVOS), probetaController.createProbeta);
router.put(   "/:id", verifyJwt, requireRole(...ROLES_OPERATIVOS), probetaController.updateProbeta);
// Mej-16 auditoría 08: anular probeta con motivo (estado DESCARTADA + trazabilidad).
// Permite al RESPONSABLE/ADMIN — distinta de DELETE (sólo ADMIN, físico).
router.post(  "/:id/anular", verifyJwt, requireRole(...ROLES_APROBACION), probetaController.anularProbeta);
router.delete("/:id", verifyJwt, requireRole(ROLES.ADMIN),         probetaController.deleteProbeta);

module.exports = router;
