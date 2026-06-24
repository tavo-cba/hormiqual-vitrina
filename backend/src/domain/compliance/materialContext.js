'use strict';

/**
 * MaterialContext — propiedades de los materiales que el motor necesita
 * para reglas cruzadas con UsageContext.
 *
 * Diseño:
 *   - NO es el modelo Sequelize entero. Solo lo que el motor consume.
 *   - Inmutable.
 *   - Acceso a BD: el constructor lazy `materialContextFromDb` vive en
 *     `services/materialContextService.js` (auditoría 01-calidad Fase C R3,
 *     sesión 2026-05-07). Este módulo de domain solo expone funciones puras.
 *
 * Los datos modelados que NO van en UsageContext pero el motor sí necesita
 * (porque vienen del material, no del uso):
 *   - agregado.evaluacionRas (de AgregadoMeta) — para reglas de RAS según
 *     exposureClass del UsageContext.
 *   - agregado.tipoRoca (de AgregadoMeta) — para activar el evaluador de
 *     estabilidad basálticas cuando es BASALTICA.
 *   - cemento.composicion (de Cemento) — para reglas que dependen del tipo
 *     de cemento (ej: cementos de bajo álcali en mitigación RAS).
 */

const EVALUACIONES_RAS = Object.freeze([
  'NO_EVALUADO',
  'NO_REACTIVO',
  'POTENCIALMENTE_REACTIVO',
]);

const TIPOS_ROCA = Object.freeze([
  'GRANITICA', 'BASALTICA', 'CALCAREA', 'CUARCITICA', 'OTRA',
]);

const TIPOS_AGREGADO = Object.freeze(['FINO', 'GRUESO']);

/* ───────── Constructor explícito ───────── */

/**
 * @param {Object} [input]
 * @param {Object|null} [input.agregado]
 * @param {number} [input.agregado.id]
 * @param {string|null} [input.agregado.nombre]
 * @param {'FINO'|'GRUESO'|null} [input.agregado.tipo]
 * @param {string|null} [input.agregado.subtipo]
 * @param {string|null} [input.agregado.tipoRoca]
 * @param {string} [input.agregado.evaluacionRas='NO_EVALUADO']
 * @param {Object|null} [input.cemento]
 * @returns {Readonly<MaterialContext>}
 */
function createMaterialContext(input = {}) {
  const agregado = input.agregado ? Object.freeze({
    id:            input.agregado.id ?? input.agregado.idAgregado ?? null,
    nombre:        input.agregado.nombre ?? null,
    tipo:          _validateTipoAgregado(input.agregado.tipo),
    subtipo:       input.agregado.subtipo ?? input.agregado.subtipoMaterial ?? null,
    tipoRoca:      _validateTipoRoca(input.agregado.tipoRoca),
    evaluacionRas: _validateRas(input.agregado.evaluacionRas) || 'NO_EVALUADO',
  }) : null;

  const cemento = input.cemento ? Object.freeze({
    id:              input.cemento.id ?? input.cemento.idCemento ?? null,
    composicion:     input.cemento.composicion ?? null,
    claseResistente: input.cemento.claseResistente ?? null,
    familia:         input.cemento.familiaCemento ?? input.cemento.familia ?? null,
  }) : null;

  return Object.freeze({ agregado, cemento });
}

/* ───────── Helpers semánticos ───────── */

const isPotentiallyReactive = (matCtx) =>
  matCtx?.agregado?.evaluacionRas === 'POTENCIALMENTE_REACTIVO';

const isRasUnknown = (matCtx) =>
  !matCtx?.agregado || matCtx.agregado.evaluacionRas === 'NO_EVALUADO';

const isBasaltico = (matCtx) =>
  matCtx?.agregado?.tipoRoca === 'BASALTICA';

const isFino = (matCtx) =>
  matCtx?.agregado?.tipo === 'FINO';

const isGrueso = (matCtx) =>
  matCtx?.agregado?.tipo === 'GRUESO';

/* ───────── Validators privados ───────── */

function _validateTipoAgregado(v) {
  if (v == null) return null;
  const upper = String(v).toUpperCase();
  if (upper === 'FINO' || upper === 'GRUESO') return upper;
  // Aceptar 'Fino' / 'Grueso' del legacy
  return null;
}

function _validateTipoRoca(v) {
  if (v == null) return null;
  if (TIPOS_ROCA.includes(v)) return v;
  return null; // valor desconocido → null silencioso (no rompe builders)
}

function _validateRas(v) {
  if (v == null) return null;
  if (EVALUACIONES_RAS.includes(v)) return v;
  return 'NO_EVALUADO';
}

module.exports = {
  // Catálogos
  EVALUACIONES_RAS,
  TIPOS_ROCA,
  TIPOS_AGREGADO,
  // Constructor puro (sin DB)
  createMaterialContext,
  // Helpers
  isPotentiallyReactive,
  isRasUnknown,
  isBasaltico,
  isFino,
  isGrueso,
};
