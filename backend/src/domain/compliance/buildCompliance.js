'use strict';

/**
 * buildCompliance.js — Helper unificado para construir ComplianceResult
 * desde un evaluador del motor (`ensayoEvalEngine.js`) o el motor de
 * aptitud (`aptitudMaterialesService.js`).
 *
 * Encapsula:
 *   - Cálculo automático de `severity` consultando `isBlockingInContext`
 *     cuando el resultado es `fail`.
 *   - Forma normalizada del `limit` ({ value, comparator } o { min, max }
 *     o { strict, standard }).
 *   - Validación de campos requeridos por tipo de resultado.
 *   - Convención uniforme para `conditions[]` con campo `kind` discriminante.
 *
 * Convención de `kind` para conditions[] (cierra la sugerencia de C1
 * sobre la generalización de conditions[] que aterriza completamente en C7):
 *   'exclude_destination'      — el material no es apto para destinos específicos
 *                                  (ej: surface_wear, pretensed). value: string|string[].
 *   'requires_documentation'   — requiere documentación específica para validar
 *                                  (ej: experiencia >25 años). value: string descriptiva.
 *   'requires_mitigation'      — requiere medidas correctivas/preventivas
 *                                  (ej: cemento bajo álcali para mitigación RAS).
 *                                  value: string descriptiva.
 *   'custom'                   — condición arbitraria que no encaja arriba.
 *                                  value libre.
 *
 * Forma esperada de cada condition:
 *   { kind, key, value?, description, source? }
 *
 *   - kind:        ver arriba (REQUERIDO en código nuevo; opcional para back-compat
 *                  con Prompt 1 que no lo usaba).
 *   - key:         identificador legible (ej: 'exclude_destination', 'experience_25y').
 *   - value:       payload concreto que el motor downstream consume.
 *   - description: texto humano para mostrar en UI/PDF.
 *   - source:      referencia normativa (ej: 'CIRSOC 200 §3.2.3.3 Tabla 3.4').
 *
 * Resultado que recibe `buildCompliance`:
 *   resultado: uno de {
 *     'pass', 'pass_with_observations', 'conditional_pass', 'fail',
 *     'inconclusive', 'informative', 'not_evaluated'
 *   }
 *
 * Si el evaluador no se animó a discriminar entre `pass` y
 * `pass_with_observations` (o no hace falta), pasar `'pass'` simple — no
 * intentamos auto-promover.
 */

const {
  Compliance,
  SEVERITY,
} = require('./ComplianceResult');

const { isBlockingInContext } = require('./blocking');

/* ───────── Kinds válidos ───────── */

const CONDITION_KINDS = Object.freeze([
  'exclude_destination',
  'requires_documentation',
  'requires_mitigation',
  'custom',
]);

/* ───────── Helper privado: validar limit estructurado ───────── */

function _normalizeLimit(limit) {
  // null / undefined / number / string pasan tal cual (los acepta el builder canónico)
  if (limit == null) return null;
  if (typeof limit === 'number' || typeof limit === 'string') return limit;
  if (typeof limit === 'object' && !Array.isArray(limit)) {
    // Plain object — el builder canónico lo congela y lo acepta como dato libre.
    // Convenciones:
    //   { value, comparator: '<=' | '>=' }    — límite simple con dirección
    //   { min, max }                          — banda
    //   { strict, standard }                  — dual (Tabla 3.4 CIRSOC AF)
    //   { value, comparator, normalizer? }    — extensión libre
    return limit;
  }
  return null;
}

/* ───────── Helper privado: validar conditions[] ───────── */

function _normalizeConditions(conditions) {
  if (!Array.isArray(conditions)) return null;
  return conditions.map((c) => {
    if (!c || typeof c !== 'object') {
      throw new Error('buildCompliance: cada condition debe ser un objeto');
    }
    if (!c.key || !c.description) {
      throw new Error(`buildCompliance: condition requiere key y description (recibido: ${JSON.stringify(c)})`);
    }
    if (c.kind && !CONDITION_KINDS.includes(c.kind)) {
      throw new Error(
        `buildCompliance: condition.kind "${c.kind}" no válido. Válidos: ${CONDITION_KINDS.join(', ')}`
      );
    }
    return {
      kind: c.kind || 'custom',
      key: c.key,
      ...(c.value !== undefined ? { value: c.value } : {}),
      description: c.description,
      ...(c.source ? { source: c.source } : {}),
    };
  });
}

