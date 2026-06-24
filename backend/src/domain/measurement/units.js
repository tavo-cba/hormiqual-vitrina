'use strict';

/**
 * Conversor de unidades dimensional.
 *
 * Cada unidad pertenece a una "dimensión" (concentración, masa, presión...).
 * Solo se permite convertir entre unidades de la misma dimensión.
 * Convertir entre dimensiones distintas LANZA un error explícito (no devuelve
 * silenciosamente un número incorrecto).
 *
 * Esto resuelve la raíz del bug P0.2: "< 500 ppm" se convertía a NaN porque el
 * código asumía que todo venía en %. Ahora el conversor obliga a declarar
 * unidad de origen y destino, y se asegura de que la conversión sea válida.
 */

/**
 * Tabla de unidades. Cada entrada:
 *   { dimension: string, toBase: number }
 * `toBase` es el factor para convertir a la unidad base de la dimensión.
 *
 * Dimensión 'concentracion-masa-masa' (mg/kg, ppm, %):
 *   base = ppm
 *   1% = 10000 ppm; 1 mg/kg = 1 ppm
 */
const UNITS = {
  // Concentración masa/masa
  'ppm':   { dimension: 'concentracion-masa-masa', toBase: 1 },
  'mg/kg': { dimension: 'concentracion-masa-masa', toBase: 1 },
  '%':     { dimension: 'concentracion-masa-masa', toBase: 10000 },
  // Masa por volumen
  'kg/m3': { dimension: 'masa-volumen', toBase: 1 },
  'kg/m³': { dimension: 'masa-volumen', toBase: 1 },
  'g/L':   { dimension: 'masa-volumen', toBase: 1 },
  'g/l':   { dimension: 'masa-volumen', toBase: 1 },
  'kg/L':  { dimension: 'masa-volumen', toBase: 1000 },
  'g/m3':  { dimension: 'masa-volumen', toBase: 0.001 },
  // Volumen
  'L':   { dimension: 'volumen', toBase: 1 },
  'l':   { dimension: 'volumen', toBase: 1 },
  'mL':  { dimension: 'volumen', toBase: 0.001 },
  'ml':  { dimension: 'volumen', toBase: 0.001 },
  'm3':  { dimension: 'volumen', toBase: 1000 },
  'm³':  { dimension: 'volumen', toBase: 1000 },
  // Masa
  'kg':  { dimension: 'masa', toBase: 1 },
  'g':   { dimension: 'masa', toBase: 0.001 },
  'mg':  { dimension: 'masa', toBase: 0.000001 },
};

/**
 * Convierte un valor entre unidades de la misma dimensión.
 *
 * @param {number} value
 * @param {string} fromUnit
 * @param {string} toUnit
 * @returns {number}
 * @throws {Error} si las unidades pertenecen a dimensiones distintas o no existen
 */
function convert(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  const from = UNITS[fromUnit];
  const to = UNITS[toUnit];
  if (!from) throw new Error(`Unidad desconocida: "${fromUnit}"`);
  if (!to) throw new Error(`Unidad desconocida: "${toUnit}"`);
  if (from.dimension !== to.dimension) {
    throw new Error(
      `No se puede convertir "${fromUnit}" (${from.dimension}) a "${toUnit}" (${to.dimension}). ` +
      `Dimensiones incompatibles.`
    );
  }
  return value * from.toBase / to.toBase;
}

/**
 * Convierte un MeasuredValue a la unidad indicada, devolviendo un nuevo
 * MeasuredValue con el valor convertido. Preserva qualifier, isCensored, etc.
 *
 * @param {MeasuredValue} mv
 * @param {string} toUnit
 * @returns {MeasuredValue}
 */
function convertMeasuredValue(mv, toUnit) {
  if (!mv || mv.value == null) return { ...mv, unit: toUnit };
  if (!mv.unit) {
    throw new Error(`No se puede convertir un MeasuredValue sin unidad de origen a "${toUnit}".`);
  }
  if (mv.unit === toUnit) return mv;
  const newValue = convert(mv.value, mv.unit, toUnit);
  const result = { ...mv, value: newValue, unit: toUnit };
  if (mv.detectionLimit != null) {
    result.detectionLimit = convert(mv.detectionLimit, mv.unit, toUnit);
  }
  return result;
}

/**
 * Indica si dos unidades son convertibles entre sí (misma dimensión).
 */
function areCompatible(unitA, unitB) {
  if (unitA === unitB) return true;
  const a = UNITS[unitA];
  const b = UNITS[unitB];
  if (!a || !b) return false;
  return a.dimension === b.dimension;
}

module.exports = {
  convert,
  convertMeasuredValue,
  areCompatible,
  UNITS,
};
