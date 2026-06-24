'use strict';

/**
 * Adapter: shape de `ensayoEvalEngine.evaluarEnsayo()` ↔ ComplianceResult.
 *
 * El motor legacy (`src/domain/ensayoEvalEngine.js`) devuelve:
 *   {
 *     cumple:        'CUMPLE'|'NO_CUMPLE'|'NO_EVAL',
 *     estado:        'CUMPLE'|'NO_CUMPLE'|'NO_EVAL'|'SIN_PARAMETROS'|'NO_CONCLUYENTE',
 *     mensaje:       string,
 *     detalle:       string[],
 *     observaciones: string[],
 *     informativo:   boolean,
 *     alerta:        boolean,
 *   }
 *
 * O bien un string suelto con `estado` (cuando el call site solo pasa el
 * string del campo `cumple` o `estado` por separado).
 *
 * El motor todavía NO expone metadata estructurada (measured/limit/norm).
 * Cuando Prompt 2 lo refactore, este adapter empezará a devolver esa
 * metadata sin tocar firma — los call sites no se enteran.
 *
 * fromLegacyEval en ComplianceResult.js sigue siendo el dispatcher genérico;
 * fromEvalEngineString es la API explícita para call sites del motor.
 */

const cr = require('../ComplianceResult');
const {
  STATUS,
  Compliance,
  fromLegacyEval,
  isPass,
  isFail,
  isConditionalPass,
  isInconclusive,
  isPassWithObservations,
  isExpired,
  isPending,
  isNotApplicable,
} = cr;

/* ───────── Direcciones ───────── */

/**
 * Convierte un input del motor `evaluarEnsayo` a ComplianceResult.
 *
 * Acepta:
 *   - string suelto: 'CUMPLE' | 'NO_CUMPLE' | 'NO_EVAL' | 'SIN_PARAMETROS' | 'NO_CONCLUYENTE'
 *   - objeto del motor: { cumple, estado, mensaje, detalle, observaciones, informativo, alerta }
 *   - null/undefined → notEvaluated (default seguro)
 *
 * El adapter delega la lógica de normalización a `fromLegacyEval` (que ya
 * cubre todas las equivalencias detectadas en la auditoría v2). Esta función
 * existe como API explícita y tipada para los call sites del motor —
 * documenta intención y deja un único punto donde inyectar la metadata
 * estructurada cuando Prompt 2 refactore el motor.
 *
 * @param {string|object|null} legacy
 * @returns {ComplianceResult}
 */
function fromEvalEngineString(legacy) {
  // Hoy: passthrough. La lógica vive en fromLegacyEval.
  // Mañana (Prompt 2): si `legacy` ya trae measured/limit/norm, los
  //   propagamos al ComplianceResult retornado.
  return fromLegacyEval(legacy);
}

// `toEvalEngineString` (anterior dirección inversa del adapter) fue removida
// en Prompt 2 C11 — confirmada como código muerto vía grep en producción.
// El shape legacy del motor `evaluarEnsayo` se construye directamente en
// `ensayoEvalEngine.js` con su propio mapeo; nadie en el codebase ha
// necesitado convertir de ComplianceResult al shape legacy. Si en el futuro
// hace falta esa conversión, recuperar el commit que la borró antes que
// reescribirla — había sutilezas (handling de severity, condicional, etc.)
// que vale la pena preservar.

module.exports = {
  fromEvalEngineString,
};
