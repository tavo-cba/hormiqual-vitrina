'use strict';

/**
 * Parser robusto para strings de valores medidos.
 *
 * Casos que debe soportar:
 *   "< 500 ppm"      → { value: 500, qualifier: '<', unit: 'ppm', isCensored: true, detectionLimit: 500 }
 *   "0,01 %"         → { value: 0.01, qualifier: null, unit: '%', isCensored: false }
 *   "0.003%"         → { value: 0.003, qualifier: null, unit: '%', isCensored: false }
 *   "< 0,003%"       → { value: 0.003, qualifier: '<', unit: '%', isCensored: true, detectionLimit: 0.003 }
 *   "≤ 5,0%"         → { value: 5.0, qualifier: '<=', unit: '%', isCensored: true, detectionLimit: 5.0 }
 *   "500"            → { value: 500, qualifier: null, unit: null, isCensored: false }
 *   "500 mg/kg"      → { value: 500, qualifier: null, unit: 'mg/kg', isCensored: false }
 *   "" / null / NaN  → { value: null, qualifier: null, unit: null, isCensored: false } (notMeasured)
 *   "no medido"      → notMeasured
 */

const { create, notMeasured } = require('./MeasuredValue');

const QUALIFIER_PATTERNS = [
  { regex: /^<=/, qualifier: '<=' },
  { regex: /^>=/, qualifier: '>=' },
  { regex: /^\u2264/, qualifier: '<=' },  // ≤
  { regex: /^\u2265/, qualifier: '>=' },  // ≥
  { regex: /^</, qualifier: '<' },
  { regex: /^>/, qualifier: '>' },
];

const NOT_MEASURED_TOKENS = new Set([
  'no medido', 'sin medir', 'no determinado', 'nd', 'n/d', 'n.d.',
  '\u2014', '-', '--', 'pendiente',
]);

/**
 * Intenta parsear una entrada arbitraria a un MeasuredValue.
 * No lanza: para entradas inválidas devuelve notMeasured() y un campo
 * `_parseWarning` con la razón. Esto evita que un dato malformado rompa el
 * pipeline; el caller decide si avisar al usuario.
 *
 * @param {string|number|object|null} input
 * @param {Object} [options]
 * @param {string} [options.defaultUnit] - unidad implícita si la entrada no la especifica
 * @returns {MeasuredValue & { _parseWarning?: string }}
 */
function parse(input, options = {}) {
  const { defaultUnit = null } = options;

  // Caso null / undefined / "" → no medido
  if (input == null || input === '') {
    return notMeasured(defaultUnit);
  }

  // Caso objeto: si ya viene en formato MeasuredValue, devolverlo tal cual
  if (typeof input === 'object') {
    if ('value' in input && 'qualifier' in input) {
      // Ya es MeasuredValue, validar via create()
      return create(input);
    }
    // Formato legacy: { valor, esMenorQue, unidad }
    if ('valor' in input || 'esMenorQue' in input || 'unidad' in input) {
      const qualifier = input.esMenorQue === true ? '<'
        : input.operador === 'menor_que' ? '<'
        : input.operador === 'mayor_que' ? '>'
        : null;
      return create({
        value: input.valor != null ? Number(input.valor) : null,
        qualifier,
        unit: input.unidad || defaultUnit,
      });
    }
    return notMeasured(defaultUnit);
  }

  // Caso número crudo
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      return { ...notMeasured(defaultUnit), _parseWarning: `Valor numérico no finito: ${input}` };
    }
    return create({ value: input, unit: defaultUnit });
  }

  // Caso string
  let str = String(input).trim();
  if (!str) return notMeasured(defaultUnit);

  // Tokens explícitos de "no medido"
  if (NOT_MEASURED_TOKENS.has(str.toLowerCase())) return notMeasured(defaultUnit);

  // Detectar qualifier al inicio
  let qualifier = null;
  for (const pat of QUALIFIER_PATTERNS) {
    if (pat.regex.test(str)) {
      qualifier = pat.qualifier;
      str = str.replace(pat.regex, '').trim();
      break;
    }
  }

  // Extraer número (soporta coma o punto decimal, signo opcional)
  // Acepta: "0,01", "0.01", "1.234,56" (es-AR), "1,234.56" (en-US)
  // Regex: capturar el primer número al inicio
  const numMatch = str.match(/^(-?\d+(?:[.,]\d+)?(?:[.,]\d+)?)\s*(.*)$/);
  if (!numMatch) {
    return { ...notMeasured(defaultUnit), _parseWarning: `No se pudo extraer un número de "${input}"` };
  }

  const numRaw = numMatch[1];
  let unitStr = numMatch[2].trim();

  // Normalizar separador decimal a punto (asumimos formato es-AR como default)
  // Caso "1,234.56" (en-US con miles): tiene tanto coma como punto, el punto es decimal
  // Caso "1.234,56" (es-AR con miles): tiene tanto, la coma es decimal
  // Caso "1,234" (es-AR sin miles): coma es decimal
  // Caso "1234.56": punto decimal (en-US sin miles)
  let normalized = numRaw;
  const hasComma = numRaw.includes(',');
  const hasDot = numRaw.includes('.');
  if (hasComma && hasDot) {
    // Decidir cuál es decimal por posición: el último es el decimal
    const lastComma = numRaw.lastIndexOf(',');
    const lastDot = numRaw.lastIndexOf('.');
    if (lastComma > lastDot) {
      // Coma es decimal: quitar puntos y reemplazar coma por punto
      normalized = numRaw.replace(/\./g, '').replace(',', '.');
    } else {
      // Punto es decimal: quitar comas
      normalized = numRaw.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Solo coma: asumir decimal
    normalized = numRaw.replace(',', '.');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { ...notMeasured(defaultUnit), _parseWarning: `No se pudo parsear el número "${numRaw}"` };
  }

  // Unidad: si no vino en el string, usar default
  const unit = unitStr || defaultUnit;

  return create({ value, qualifier, unit });
}

module.exports = { parse };
