'use strict';

/**
 * Punto de entrada del módulo compliance.
 *
 * Uso típico:
 *   const { evaluarEnsayoCompliance, isAcceptable, getLongLabel } = require('./domain/compliance');
 *
 *   const result = evaluarEnsayoCompliance(codigo, resultado, ctx);
 *   matchExt(result, { pass: ..., fail: ..., conditionalPass: ..., ... 10 handlers });
 */

const cr = require('./ComplianceResult');
const labels = require('./labels');
const adapters = require('./adapters');
const usageContext = require('./usageContext');
const materialContext = require('./materialContext');
const required = require('./required');
const blocking = require('./blocking');
const buildComplianceModule = require('./buildCompliance');
const mezclaCompliance = require('./mezclaCompliance');
const veredicto = require('./veredicto');
const granulometriaMezcla = require('./granulometriaMezcla');
const { evaluarEnsayo } = require('../ensayoEvalEngine');

/**
 * Wrapper sobre el evaluador legacy que SIEMPRE devuelve un ComplianceResult.
 *
 * Este es el entry point recomendado para nuevo código. Los call sites viejos
 * que usan `evaluarEnsayo()` siguen funcionando (no rompimos su API), pero
 * deberían migrar a este wrapper para obtener:
 *   - Default seguro: NotEvaluated cuando falta data o evaluador
 *   - Manejo exhaustivo via match()
 *   - Soporte de ConditionalPass para condiciones del estilo "solo H ≤ 20"
 *
 * @param {string} codigo - código del tipo de ensayo
 * @param {Object|null} resultado - JSON del resultado o null
 * @param {Object} [ctx] - contexto del agregado/dosificación
 * @returns {ComplianceResult}
 */
function evaluarEnsayoCompliance(codigo, resultado, ctx = {}) {
  if (!codigo) {
    return cr.Compliance.notEvaluated({ reason: 'Código de ensayo no especificado' });
  }
  if (resultado == null) {
    return cr.Compliance.notEvaluated({ reason: 'Sin datos de resultado' });
  }
  try {
    const legacy = evaluarEnsayo(codigo, resultado, ctx);
    return cr.fromLegacyEval(legacy);
  } catch (err) {
    return cr.Compliance.notEvaluated({
      reason: `Error en evaluador: ${err.message}`,
    });
  }
}

module.exports = {
  ...cr,
  evaluarEnsayoCompliance,
  // Labels — fuente única de verdad para presentación (Commit 3)
  LABELS:        labels.LABELS,
  getLongLabel:  labels.getLongLabel,
  getShortLabel: labels.getShortLabel,
  getSeverity:   labels.getSeverity,
  getIcon:       labels.getIcon,
  getColor:      labels.getColor,
  getLabels:     labels.getLabels,
  // Adapters — vocabularios legacy ↔ canónico (Commit 4)
  ...adapters,
  // Contextos — UsageContext + MaterialContext (Prompt 2, C1)
  ...usageContext,
  ...materialContext,
  // Exigibilidad — tabla declarativa por ensayo (Prompt 2, C2)
  ...required,
  // Bloqueo context-aware — hermano de isBlocking legacy (Prompt 2, C3)
  ...blocking,
  // Builder unificado (Prompt 2, C4.1)
  ...buildComplianceModule,
  // Mezclas — wrapper P1.4
  fromLegacyMezclaEval: mezclaCompliance.fromLegacyMezclaEval,
  validateConditionsAgainstContext: mezclaCompliance.validateConditionsAgainstContext,
  checkCondition: mezclaCompliance.checkCondition,
  // Veredicto global del material (Prompt 2 C10.4)
  calcularVeredictoGlobal: veredicto.calcularVeredictoGlobal,
  getCategoriaVeredicto:   veredicto.getCategoriaVeredicto,
  VEREDICTO_LABELS:        veredicto.VEREDICTO_LABELS,
  VEREDICTO_APTITUD_NO_DETERMINADA: veredicto.VEREDICTO_APTITUD_NO_DETERMINADA,
  // Verificación granulométrica Nivel 2 (Prompt 2 C10.3)
  evaluarGranulometriaMezcla: granulometriaMezcla.evaluarGranulometriaMezcla,
};
