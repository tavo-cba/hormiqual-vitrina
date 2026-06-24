/**
 * Capa de formateo centralizada de HormiQual.
 *
 * Toda presentación de números, fechas, porcentajes, fórmulas químicas y enums
 * pasa por aquí. Reemplaza los formatters locales (fmtNum, fmtDate, tx) que
 * estaban duplicados en cada generador de PDF.
 *
 * Reglas canónicas (es-AR):
 * - Decimal: coma. Ej: 0,46
 * - Miles: SIN separador (evita ambigüedad "1.208 kg" que se lee como 1,208).
 *   Si el caso lo requiere, pasar { thousands: true }.
 * - Fecha display: DD/MM/YYYY
 * - Fecha + hora display: DD/MM/YYYY HH:mm
 * - Fecha para nombre de archivo: YYYYMMDD_HHmm
 *
 * Precisiones canónicas (PRECISION):
 * - a/c display: 2 decimales (0,46)
 * - a/c delta:   3 decimales (+0,003)
 * - Dosis aditivo en %: 2 decimales
 * - Dosis en kg/m³: 3 decimales
 * - Asentamiento: cm con 1 decimal
 */

export const BRAND_NAME = 'HormiQual';
export const LOCALE = 'es-AR';

/**
 * Precisiones canónicas por magnitud. Usar siempre que sea posible para
 * mantener consistencia entre secciones del mismo documento.
 */
export const PRECISION = Object.freeze({
  ac: 2,                  // Relación a/c en display (0,46)
  acDelta: 3,             // Diferencia de a/c (+0,003)
  dosisPct: 2,            // Dosis aditivo en % (0,30 %)
  dosisKgM3: 3,           // Dosis en kg/m³ (0,978 kg/m³)
  asentamientoCm: 1,      // Asentamiento (12,5 cm)
  aguaLm3: 1,             // Agua en L/m³ (177,4)
  cementoKgM3: 0,         // Cemento en kg/m³ (326)
  airePct: 1,             // Aire en % (5,2 %)
  resistenciaMpa: 1,      // f'c, f'cm (30,0 MPa)
  densidad: 0,            // kg/m³ (2650)
  porcentajeGenerico: 1,  // % genérico
  moduloFinura: 2,        // MF (2,85) — adimensional, 2 decimales por norma
});

/**
 * Formatea un número al locale es-AR con coma decimal y sin separador de miles
 * por default. Si value no es numérico finito (NaN, Infinity, undefined, null,
 * string vacío), devuelve el placeholder "—".
 *
 * @param {*} value
 * @param {Object} options
 * @param {number} [options.precision=2] - dígitos máximos después de la coma
 * @param {boolean} [options.forceDecimals=false] - si true, fuerza N decimales (0,46 vs 0,4)
 * @param {boolean} [options.thousands=false] - si true, agrega punto separador de miles
 * @param {string} [options.fallback='—'] - texto cuando value no es válido
 * @returns {string}
 */
