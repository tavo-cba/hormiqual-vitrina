'use strict';

/**
 * veredicto.js — Árbol de veredictos del Prompt 2.
 *
 * Agrega los `compliance` per-item de un material (ensayos individuales,
 * verificaciones de aptitud, suma de sustancias, etc.) en un veredicto
 * GLOBAL del material que el frontend renderiza como categoría visual.
 *
 * ─── Las 5 categorías ────────────────────────────────────────────────
 *
 * Mapeo categoría visual ↔ ComplianceResult canónico (10 estados):
 *
 *   APTO                       → pass
 *   APTO CON OBSERVACIONES     → passWithObservations
 *   APTITUD CONDICIONADA       → conditionalPass (con conditions[] agregadas)
 *   NO APTO                    → fail (severity bloqueante o no_bloqueante
 *                                  según items)
 *   EVALUACIÓN INCOMPLETA      → pending (con reason describiendo qué falta)
 *
 * Decisión arquitectónica: el veredicto global es un ComplianceResult
 * canónico. Esto permite que el frontend lo renderice con el mismo
 * `labels.js` que ya usa para los compliance per-item, sin código
 * específico para "categoría visual del veredicto".
 *
 * ─── Regla de precedencia ────────────────────────────────────────────
 *
 *   NO APTO  >  EVALUACIÓN INCOMPLETA  >  APTITUD CONDICIONADA
 *           >  APTO CON OBSERVACIONES  >  APTO
 *
 * "Mayor precedencia gana": si CUALQUIER item es fail, todo el material
 * es NO APTO (independiente del resto). Si no hay fail pero falta data
 * (pending / notEvaluated en items exigibles), es EVALUACIÓN INCOMPLETA.
 * Y así sucesivamente. La regla refleja que un solo defecto crítico
 * descalifica al material para certificación.
 *
 * Estados que NO contribuyen al veredicto:
 *   - informative: invisible (sin criterio de cumplimiento)
 *   - notApplicable: invisible (no exigible por contexto)
 *   - notEvaluated: cuenta como pending si el item es exigible (caller
 *     decide al construir items[]).
 *   - inconclusive: cuenta como pending si el item es exigible (idem).
 *
 * ─── Pureza ──────────────────────────────────────────────────────────
 *
 * `calcularVeredictoGlobal` es una función PURA: no escribe a DB, no
 * dispara alertas. Las alertas viven a NIVEL ITEM, no a nivel veredicto
 * global (un veredicto NO_APTO es CONSECUENCIA de los fails individuales
 * que ya emitieron sus alertas).
 */

const {
  Compliance,
  STATUS,
  SEVERITY,
  isPass,
  isPassWithObservations,
  isConditionalPass,
  isFail,
  isInconclusive,
  isPending,
  isNotEvaluated,
  isInformative,
  isNotApplicable,
  isExpired,
} = require('./ComplianceResult');

/**
 * Calcula el veredicto global del material a partir de sus items.
 *
 * @param {Array<{compliance: ComplianceResult, key?: string, parametro?: string}>} items
 *   Cada item DEBE tener `compliance` (ComplianceResult canónico). Items
 *   sin compliance se ignoran.
 * @param {Object} [usageContext] - reservado para reglas contextuales
 *   futuras. Hoy NO se usa: el veredicto se computa estrictamente desde
 *   los compliance per-item.
 * @param {Object} [materialContext] - idem.
 * @returns {ComplianceResult} Veredicto global del material.
 */
