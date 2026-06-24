'use strict';

/**
 * evaluacionEngine.js — Entry point unificado de evaluación dual.
 *
 * Este es el punto único que cualquier consumidor (services, controllers,
 * sugerencia de mezclas, etc.) usa para evaluar un material en el modo
 * que necesite. El engine delega al módulo correspondiente según `modo`.
 *
 * Patrón de uso típico:
 *
 *   const { evaluarMaterial, MODO_PRESTACIONAL, MODO_PRESCRIPTIVO } = require('.../evaluacion/evaluacionEngine');
 *
 *   // Para el PDF de la ficha técnica del agregado (default público):
 *   const r = evaluarMaterial({ items, contextoAgregado: 'HORMIGON' }, { modo: MODO_PRESTACIONAL });
 *
 *   // Para sugerencia automática de mezclas (interno, conservador):
 *   const r = evaluarMaterial({ items, claseExposicion: 'C2', fceMpa: 35 }, { modo: MODO_PRESCRIPTIVO });
 *
 *   // Para dual display en cards / dashboards:
 *   const dual = evaluarDual({ items, contextoAgregado: 'HORMIGON', claseExposicion: 'C2', fceMpa: 35 });
 *   //  → { prestacional: EvaluacionResult, prescriptivo: EvaluacionResult }
 *
 * Función PURA. Sin DB, sin HTTP, sin Sequelize.
 */

const {
  MODO_DESCRIPTIVO,
  MODO_NORMATIVO,
  MODO_PRESCRIPTIVO,
  MODO_PRESTACIONAL,
  MODOS_VALIDOS,
  VEREDICTO,
  SEVERIDAD_FALTANTE,
  SEVERIDAD_DESVIO,
  normalizarModo,
  emptyEvaluacionResult,
} = require('./modos');

const { evaluarPrestacional } = require('./prestacionalEngine');
const { evaluarPrescriptivo } = require('./prescriptivoEngine');

/**
 * Evalúa un material en el modo solicitado.
 *
 * @param {object} input - shape común a ambos engines.
 * @param {object} [options]
 *   - modo: 'NORMATIVO' | 'DESCRIPTIVO' (acepta alias 'PRESCRIPTIVO' / 'PRESTACIONAL').
 *     Default 'DESCRIPTIVO'.
 * @returns {EvaluacionResult}
 */
// Helper interno: normaliza el campo `modo` del resultado al canónico nuevo.
// Los engines subyacentes (prestacionalEngine / prescriptivoEngine) escriben
// `modo: 'PRESTACIONAL' | 'PRESCRIPTIVO'` (strings viejos); este wrapper
// expone el canónico nuevo en la salida pública.
function _normalizarResultModo(result) {
  if (result && typeof result === 'object' && result.modo) {
    return { ...result, modo: normalizarModo(result.modo) };
  }
  return result;
}

function evaluarMaterial(input = {}, options = {}) {
  const modo = normalizarModo(options.modo);
  if (modo === MODO_NORMATIVO) return _normalizarResultModo(evaluarPrescriptivo(input));
  return _normalizarResultModo(evaluarPrestacional(input));
}

/**
 * Devuelve ambos resultados sobre los mismos datos. Útil para cards /
 * dashboards que muestran ambas vistas en simultáneo (DualVeredictoBadge).
 *
 * Devuelve los keys canónicos nuevos (`descriptivo`, `normativo`) y los
 * aliases deprecados (`prestacional`, `prescriptivo`) apuntando al mismo
 * objeto para back-compat con callers que aún no migraron.
 */
function evaluarDual(input = {}) {
  const descriptivo = _normalizarResultModo(evaluarPrestacional(input));
  const normativo   = _normalizarResultModo(evaluarPrescriptivo(input));
  return {
    descriptivo,
    normativo,
    /** @deprecated Usar `descriptivo`. */
    prestacional: descriptivo,
    /** @deprecated Usar `normativo`. */
    prescriptivo: normativo,
  };
}

module.exports = {
  evaluarMaterial,
  evaluarDual,
  // Re-exports del contrato común.
  MODO_DESCRIPTIVO,
  MODO_NORMATIVO,
  /** @deprecated */ MODO_PRESCRIPTIVO,
  /** @deprecated */ MODO_PRESTACIONAL,
  MODOS_VALIDOS,
  VEREDICTO,
  SEVERIDAD_FALTANTE,
  SEVERIDAD_DESVIO,
  normalizarModo,
  emptyEvaluacionResult,
};