/* ───────── API pública ───────── */

/**
 * Construye un ComplianceResult según el tipo de resultado declarado.
 *
 * @param {Object} args
 * @param {string} args.resultado - 'pass'|'pass_with_observations'|'conditional_pass'|'fail'|'inconclusive'|'informative'|'not_evaluated'
 * @param {string} [args.codigo] - código del ensayo (requerido para fail con cálculo automático de severity)
 * @param {Object} [args.usageContext] - requerido para fail (calcular severity)
 * @param {Object} [args.materialContext] - requerido para fail (calcular severity)
 * @param {number|string|null} [args.measured]
 * @param {number|string|object|null} [args.limit] - admite { value, comparator } | { min, max } | { strict, standard }
 * @param {string} [args.norm]
 * @param {string} [args.observation] - requerido si resultado='pass_with_observations'
 * @param {Array} [args.conditions] - requerido si resultado='conditional_pass'
 * @param {Array<string>} [args.reasons] - requerido si resultado='fail'
 * @param {string} [args.reason] - requerido si resultado='inconclusive' o 'not_evaluated'
 * @param {number|string|null} [args.detection_limit] - solo para 'inconclusive'
 * @param {'bloqueante'|'no_bloqueante'|null} [args.severityOverride] - opcional;
 *   si no se pasa, se calcula automáticamente vía isBlockingInContext.
 * @param {string} [args.message]
 * @param {Array<string>} [args.details]
 * @returns {ComplianceResult}
 */
function buildCompliance(args = {}) {
  const {
    resultado,
    codigo,
    usageContext,
    materialContext,
    measured,
    limit,
    norm,
    observation,
    conditions,
    reasons,
    reason,
    detection_limit,
    severityOverride,
    message,
    details,
  } = args;

  if (!resultado) {
    throw new Error('buildCompliance: falta `resultado`');
  }

  const normalizedLimit = _normalizeLimit(limit);
  const baseMeta = {
    measured: measured ?? null,
    limit:    normalizedLimit,
    norm:     norm || null,
  };

  switch (resultado) {
    case 'pass':
      return Compliance.pass({
        message: message || null,
        details: details || [],
        ...baseMeta,
      });

    case 'pass_with_observations':
      if (!observation) {
        throw new Error('buildCompliance: pass_with_observations requiere `observation`');
      }
      return Compliance.passWithObservations({
        observation,
        message: message || null,
        details: details || [],
        ...baseMeta,
      });

    case 'conditional_pass': {
      const norm_conditions = _normalizeConditions(conditions);
      if (!norm_conditions || norm_conditions.length === 0) {
        throw new Error('buildCompliance: conditional_pass requiere `conditions[]` no vacía');
      }
      return Compliance.conditionalPass({
        conditions: norm_conditions,
        message: message || null,
        details: details || [],
        ...baseMeta,
      });
    }

    case 'fail': {
      if (!Array.isArray(reasons) || reasons.length === 0) {
        throw new Error('buildCompliance: fail requiere `reasons[]` no vacía');
      }
      // severity: usar override si viene; si no, consultar blocking.
      let severity = severityOverride ?? null;
      if (severity === null && codigo) {
        const blocking = isBlockingInContext(codigo, usageContext, materialContext);
        severity = blocking ? SEVERITY.BLOQUEANTE : SEVERITY.NO_BLOQUEANTE;
      }
      return Compliance.fail({
        reasons,
        details: details || [],
        ...baseMeta,
        severity,
      });
    }

    case 'inconclusive':
      if (!reason) {
        throw new Error('buildCompliance: inconclusive requiere `reason`');
      }
      return Compliance.inconclusive({
        reason,
        detection_limit: detection_limit ?? null,
        details: details || [],
        ...baseMeta,
      });

    case 'informative':
      // informative no acepta limit (por definición no hay criterio de cumplimiento).
      // measured y norm sí.
      return Compliance.informative({
        message: message || null,
        details: details || [],
        measured: baseMeta.measured,
        norm: baseMeta.norm,
      });

    case 'not_evaluated':
      return Compliance.notEvaluated({
        reason: reason || 'Sin datos de evaluación',
        details: details || [],
        norm: baseMeta.norm,
      });

    default:
      throw new Error(`buildCompliance: resultado "${resultado}" no es válido`);
  }
}

module.exports = {
  buildCompliance,
  CONDITION_KINDS,
};