export function formatNumber(value, options = {}) {
  const {
    precision = 2,
    forceDecimals = false,
    thousands = false,
    fallback = '\u2014',
  } = options;

  if (value == null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;

  const s = num.toLocaleString('en-US', {
    minimumFractionDigits: forceDecimals ? precision : 0,
    maximumFractionDigits: precision,
    useGrouping: thousands,
  });
  // Convertir separadores de en-US (1,234.56) a es-AR (1.234,56 si thousands, 1234,56 si no)
  return thousands
    ? s.replace(/,/g, '\u2002').replace('.', ',').replace(/\u2002/g, '.')
    : s.replace('.', ',');
}

/**
 * Formatea un porcentaje. Devuelve el número formateado seguido de " %".
 *
 * @param {*} value - el número (no multiplicar por 100; pasar el valor ya en %)
 * @param {Object} [options]
 * @param {number} [options.precision=PRECISION.porcentajeGenerico]
 * @returns {string}
 */
export function formatPercent(value, options = {}) {
  const { precision = PRECISION.porcentajeGenerico, ...rest } = options;
  const num = formatNumber(value, { precision, ...rest });
  if (num === '\u2014') return num;
  return `${num} %`;
}

// Adapter de measurement, importado dinámicamente sólo si se invoca
// formatComparable. Evita circular dep al carga (format ↔ measurement).
let _adaptCache = null;
function getAdapt() {
  if (!_adaptCache) {
    // Webpack soporta require sincrónico de módulos ya bundleados
    // eslint-disable-next-line global-require
    _adaptCache = require('../measurement').adapt;
  }
  return _adaptCache;
}

/**
 * Formatea un MeasuredValue (o cualquier input adaptable) preservando el
 * qualifier para valores censurados. NUNCA convierte un valor censurado a
 * número exacto: si entra "< 0,01 %" sale "< 0,01 %".
 *
 * Acepta cualquier input que adapt() entienda: MeasuredValue, formato legacy
 * `{ valor, esMenorQue, unidad }`, string `"< 500 ppm"`, número crudo, etc.
 *
 * @param {*} input - MeasuredValue, legacy, string o número
 * @param {Object} [options]
 * @param {number} [options.precision=2]
 * @returns {string} Ej: "< 0,01 %", "0,98 kg/m³", "—"
 */
export function formatComparable(input, options = {}) {
  const mv = getAdapt()(input);
  if (!mv || mv.value == null) return '\u2014';
  const { precision = 2 } = options;
  const num = formatNumber(mv.value, { precision });
  if (num === '\u2014') return num;
  const qualifierMap = {
    '<': '< ',
    '>': '> ',
    '<=': '<= ',
    '>=': '>= ',
    '\u2264': '<= ',
    '\u2265': '>= ',
    '=': '',
    null: '',
    undefined: '',
  };
  const prefix = qualifierMap[mv.qualifier] != null ? qualifierMap[mv.qualifier] : '';
  const unit = mv.unit ? ` ${mv.unit}` : '';
  return `${prefix}${num}${unit}`;
}

/**
 * Convierte una fórmula química a representación displayable.
 * Por ahora reemplaza subíndices/superíndices a ASCII porque jsPDF Helvetica
 * built-in no los soporta. Cuando incrustemos DejaVu Sans (Bloque P2.1), esta
 * función puede devolver el formato Unicode original.
 *
 * @param {string} formula - Ej: "SO3", "Na₂SO₄", "CO₂"
 * @returns {string}
 */
export function formatChemical(formula) {
  if (!formula) return '';
  return String(formula)
    // Subíndices Unicode → dígitos ASCII
    .replace(/\u2080/g, '0').replace(/\u2081/g, '1').replace(/\u2082/g, '2')
    .replace(/\u2083/g, '3').replace(/\u2084/g, '4').replace(/\u2085/g, '5')
    .replace(/\u2086/g, '6').replace(/\u2087/g, '7').replace(/\u2088/g, '8')
    .replace(/\u2089/g, '9')
    // Superíndices Unicode → dígitos ASCII
    .replace(/\u2070/g, '0').replace(/\u00B9/g, '1').replace(/\u00B2/g, '2')
    .replace(/\u00B3/g, '3').replace(/\u2074/g, '4').replace(/\u2075/g, '5')
    .replace(/\u2076/g, '6').replace(/\u2077/g, '7').replace(/\u2078/g, '8')
    .replace(/\u2079/g, '9');
}

/**
 * Mapea un valor de enum a su display label desde un diccionario.
 * Si el valor no está en el diccionario, devuelve el valor original
 * (no falla, para no ocultar enums nuevos sin traducción).
 *
 * @param {string} value - Ej: "ARENA_NATURAL"
 * @param {Object} dictionary - Ej: { ARENA_NATURAL: "Arena natural" }
 * @returns {string}
 */
export function formatEnum(value, dictionary) {
  if (value == null) return '\u2014';
  return dictionary?.[value] ?? String(value);
}

/**
 * Diccionario can\u00f3nico de subtipos de agregado. Source of truth \u00fanica \u2014
 * antes este diccionario estaba duplicado en agregadoFichaTecnicaPdf.js,
 * MaterialDetailPage.jsx y agregadoPanel.jsx con keys parcialmente
 * divergentes. Cualquier consumidor que muestre `meta.subtipoMaterial`
 * debe usar este diccionario v\u00eda `formatEnum`.
 *
 * Cubre los 6 valores reales del ENUM `AgregadoMeta.subtipoMaterial`:
 * arenas (3) + roca (3).
 */
export const SUBTIPO_AGREGADO_LABELS = Object.freeze({
  ARENA_NATURAL:        'Arena natural',
  ARENA_TRITURACION:    'Arena de trituraci\u00f3n',
  ARENA_MEZCLA:         'Mezcla (natural + trituraci\u00f3n)',
  CANTO_RODADO:         'Canto rodado',
  TRITURADO_NATURAL:    'Triturado natural',
  TRITURADO_ARTIFICIAL: 'Triturado artificial',
});

/**
 * Helper conveniencia para subtipos de agregado. Reemplaza directo el
 * patr\u00f3n `SUBTIPO_LABELS[value] || value` que estaba duplicado.
 */
export function formatSubtipoAgregado(value) {
  return formatEnum(value, SUBTIPO_AGREGADO_LABELS);
}

/**
 * Formatea una fecha al formato es-AR.
 *
 * @param {Date|string|number|null} date
 * @param {Object} [options]
 * @param {boolean} [options.withTime=false] - incluye HH:mm
 * @param {string} [options.fallback='—']
 * @returns {string} DD/MM/YYYY o DD/MM/YYYY HH:mm
 */
export function formatDate(date, options = {}) {
  const { withTime = false, fallback = '\u2014' } = options;
  if (date == null || date === '') return fallback;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return fallback;
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (!withTime) return datePart;
  return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Fecha formateada para nombres de archivo (sin caracteres problemáticos).
 *
 * @param {Date} [date=new Date()]
 * @returns {string} YYYYMMDD_HHmm
 */
export function formatDateFile(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Sanitiza texto para que jsPDF/Helvetica pueda renderizarlo.
 * Helvetica built-in solo soporta el rango Latin-1 (U+0000–U+00FF). Los
 * caracteres fuera de ese rango se mapean a equivalentes ASCII seguros.
 *
 * Cuando incrustemos DejaVu Sans (Bloque P2.1), la mayoría de estos reemplazos
 * dejan de ser necesarios. Dejar la función para compatibilidad y poder
 * desactivarla con un flag.
 *
 * @param {*} str
 * @param {Object} [options]
 * @param {boolean} [options.preserveUnicode=false] - si la fuente lo soporta, no sanitizar
 * @returns {string}
 */
export function sanitizePdfText(str, options = {}) {
  if (str == null) return '';
  // Defensa contra valores numéricos rotos que se colaron al renderer.
  // Antes aparecía literalmente "NaN %" en el certificado (P0.2 v2 audit).
  // Esta línea es el último filtro — si algún call site olvida normalizar,
  // acá se corta. Aplica SIEMPRE, incluso con preserveUnicode.
  if (typeof str === 'number' && !Number.isFinite(str)) return '\u2014';
  // Sesi\u00f3n 2026-05-28: `let` en vez de `const` para permitir reasignaci\u00f3n
  // tras la degradaci\u00f3n de sub\u00edndices Unicode m\u00e1s abajo.
  let s = String(str);
  if (s === 'NaN' || s === 'undefined' || s === 'null' || s === 'Infinity' || s === '-Infinity' || s === '[object Object]') {
    return '\u2014';
  }
  // Si la fuente DejaVu está cargada (P2.1) o el caller pidió preservar
  // Unicode, solo filtramos los tokens patológicos y devolvemos el resto
  // sin alteraciones.
  let useUnicode = options.preserveUnicode === true;
  if (!useUnicode) {
    try {
      // Lazy require para evitar dependencia circular (este módulo no debe
      // depender de dejavuFont en tiempo de import).
      // eslint-disable-next-line global-require
      const { hasDejavuLoaded } = require('./dejavuFont');
      if (hasDejavuLoaded()) useUnicode = true;
    } catch { /* dejavuFont no disponible — caer a sanitización Latin-1 */ }
  }
  // Sesi\u00f3n 2026-05-28 \u2014 los sub\u00edndices/super\u00edndices Unicode se degradan
  // SIEMPRE a d\u00edgitos ASCII, incluso si DejaVu est\u00e1 cargada. Motivo: varios
  // generadores (p.ej. `fichaMuestraPdf.js`) registran DejaVu pero despu\u00e9s
  // llaman a `doc.setFont('helvetica', ...)` directo en vez de `setFontSafe`,
  // as\u00ed que la fuente real de render sigue siendo Helvetica/WinAnsi. Si el
  // sanitizer preserva `R\u2087`/`R\u2082\u2088` confiando en DejaVu, jsPDF
  // intenta renderizar U+2087 (UTF-8 `E2 82 87`) byte por byte contra
  // Helvetica \u2192 cae a glifos de fallback (\u2021, \u201a, \u02c6) y mete
  // kerning an\u00f3malo letra por letra (problema reportado en test74.pdf \u00a7
  // "Interpretaci\u00f3n" donde `R\u2087/R\u2082\u2088` aparec\u00eda como
  // `R \u2021/R \u201a \u02c6` con espaciado roto). Los sub\u00edndices ASCII
  // (`R7`, `R28`) son normativa-equivalentes. Si en el futuro alg\u00fan PDF
  // quiere preservar sub\u00edndices y RENDERIZA con DejaVu, deber\u00eda pasar
  // `preserveUnicode: true` Y usar `setFontSafe` en todos los `setFont`.
  s = s
    .replace(/\u2080/g, '0').replace(/\u2081/g, '1').replace(/\u2082/g, '2')
    .replace(/\u2083/g, '3').replace(/\u2084/g, '4').replace(/\u2085/g, '5')
    .replace(/\u2086/g, '6').replace(/\u2087/g, '7').replace(/\u2088/g, '8')
    .replace(/\u2089/g, '9')
    // Superindices U+2070, U+00B9, U+2074..U+2079. U+00B2/B3 estan en
    // WinAnsi y jsPDF Helvetica los renderiza (kg/m3 con superindice).
    .replace(/\u2070/g, '0').replace(/\u00b9/g, '1')
    .replace(/\u2074/g, '4').replace(/\u2075/g, '5').replace(/\u2076/g, '6')
    .replace(/\u2077/g, '7').replace(/\u2078/g, '8').replace(/\u2079/g, '9')
    // Sesion 2026-05-28 (extension): los siguientes caracteres tampoco
    // estan en WinAnsi/cp1252 con su codepoint Unicode (algunos tienen un
    // glifo equivalente en 0x80-0x9F pero jsPDF no auto-mapea Unicode -> cp1252).
    // Sin esta degradacion, contra Helvetica producen mojibake byte por byte
    // que se ve como letras separadas con kerning roto. Ej.: el reporte del
    // usuario "Plastica (5,0 < A 'd 10,0 cm)" donde 'd' es lo que queda de
    // \u2264 (le-than-or-equal) tras el render fallido.
    .replace(/\u2248/g, '~')     // \u2248 ~
    .replace(/\u2264/g, '<=')    // \u2264 <=
    .replace(/\u2265/g, '>=')    // \u2265 >=
    .replace(/\u2192/g, '->')    // \u2192 ->
    .replace(/\u2190/g, '<-')    // \u2190 <-
    .replace(/\u25c4/g, '<<')    // \u25c4 <<
    .replace(/\u25ba/g, '>>')    // \u25ba >>
    .replace(/\u2212/g, '-')     // \u2212 minus sign (rompe kerning)
    .replace(/\u0394/g, 'D')     // \u0394 Delta
    .replace(/\u03b4/g, 'd')     // \u03b4 delta minuscula
    .replace(/\u03a3/g, 'S')     // \u03a3 Sigma
    .replace(/\u03c3/g, 's')     // \u03c3 sigma minuscula
    .replace(/\u03b1/g, 'a')     // \u03b1 alpha
    .replace(/\u03b2/g, 'b')     // \u03b2 beta
    .replace(/\u03b3/g, 'g');    // \u03b3 gamma

  if (useUnicode) {
    return s
      .replace(/\bNaN\b/g, '\u2014')
      .replace(/\bundefined\b/g, '\u2014')
      .replace(/\bInfinity\b/g, '\u2014')
      .replace(/\[object Object\]/g, '\u2014');
  }
  return s
    // Sanitizar ocurrencias de NaN/undefined/null/Infinity EMBEBIDAS en strings
    // (ej: "Resultado: NaN %" → "Resultado: — %"). Se usa \b para evitar
    // matchear palabras legítimas que los contengan como substring.
    .replace(/\bNaN\b/g, '\u2014')
    .replace(/\bundefined\b/g, '\u2014')
    .replace(/\bInfinity\b/g, '\u2014')
    .replace(/\[object Object\]/g, '\u2014')
    // Catch-all `[\u0100-\uFFFF]` final degradaba estos a vac\u00EDo hasta sesi\u00F3n
    // 2026-05-28: ahora los sub\u00EDndices/super\u00EDndices se reemplazan SIEMPRE
    // arriba (antes del branch useUnicode) para que jsPDF + Helvetica no
    // intente rendirlos byte por byte y no produzca mojibake `R\u2021`/`R\u201A\u02C6`
    // (ver comentario al inicio de esta funci\u00F3n).
    .replace(/\u2248/g, '~')     // ≈
    .replace(/\u2192/g, '->')    // →
    .replace(/\u2190/g, '<-')    // ←
    .replace(/\u25C4/g, '<<')    // ◄
    .replace(/\u25BA/g, '>>')    // ►
    .replace(/\u2212/g, '-')     // −  MINUS SIGN (causa artefactos de kerning)
    .replace(/\u2013/g, '-')     // –  EN DASH
    .replace(/\u2014/g, ' - ')   // —  EM DASH
    .replace(/\u2264/g, '<=')    // ≤
    .replace(/\u2265/g, '>=')    // ≥
    .replace(/\u00D7/g, 'x')     // ×
    .replace(/\u00F7/g, '/')     // ÷
    .replace(/\u2022/g, '-')     // •
    .replace(/\u2023/g, '>')     // ‣
    .replace(/\u0394/g, 'D')     // Δ
    .replace(/\u03B4/g, 'd')     // δ
    .replace(/\u03A3/g, 'S')     // Σ
    // P-V auditoria 08 (sesion 2026-05-08): letras griegas minusculas
    // comunes en informes de hormigon. Antes caian al wildcard final y
    // se eliminaban silenciosamente, dejando "(s)" o fallback Latin-1
    // que mostraba "A-tilde" en jsPDF.
    .replace(/\u03C3/g, 's')     // σ minuscula (desvio estandar)
    .replace(/\u03B1/g, 'a')     // α
    .replace(/\u03B2/g, 'b')     // β
    .replace(/\u03B3/g, 'g')     // γ
    .replace(/\u03BC/g, 'u')     // μ
    .replace(/\u2206/g, 'D')     // ∆
    .replace(/\u221A/g, 'V')     // √
    .replace(/\u00B7/g, '.')     // ·
    .replace(/\u2019/g, "'")     // ’
    .replace(/\u201C/g, '"')     // “
    .replace(/\u201D/g, '"')     // ”
    .replace(/\u2026/g, '...')   // …
    .replace(/[\u0100-\uFFFF]/g, '') // resto fuera de Latin-1 → quitar silencioso
    .replace(/(?<!\.)\.\.(?!\.)/g, '.'); // collapse exactly double periods
}

/**
 * Slug para nombres de archivo (alfanumérico + underscore).
 *
 * @param {string} str
 * @param {number} [maxLen=48]
 * @returns {string}
 */
export function slug(str, maxLen = 48) {
  return String(str || 'documento')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen);
}
