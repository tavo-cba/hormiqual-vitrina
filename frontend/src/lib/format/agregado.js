/**
 * Precisiones canónicas para parámetros de agregado (MaterialDetailPage,
 * CumplimientoNormativoTable, tabla "Ensayos" del detalle, granulometría).
 *
 * Reglas:
 *   - Default: 1 decimal después de la coma.
 *   - Densidades (SSS/seca/real): 3 decimales (precisión hidrostática).
 *   - MF (Módulo de finura): 2 decimales por convención IRAM 1505/1627.
 *   - PUC/PUS, materia orgánica (mg/kg): 0 decimales + thousands separator
 *     (valores típicos > 500).
 *   - Resto: ajustado al rango de la norma (Sulfatos, Cloruros, etc.).
 *
 * Justificación: el spec en pantalla no debe mostrar más decimales que la
 * precisión real del ensayo (no inventar dígitos). Para inputs se permite
 * mayor precisión; para display se redondea a esta tabla.
 *
 * Source of truth — no duplicar este map en otros componentes.
 */

import { formatNumber } from './index';

/**
 * Map: parámetro canónico → { decimals, thousands, unit }
 * Las `unit` son las que se usan al mostrar el valor formateado (no se imprime
 * automáticamente; el caller decide si concatenar). Documentadas para referencia.
 */
export const PRECISION_AGREGADO = Object.freeze({
  // Caracterización
  mf:                  { decimals: 2, thousands: false, unit: '' },
  tmn:                 { decimals: 1, thousands: false, unit: 'mm' },
  densidadSSS:         { decimals: 3, thousands: false, unit: '' },
  densidadSeca:        { decimals: 3, thousands: false, unit: '' },
  densidadReal:        { decimals: 3, thousands: false, unit: '' },
  absorcion:           { decimals: 1, thousands: false, unit: '%' },
  pasa200:             { decimals: 1, thousands: false, unit: '%' },
  puc:                 { decimals: 0, thousands: true,  unit: 'kg/m³' },
  pus:                 { decimals: 0, thousands: true,  unit: 'kg/m³' },
  lajosidad:           { decimals: 1, thousands: false, unit: '%' },
  elongacion:          { decimals: 1, thousands: false, unit: '%' },

  // Cumplimiento normativo (CIRSOC 200-2024)
  terronesArcilla:     { decimals: 1, thousands: false, unit: '%' },
  perdidaSulfato:      { decimals: 1, thousands: false, unit: '%' },
  sulfatosSO3:         { decimals: 2, thousands: false, unit: '%' },
  cloruros:            { decimals: 2, thousands: false, unit: '%' },
  salesSolubles:       { decimals: 1, thousands: false, unit: '%' },
  materiaOrganica:     { decimals: 0, thousands: true,  unit: 'mg/kg' },
  materiasCarbonosas:  { decimals: 1, thousands: false, unit: '%' },
  equivalenteArena:    { decimals: 0, thousands: false, unit: '%' },
  losAngeles:          { decimals: 1, thousands: false, unit: '%' },
  polvoAdherido:       { decimals: 1, thousands: false, unit: '%' },
  particulasBlandas:   { decimals: 1, thousands: false, unit: '%' },

  // Granulometría
  pasaPctTamiz:        { decimals: 1, thousands: false, unit: '%' },
  aberturaTamiz:       { decimals: 2, thousands: false, unit: 'mm' },
});

const DEFAULT_SPEC = { decimals: 1, thousands: false, unit: '' };

/**
 * Devuelve la spec de precisión para un parámetro. Si no existe, usa el default
 * (1 decimal sin thousands).
 *
 * @param {string} key
 * @returns {{decimals:number, thousands:boolean, unit:string}}
 */
export function specFor(key) {
  return PRECISION_AGREGADO[key] || DEFAULT_SPEC;
}

/**
 * Formatea un valor numérico aplicando la precisión canónica del parámetro.
 *
 * @param {string} key - clave en PRECISION_AGREGADO (ej: 'mf', 'absorcion').
 * @param {*} value
 * @param {Object} [opts]
 * @param {boolean} [opts.withUnit=false] - si true, concatena la unidad del map.
 * @param {string} [opts.fallback='—']
 * @param {boolean} [opts.forceDecimals=true] - forzar siempre N decimales (3,00).
 * @returns {string}
 */
export function formatParamValue(key, value, opts = {}) {
  const { withUnit = false, fallback = '—', forceDecimals = true } = opts;
  const spec = specFor(key);
  const num = formatNumber(value, {
    precision: spec.decimals,
    forceDecimals,
    thousands: spec.thousands,
    fallback,
  });
  if (num === fallback) return fallback;
  if (!withUnit || !spec.unit) return num;
  return `${num} ${spec.unit}`;
}

