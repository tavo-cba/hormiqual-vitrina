'use strict';

/**
 * Adaptador para migración progresiva del formato de EnsayoResultado.
 *
 * Detecta el formato de un registro existente y lo normaliza a MeasuredValue.
 * Permite que el código nuevo lea siempre el formato unificado, mientras la
 * base de datos sigue conteniendo registros en distintos formatos hasta que
 * la migración masiva se complete.
 *
 * Formatos de entrada soportados:
 *   1. Legacy DB: { valor: 0.01, esMenorQue: true, unidad: '%' }
 *   2. Legacy DB v2: { valor: 0.01, operador: 'menor_que', unidad: '%' }
 *   3. Nuevo formato: { value, qualifier, unit, isCensored, detectionLimit }
 *   4. String: "< 500 ppm"
 *   5. Número crudo: 0.01
 *   6. null / undefined → notMeasured
 */

const { create, notMeasured } = require('./MeasuredValue');
const { parse } = require('./parser');

/**
 * Detecta el formato del input y lo convierte a MeasuredValue.
 *
 * @param {*} input
 * @param {Object} [options]
 * @param {string} [options.defaultUnit]
 * @returns {MeasuredValue}
 */
function adapt(input, options = {}) {
  if (input == null) return notMeasured(options.defaultUnit);

  // Ya es MeasuredValue (formato nuevo)
  if (typeof input === 'object' && 'value' in input && 'qualifier' in input) {
    return create(input);
  }

  // Formato legacy DB
  if (typeof input === 'object' && ('valor' in input || 'esMenorQue' in input || 'operador' in input)) {
    const qualifier =
      input.esMenorQue === true ? '<' :
      input.operador === 'menor_que' ? '<' :
      input.operador === 'mayor_que' ? '>' :
      null;
    return create({
      value: input.valor != null ? Number(input.valor) : null,
      qualifier,
      unit: input.unidad || options.defaultUnit || null,
      source: input.idEnsayo ? `ensayo:${input.idEnsayo}` : undefined,
    });
  }

  // String o número → delegar al parser
  return parse(input, options);
}

/**
 * Adapta un objeto Resultado completo (con varios campos como valor, valor1,
 * valor2, etc.) a un mapa de MeasuredValues por nombre de campo.
 *
 * Ej: { valor: 0.01, esMenorQue: true, unidad: '%', valor2: 0.5 }
 *  →  { primary: MeasuredValue{0.01, '<', '%'}, valor2: MeasuredValue{0.5, null, null} }
 *
 * @param {Object} resultado
 * @returns {Object} mapa de campo → MeasuredValue
 */
function adaptResultado(resultado, options = {}) {
  if (!resultado) return {};
  const out = {};
  // Campo principal
  if ('valor' in resultado || 'esMenorQue' in resultado || 'operador' in resultado) {
    out.primary = adapt(resultado, options);
  }
  // Campos numéricos secundarios (valor2, densidadAparente, pasantePct, etc.)
  for (const [key, value] of Object.entries(resultado)) {
    if (['valor', 'esMenorQue', 'operador', 'unidad'].includes(key)) continue;
    if (value == null) continue;
    if (typeof value === 'number' || typeof value === 'string') {
      const adapted = adapt(value, options);
      if (adapted.value != null || adapted._parseWarning) {
        out[key] = adapted;
      }
    }
  }
  return out;
}

module.exports = { adapt, adaptResultado };
