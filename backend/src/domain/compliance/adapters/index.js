'use strict';

/**
 * Barrel de adapters entre vocabularios legacy y el modelo canónico
 * ComplianceResult.
 *
 * Tres familias de adapters:
 *   - sequelizeEnum: AgregadoEnsayo.cumple ENUM ↔ ComplianceResult
 *   - evalEngine:    output de ensayoEvalEngine.evaluarEnsayo() ↔ ComplianceResult
 *   - aptitudService: output de aptitudMaterialesService.verificarAptitudAF/AG() ↔ ComplianceResult
 *
 * `fromLegacyEval` (en ComplianceResult.js) sigue siendo el dispatcher genérico
 * para call sites que reciben strings/objetos heterogéneos. Para call sites
 * con un vocabulario conocido, preferir el adapter específico — la API es
 * más clara y permite agregar metadata estructurada cuando esté disponible.
 */

const seq = require('./sequelizeEnum');
const evalEng = require('./evalEngine');
const aptitud = require('./aptitudService');

module.exports = {
  // SequelizeEnum (BD)
  fromSequelizeEnum:        seq.fromSequelizeEnum,
  toSequelizeEnum:          seq.toSequelizeEnum,
  isLossyOnPersist:         seq.isLossyOnPersist,
  getLostFieldsOnPersist:   seq.getLostFieldsOnPersist,
  SEQUELIZE_COLLAPSE_MAP:   seq.COLLAPSE_MAP,

  // EvalEngine (motor de ensayos)
  fromEvalEngineString:     evalEng.fromEvalEngineString,
  // toEvalEngineString fue removida en Prompt 2 C11 (código muerto).

  // AptitudService (verificarAptitudAF/AG)
  fromAptitudServiceShape:  aptitud.fromAptitudServiceShape,
  toAptitudServiceShape:    aptitud.toAptitudServiceShape,
  mapItemsToCompliance:     aptitud.mapItemsToCompliance,
};