/**
 * Mapeo de **código normativo de ensayo** → clave canónica de precisión.
 *
 * Se usa al renderizar la tabla "Ensayos" del detalle del material, donde
 * cada fila tiene un `tipo.codigo` y un `r.valor` cuyo formato depende del
 * ensayo. Codigos típicos vienen del catálogo de AgregadoEnsayoTipo.
 *
 * Si un código no está acá, el caller debe usar la heurística por nombre
 * de campo (`r.pasa200Pct` → 'pasa200', etc.) o caer a default.
 */
export const CODIGO_TO_PARAM = Object.freeze({
  // Granulometría / módulos
  IRAM_1505: 'mf',
  GRANULOMETRIA: 'mf',
  // Densidad
  IRAM_1520: 'densidadReal',  // densidad fino — se muestran 3 valores; usar densidad genérica
  IRAM_1533: 'densidadReal',  // densidad grueso
  // Pasante #200
  IRAM_1540: 'pasa200',
  // Terrones
  IRAM_1647_TERRONES: 'terronesArcilla',
  IRAM_1647_FRIABLES: 'terronesArcilla',
  IRAM_1647_PARTICULAS: 'terronesArcilla',
  // Sulfatos / cloruros / sales / materia orgánica / carbonosas
  IRAM_1525: 'perdidaSulfato',
  IRAM_1547: 'sulfatosSO3',
  IRAM_1857: 'sulfatosSO3',
  IRAM_1882: 'cloruros',
  IRAM_1571: 'salesSolubles',
  IRAM_1512: 'materiaOrganica',
  IRAM_1840: 'materiasCarbonosas',
  // Equivalente de arena
  IRAM_1682: 'equivalenteArena',
  // PUC/PUS
  IRAM_1548: 'puc',
  // Lajosidad / Elongación
  IRAM_1687_LAJOSIDAD: 'lajosidad',
  IRAM_1687_ELONGACION: 'elongacion',
  // Los Ángeles / Polvo adherido
  IRAM_1532: 'losAngeles',
  IRAM_1539: 'polvoAdherido',
});

/**
 * Resuelve la clave canónica de precisión a partir del código de ensayo.
 *
 * @param {string} codigo
 * @returns {string|null}
 */
export function paramKeyForCodigo(codigo) {
  if (!codigo) return null;
  const upper = String(codigo).toUpperCase().replace(/[\s-]+/g, '_');
  if (CODIGO_TO_PARAM[upper]) return CODIGO_TO_PARAM[upper];
  // Heurísticas por substring
  if (upper.includes('GRANULOMETRIA') || upper.includes('1505')) return 'mf';
  if (upper.includes('1520') || upper.includes('1533') || upper.includes('DENSIDAD')) return 'densidadReal';
  if (upper.includes('1540') || upper.includes('PASA_200') || upper.includes('PASA200')) return 'pasa200';
  if (upper.includes('1647') || upper.includes('TERRONES') || upper.includes('FRIABLES') || upper.includes('CARBONOSAS')) {
    if (upper.includes('CARBONOSAS')) return 'materiasCarbonosas';
    return 'terronesArcilla';
  }
  if (upper.includes('1525') || upper.includes('SULFATO_SODIO') || upper.includes('PERDIDA_SULFATO')) return 'perdidaSulfato';
  if (upper.includes('1547') || upper.includes('1857') || upper.includes('SO3') || upper.includes('SULFATO')) return 'sulfatosSO3';
  if (upper.includes('1882') || upper.includes('CLORURO')) return 'cloruros';
  if (upper.includes('1571') || upper.includes('SALES_SOLUBLES')) return 'salesSolubles';
  if (upper.includes('1512') || upper.includes('MATERIA_ORGANICA')) return 'materiaOrganica';
  if (upper.includes('1682') || upper.includes('EQUIVALENTE')) return 'equivalenteArena';
  if (upper.includes('1548') || upper.includes('PUC') || upper.includes('PUS') || upper.includes('PESO_UNITARIO')) return 'puc';
  if (upper.includes('LAJOSIDAD')) return 'lajosidad';
  if (upper.includes('ELONGACION')) return 'elongacion';
  if (upper.includes('1532') || upper.includes('LOS_ANGELES')) return 'losAngeles';
  if (upper.includes('1539') || upper.includes('POLVO')) return 'polvoAdherido';
  return null;
}
