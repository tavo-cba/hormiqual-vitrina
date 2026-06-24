'use strict';

/**
 * Adapter: ENUM persistido en `AgregadoEnsayo.cumple` ↔ ComplianceResult.
 *
 * El ENUM Sequelize tiene 4 valores históricos:
 *   'CUMPLE' | 'NO_CUMPLE' | 'NO_EVAL' | 'PENDIENTE'
 *
 * El modelo canónico tiene 10 estados. El roundtrip 10 → 4 es inevitablemente
 * lossy: estados como `expired`, `notApplicable`, `inconclusive`, `passWithObservations`,
 * `conditionalPass` e `informative` no tienen un valor nativo en BD y deben
 * colapsarse al ENUM más cercano. La pérdida está documentada estado por estado
 * y verificada con tests vivos.
 *
 * No tocar el ENUM de BD — está sembrado en producción y migrarlo es caro.
 */

const {
  STATUS,
  Compliance,
  matchExt,
} = require('../ComplianceResult');

/* ───────── Mapping inverso (10 → 4) ───────── */

/**
 * Tabla de colapso documentada. Cada entry indica:
 *   - target: el valor del ENUM al que se mapea
 *   - lossy: si el roundtrip es lossy (true) o lossless (false)
 *   - lostFields: qué información se pierde al colapsar
 *
 * Esta tabla es la fuente de verdad de los tests de pérdida.
 */
const COLLAPSE_MAP = Object.freeze({
  [STATUS.PASS]: Object.freeze({
    target: 'CUMPLE',
    lossy: false,
    lostFields: [],
  }),
  [STATUS.PASS_WITH_OBSERVATIONS]: Object.freeze({
    target: 'CUMPLE',
    lossy: true,
    lostFields: ['observation'],
  }),
  [STATUS.CONDITIONAL_PASS]: Object.freeze({
    target: 'CUMPLE',
    lossy: true,
    lostFields: ['conditions'],
  }),
  [STATUS.FAIL]: Object.freeze({
    target: 'NO_CUMPLE',
    lossy: true,
    lostFields: ['reasons', 'severity', 'measured', 'limit', 'norm'],
  }),
  [STATUS.INCONCLUSIVE]: Object.freeze({
    target: 'NO_EVAL',
    lossy: true,
    lostFields: ['reason', 'detection_limit', 'measured', 'limit'],
  }),
  [STATUS.NOT_EVALUATED]: Object.freeze({
    target: 'NO_EVAL',
    lossy: false,  // notEvaluated ↔ NO_EVAL es la equivalencia más directa
    lostFields: [],
  }),
  [STATUS.INFORMATIVE]: Object.freeze({
    target: 'NO_EVAL',
    lossy: true,
    lostFields: ['measured', 'norm'],
  }),
  [STATUS.EXPIRED]: Object.freeze({
    target: 'NO_EVAL',
    lossy: true,
    lostFields: ['test_date', 'expiry_date', 'measured', 'limit'],
  }),
  [STATUS.PENDING]: Object.freeze({
    target: 'PENDIENTE',
    lossy: false,  // pending ↔ PENDIENTE es directo
    lostFields: [],
  }),
  [STATUS.NOT_APPLICABLE]: Object.freeze({
    target: 'NO_EVAL',
    lossy: true,
    lostFields: ['reason', 'norm'],
  }),
});

/**
 * Convierte un ComplianceResult al valor ENUM persistible en
 * `AgregadoEnsayo.cumple`.
 *
 * @param {ComplianceResult} r
 * @returns {'CUMPLE'|'NO_CUMPLE'|'NO_EVAL'|'PENDIENTE'}
 * @throws Si r no tiene status válido.
 */
function toSequelizeEnum(r) {
  if (!r || !r.status) {
    throw new Error('toSequelizeEnum: el resultado no tiene status');
  }
  const entry = COLLAPSE_MAP[r.status];
  if (!entry) {
    throw new Error(`toSequelizeEnum: status desconocido "${r.status}"`);
  }
  return entry.target;
}

/* ───────── Mapping directo (4 → 10) ───────── */

/**
 * Convierte un valor ENUM de `AgregadoEnsayo.cumple` a un ComplianceResult.
 *
 * El ENUM no lleva metadata estructurada (measured/limit/norm), así que el
 * resultado retornado tiene esos campos en null. Si el caller necesita la
 * metadata, debe combinarse con datos del ensayo (campo `resultado` JSON,
 * `tipo`, etc.) por fuera de este adapter.
 *
 * Mapeo:
 *   'CUMPLE'     → Compliance.pass()
 *   'NO_CUMPLE'  → Compliance.fail({ reasons: ['No cumple según ensayo persistido'] })
 *   'NO_EVAL'    → Compliance.notEvaluated({ reason: 'Estado persistido como NO_EVAL' })
 *   'PENDIENTE'  → Compliance.pending({ reason: 'Estado persistido como PENDIENTE' })
 *   otro/null    → Compliance.notEvaluated({ reason: ... })  (default seguro)
 *
 * @param {string|null} value
 * @returns {ComplianceResult}
 */
function fromSequelizeEnum(value) {
  if (value == null) {
    return Compliance.notEvaluated({ reason: 'Sin valor persistido para `cumple`' });
  }
  const v = String(value).trim().toUpperCase();
  switch (v) {
    case 'CUMPLE':
      return Compliance.pass();
    case 'NO_CUMPLE':
      return Compliance.fail({
        reasons: ['No cumple según ensayo persistido'],
      });
    case 'NO_EVAL':
      return Compliance.notEvaluated({
        reason: 'Estado persistido como NO_EVAL',
      });
    case 'PENDIENTE':
      return Compliance.pending({
        reason: 'Estado persistido como PENDIENTE',
      });
    default:
      return Compliance.notEvaluated({
        reason: `Valor "${value}" no reconocido en ENUM AgregadoEnsayo.cumple`,
      });
  }
}

/**
 * Indica si un estado canónico se puede persistir sin pérdida en el ENUM
 * de `AgregadoEnsayo.cumple`.
 *
 * Útil para decidir si vale la pena complementar el ENUM con metadata
 * adicional (en JSON `resultado` u otra columna) antes de persistir.
 */
function isLossyOnPersist(complianceResult) {
  if (!complianceResult || !complianceResult.status) return true;
  const entry = COLLAPSE_MAP[complianceResult.status];
  return entry ? entry.lossy : true;
}

/**
 * Devuelve la lista de campos que se pierden al persistir este resultado
 * en el ENUM. Vacía si el roundtrip es lossless.
 */
function getLostFieldsOnPersist(complianceResult) {
  if (!complianceResult || !complianceResult.status) return [];
  const entry = COLLAPSE_MAP[complianceResult.status];
  return entry ? [...entry.lostFields] : [];
}

module.exports = {
  fromSequelizeEnum,
  toSequelizeEnum,
  isLossyOnPersist,
  getLostFieldsOnPersist,
  COLLAPSE_MAP,
};