function calcularVeredictoGlobal(items, usageContext = {}, materialContext = {}) {
  if (!Array.isArray(items)) {
    return Compliance.notEvaluated({
      reason: 'Sin items para evaluar veredicto global',
    });
  }

  // Normalizar: filtrar items sin compliance, descartar invisibles.
  const visible = items
    .filter(it => it && it.compliance && it.compliance.status)
    .filter(it => !isInformative(it.compliance) && !isNotApplicable(it.compliance));

  if (visible.length === 0) {
    return Compliance.notEvaluated({
      reason: 'Ningún item visible para evaluar veredicto global',
    });
  }

  // Agrupar por categoría de precedencia.
  const fails    = visible.filter(it => isFail(it.compliance));
  const expired  = visible.filter(it => isExpired(it.compliance));
  // Pending: explícitos + inconclusive + notEvaluated (cuando el caller
  // los marcó como exigibles vía items con compliance pending/inconclusive).
  const pendings = visible.filter(it =>
    isPending(it.compliance) || isInconclusive(it.compliance) || isNotEvaluated(it.compliance)
  );
  const conds    = visible.filter(it => isConditionalPass(it.compliance));
  const obsItems = visible.filter(it => isPassWithObservations(it.compliance));
  const passes   = visible.filter(it => isPass(it.compliance));

  /* ─── 1. NO APTO (precedencia máxima) ─── */
  if (fails.length > 0) {
    const reasons = fails.flatMap(it =>
      Array.isArray(it.compliance.reasons) && it.compliance.reasons.length > 0
        ? it.compliance.reasons.map(r => `${it.parametro || it.key || it.compliance.norm || 'item'}: ${r}`)
        : [`${it.parametro || it.key || 'item'}: no cumple`]
    );
    const anyBloqueante = fails.some(it => it.compliance.severity === SEVERITY.BLOQUEANTE);
    return Compliance.fail({
      reasons,
      severity: anyBloqueante ? SEVERITY.BLOQUEANTE : SEVERITY.NO_BLOQUEANTE,
    });
  }

  /* ─── 2. EVALUACIÓN INCOMPLETA (vencidos + pendientes + inconclusivos) ─── */
  if (expired.length > 0 || pendings.length > 0) {
    const faltantes = [];
    expired.forEach(it => {
      faltantes.push(`${it.parametro || it.key || 'item'}: vencido`);
    });
    pendings.forEach(it => {
      const r = it.compliance.reason || 'sin datos';
      faltantes.push(`${it.parametro || it.key || 'item'}: ${r}`);
    });
    return Compliance.pending({
      reason:
        `Evaluación incompleta. ${faltantes.length} item(s) requieren ` +
        `atención antes de concluir aptitud: ${faltantes.slice(0, 5).join('; ')}` +
        `${faltantes.length > 5 ? '...' : ''}`,
    });
  }

  /* ─── 3. APTITUD CONDICIONADA ─── */
  if (conds.length > 0) {
    const allConditions = conds.flatMap(it =>
      Array.isArray(it.compliance.conditions) ? it.compliance.conditions : []
    );
    return Compliance.conditionalPass({
      conditions: allConditions,
      message: `Material apto sujeto a ${allConditions.length} condición(es) de aplicabilidad.`,
    });
  }

  /* ─── 4. APTO CON OBSERVACIONES ─── */
  if (obsItems.length > 0) {
    const observations = obsItems
      .map(it => it.compliance.observation)
      .filter(o => typeof o === 'string' && o.length > 0);
    return Compliance.passWithObservations({
      observation: observations.length > 0
        ? observations.join('. ')
        : 'Cumple con observaciones técnicas.',
    });
  }

  /* ─── 5. APTO ─── */
  return Compliance.pass({
    message: `Material apto. ${passes.length} item(s) verificado(s).`,
  });
}

/**
 * Mapeo del status canónico → categoría visual del veredicto.
 * Útil para frontends que quieran renderizar el chip "APTO / NO APTO / etc."
 * sin recomputar.
 *
 * Nota PR2: 'APTITUD NO DETERMINADA' es una variante visual de
 * `notEvaluated` cuando el veredicto trae el flag `_aptitudNoDeterminada=true`
 * (puesto por aplicarPoliticaAItemsCompliance vía getResumen). Indica que
 * el sistema no afirma "cumple" ni bloquea — la política del catálogo no
 * requiere evaluar parámetros para este contexto. Se distingue de
 * 'EVALUACIÓN INCOMPLETA' (que indica que SÍ hay parámetros exigibles
 * pendientes / vencidos / inconclusos).
 */
const VEREDICTO_LABELS = Object.freeze({
  [STATUS.PASS]:                   'APTO',
  [STATUS.PASS_WITH_OBSERVATIONS]: 'APTO CON OBSERVACIONES',
  [STATUS.CONDITIONAL_PASS]:       'APTITUD CONDICIONADA',
  [STATUS.FAIL]:                   'NO APTO',
  [STATUS.PENDING]:                'EVALUACIÓN INCOMPLETA',
  [STATUS.INCONCLUSIVE]:           'EVALUACIÓN INCOMPLETA',
  [STATUS.NOT_EVALUATED]:          'EVALUACIÓN INCOMPLETA',
  [STATUS.EXPIRED]:                'EVALUACIÓN INCOMPLETA',
  [STATUS.INFORMATIVE]:            'INFORMATIVO',
  [STATUS.NOT_APPLICABLE]:         'NO APLICA',
});

const VEREDICTO_APTITUD_NO_DETERMINADA = 'APTITUD NO DETERMINADA';

/**
 * @param {ComplianceResult} veredictoGlobal
 * @returns {string} Una de las categorías visuales.
 */
function getCategoriaVeredicto(veredictoGlobal) {
  if (!veredictoGlobal?.status) return 'EVALUACIÓN INCOMPLETA';
  // PR2: detectar el flag custom `_aptitudNoDeterminada` antes del mapeo
  // genérico para distinguir de un notEvaluated regular.
  if (veredictoGlobal._aptitudNoDeterminada === true) return VEREDICTO_APTITUD_NO_DETERMINADA;
  return VEREDICTO_LABELS[veredictoGlobal.status] || 'EVALUACIÓN INCOMPLETA';
}

module.exports = {
  calcularVeredictoGlobal,
  getCategoriaVeredicto,
  VEREDICTO_LABELS,
  VEREDICTO_APTITUD_NO_DETERMINADA,
};
