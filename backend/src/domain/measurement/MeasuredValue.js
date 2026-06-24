'use strict';

/**
 * MeasuredValue — modelo unificado para representar valores medidos en ensayos.
 *
 * Razón de existir: durante años se usaron múltiples formatos para el mismo dato:
 *   - { valor: 0.01, esMenorQue: true, unidad: '%' }    (formato legacy)
 *   - "< 0,01 %"                                          (string libre)
 *   - 0.01                                                 (número crudo)
 *
 * Esto causó:
 *   - P0.2: el certificado renderizaba `NaN %` cuando recibía "< 500 ppm"
 *   - P0.4: valores censurados como "< 0,01 %" se convertían a "0,010 %",
 *     lo cual falsifica la realidad del dato (el valor real es DESCONOCIDO,
 *     solo sabemos que es menor al límite de detección)
 *
 * Este módulo normaliza todo a una forma única y bien tipada:
 *
 *   {
 *     value: number | null,
 *     qualifier: '<' | '>' | '<=' | '>=' | '=' | null,
 *     unit: string | null,
 *     isCensored: boolean,
 *     detectionLimit?: number,
 *     source?: string  // referencia opcional al ensayo de origen
 *   }
 *
 * Reglas:
 *   - isCensored = true cuando qualifier es '<' o '>' (no se conoce el valor real)
 *   - detectionLimit es el valor que sigue al qualifier; sirve como estimación
 *     conservadora cuando un cálculo necesita un número
 *   - value = null cuando no hay dato (NotMeasured)
 *
 * NUNCA convertir un MeasuredValue censurado a número crudo sin pasar por
 * `asConservativeEstimate()` que propaga el flag de estimación.
 */

const VALID_QUALIFIERS = new Set(['<', '>', '<=', '>=', '=', null]);

/**
 * Crea un MeasuredValue validado.
 * @param {Object} input
 * @returns {MeasuredValue}
 */
function create({ value = null, qualifier = null, unit = null, isCensored, detectionLimit, source } = {}) {
  if (value !== null && !Number.isFinite(Number(value))) {
    throw new Error(`MeasuredValue: value debe ser finito o null. Recibido: ${value}`);
  }
  if (!VALID_QUALIFIERS.has(qualifier)) {
    throw new Error(`MeasuredValue: qualifier inválido "${qualifier}". Válidos: <, >, <=, >=, =, null`);
  }
  const numValue = value !== null ? Number(value) : null;
  const censored = isCensored != null
    ? !!isCensored
    : (qualifier === '<' || qualifier === '>' || qualifier === '<=' || qualifier === '>=');
  const dl = detectionLimit != null ? Number(detectionLimit) : (censored && numValue != null ? numValue : undefined);
  return {
    value: numValue,
    qualifier: qualifier || null,
    unit: unit || null,
    isCensored: censored,
    ...(dl != null ? { detectionLimit: dl } : {}),
    ...(source ? { source } : {}),
  };
}

/**
 * Representa "no medido / sin dato".
 */
function notMeasured(unit = null) {
  return { value: null, qualifier: null, unit, isCensored: false };
}

/**
 * Indica si el valor está disponible (no es null).
 */
function hasValue(mv) {
  return mv != null && mv.value != null;
}

/**
 * Devuelve una estimación conservadora cuando el valor está censurado.
 * Si qualifier es '<', el valor real es MENOR que detectionLimit, así que
 * usar detectionLimit como cota superior es conservador para checks de máximo.
 *
 * @param {MeasuredValue} mv
 * @returns {{ value: number | null, isEstimate: boolean, reason?: string }}
 */
function asConservativeEstimate(mv) {
  if (!mv) return { value: null, isEstimate: false };
  if (!mv.isCensored) return { value: mv.value, isEstimate: false };
  // Censurado: usar detectionLimit como cota
  return {
    value: mv.detectionLimit ?? mv.value,
    isEstimate: true,
    reason: `Valor censurado (${mv.qualifier} ${mv.detectionLimit}). Estimación conservadora usando límite de detección.`,
  };
}

module.exports = {
  create,
  notMeasured,
  hasValue,
  asConservativeEstimate,
  VALID_QUALIFIERS,
};
