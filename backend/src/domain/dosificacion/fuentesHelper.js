'use strict';

/**
 * Helper for building the fuentesCalculo matrix.
 * Used by both ACI and ICPA engines.
 */

const ORIGEN_TIPO = {
  INPUT_USUARIO:    'INPUT_USUARIO',
  MEZCLA:          'MEZCLA',
  MATERIAL_CEMENTO:'MATERIAL_CEMENTO',
  MATERIAL_ADITIVO:'MATERIAL_ADITIVO',
  CURVA:           'CURVA',
  CURVA_CEMENTO:   'CURVA_CEMENTO',
  TABLA:           'TABLA',
  REGLA:           'REGLA',
  DURABILIDAD:     'DURABILIDAD',
  PLIEGO:          'PLIEGO',
  DEFAULT:         'DEFAULT',
  CALCULADO:       'CALCULADO',
};

const CRITICIDAD = {
  INFO:    'INFO',
  WARNING: 'WARNING',
  FALLBACK:'FALLBACK',
};

/**
 * Append one fuente entry to the array.
 *
 * @param {Array}  arr
 * @param {object} f
 * @param {string} f.parametro   - Human-readable parameter name
 * @param {*}      f.valor       - Value used in the calculation
 * @param {string} f.origenTipo  - One of ORIGEN_TIPO
 * @param {string} [f.origenRef] - Name of the source (material, curve, mezcla…)
 * @param {string} [f.regla]     - Short explanation of how the value was applied
 * @param {string} [f.observacion] - Clarifications, warnings, or fallback notes
 * @param {string} [f.criticidad]  - One of CRITICIDAD (default INFO)
 */
function pushFuente(arr, { parametro, valor, origenTipo, origenRef, regla, observacion, criticidad } = {}) {
  arr.push({
    parametro:   parametro || '—',
    valor:       valor != null ? String(valor) : '—',
    origenTipo:  origenTipo  || ORIGEN_TIPO.CALCULADO,
    origenRef:   origenRef   || null,
    regla:       regla       || null,
    observacion: observacion || null,
    criticidad:  criticidad  || CRITICIDAD.INFO,
  });
}

module.exports = { ORIGEN_TIPO, CRITICIDAD, pushFuente };
