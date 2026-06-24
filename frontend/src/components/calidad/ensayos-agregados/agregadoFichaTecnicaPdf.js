import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  formatNumber,
  formatDate,
  formatDateFile,
  formatChemical,
  slug as slugFmt,
} from '../../../lib/format';
import { registerDejavuOnDoc, hasDejavuLoaded } from '../../../lib/format/dejavuFont';
import {
  getCategoriaPdfPresentation,
  getCategoriaPdfColor,
} from '../../../lib/compliance/pdfPresentation';
import { VEREDICTO } from '../../../lib/compliance';
import { getEnsayosFaltantes, getDisplayName as getEnsayoDisplayName } from '../../../lib/compliance/requisitosEnsayos';
// PR9.3 — modelo de evaluación dual (mirror del backend, modos PRESTACIONAL / PRESCRIPTIVO).
import {
  evaluarMaterial,
  MODO_PRESCRIPTIVO,
  MODO_PRESTACIONAL,
} from '../../../lib/evaluacion';

/* ───────── Categorización de hits cumple/CUMPLE en este archivo (Prompt 3 C9.3) ─────────
 *
 * (A) DISPLAY del veredicto al usuario — migrados al helper canónico:
 *     - Banner granulometría manual (Sección C, ~L480) — color/icon canónico
 *     - Bullets reglas CIRSOC §3.2.3.2 (Sección C, ~L890) — color/icon canónico,
 *       texto descriptivo con cláusula normativa preservado
 *     - Banner granulometría auto Tabla 3.5 (Sección C, ~L926) — color/icon canónico
 *     - Color de celda en tabla cumplimiento (didParseCell, ~L1268) — color canónico,
 *       texto técnico por celda preservado ('Cumple' / 'No cumple' / 'Atencion')
 *     - NUEVA Sección G — Veredicto del agregado (banner global + listas
 *       detalladas de razones / condiciones / observaciones / pendientes).
 *
 * (B) VOCABULARIO INTERNO del motor evaluador — preservado:
 *     - `rg.bandaAB === 'cumple_con_tolerancia'` etc. son strings emitidos por
 *       el evaluador granulométrico (ya canónico en backend desde Prompt 2).
 *       Se leen como dato y se traducen a categoría visual donde corresponde;
 *       el string crudo no es lo que ve el usuario.
 *
 * (C) VOCABULARIO TÉCNICO POR CELDA — preservado intencionalmente:
 *     - 'Cumple' / 'No cumple' / 'Atencion' / 'Sin dato' por requisito individual
 *       en la tabla de cumplimiento (Sección D). APTO/NO APTO se reserva al
 *       material entero (Sección G); por celda el vocabulario técnico es el
 *       más conciso y normativamente correcto en español.
 *
 * (D) REGLAS NORMATIVAS escritas como texto fijo — preservadas:
 *     - "(req. 2,3 a 3,1)", "(req. <= 45%)", "máx. 10 pp en tamices...",
 *       "<= 5,0 / 7,0", etc. Son cláusulas del pliego CIRSOC/IRAM, no veredictos.
 */

/* ════════════════════════════════════════════════════════
   Color palette
   ════════════════════════════════════════════════════════ */
const C = {
  primary:   [31, 97, 141],
  secondary: [52, 73, 94],
  accent:    [39, 174, 96],
  danger:    [192, 57, 43],
  lightBg:   [245, 247, 250],
  white:     [255, 255, 255],
  text:      [44, 62, 80],
  muted:     [127, 140, 141],
  headerBg:  [31, 97, 141],
};

/* ════════════════════════════════════════════════════════
   Helpers locales (wrappers del formatter centralizado)
   ════════════════════════════════════════════════════════ */
const fmtDate = () => formatDate(new Date(), { withTime: true });
const fmtDateFile = () => formatDateFile().split('_')[0]; // YYYYMMDD
const fmtDateShort = (dateStr) => formatDate(dateStr);
const slug = (str) => slugFmt(str || '', 40);
const round2 = (v) => (v != null ? Math.round(v * 100) / 100 : null);

/** Wrapper que mantiene la firma vieja: fmtNum(val, dec, unit). */
function fmtNum(val, dec = null, unit = '') {
  const n = Number(val);
  // Backward-compat: cuando dec es null, mostraba el número con thousands.
  // Ahora respetamos esa convención. Caso raro pero usado en la ficha vieja.
  const opts = dec != null
    ? { precision: dec, forceDecimals: true, thousands: true }
    : { precision: 6, thousands: true };
  // Si no es numérico finito y val no es null, devolvemos String(val) por compat.
  if (val != null && !Number.isFinite(n)) return String(val);
  const s = formatNumber(val, opts);
  return unit && s !== '\u2014' ? `${s} ${unit}` : s;
}

/** Sanitize fórmulas químicas y signos químicos comunes. */
function sanitizeUnicode(str) {
  if (!str) return str;
  return formatChemical(str)
    .replace(/\u207B/g, '-').replace(/\u207A/g, '+')
    .replace(/SO\u2084\u00B2\u207B/g, 'SO4(2-)')
    .replace(/Fe\u00B3\u207A/g, 'Fe3+')
    .replace(/Cl\u207B/g, 'Cl-');
}

/**
 * Notaci\u00F3n can\u00F3nica IRAM/ASTM de aberturas de tamiz. La columna num\u00E9rica del
 * PDF debe respetar esta notaci\u00F3n tal cual aparece en la norma \u2014 NO redondear
 * (ej: 4,75 != 4,8; 2,36 != 2,4). Las series IRAM tienen aberturas con 2-3
 * decimales que el lab cita literal en el certificado.
 */
const TAMIZ_NOTACION_NORMA = Object.freeze({
  0.075: '0,075',
  0.15:  '0,15',
  0.3:   '0,30',
  0.6:   '0,60',
  1.18:  '1,18',
  2.36:  '2,36',
  4.75:  '4,75',
  9.5:   '9,5',
  13.2:  '13,2',
  19:    '19',
  26.5:  '26,5',
  37.5:  '37,5',
  53:    '53',
  63:    '63',
  75:    '75',
});

/**
 * Formatea una abertura de tamiz respetando la notaci\u00F3n can\u00F3nica IRAM/ASTM
 * cuando coincide con un tamiz est\u00E1ndar; sino devuelve el valor SIN redondear.
 */
function fmtTamizAbertura(aberturaMm) {
  if (aberturaMm == null) return '-';
  const exact = TAMIZ_NOTACION_NORMA[aberturaMm];
  if (exact) return exact;
  // No-est\u00E1ndar: convertir sin redondear (ej. 8.0 -> "8", 1.234 -> "1,234").
  return String(aberturaMm).replace('.', ',');
}

async function fetchLogoBase64(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  try {
    const res = await fetch(thumbnailUrl, { mode: 'cors' });
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/**
 * Build a short source string from a caract entry.
 * Each caract field IS the fuente object: { valor, fechaEnsayo, laboratorio, nroInforme, idAgregadoEnsayo, estado }
 * Note: the field is fechaEnsayo (not fecha).
 */
function fuenteShort(entry) {
  if (!entry) return '—';
  if (entry.fuenteLegacy) return 'Ficha agregado (legacy)';
  const parts = [];
  // fechaEnsayo is the correct field name returned by getCaracterizacion src()
  if (entry.fechaEnsayo) parts.push(fmtDateShort(entry.fechaEnsayo));
  if (entry.laboratorio) parts.push(entry.laboratorio);
  if (entry.nroInforme)  parts.push(`#${entry.nroInforme}`);
  return parts.join(' · ') || '—';
}

/**
 * Códigos de granulometría aplicables a una FICHA DE HORMIGÓN. La variante
 * TBS usa huso DNV con tamices distintos a CIRSOC y NO debe aparecer acá.
 *
 * Mantener sincronizado con `domain/dosificacion/ensayosFuncionalesGuard.js`
 * (mismo principio, distinta capa).
 */
const GRANULOMETRIA_CODIGOS_HORMIGON = new Set([
  'IRAM1505_GRANULOMETRIA_HORMIGON',
  'IRAM1505_GRANULOMETRIA',                // legacy sin sufijo
  'IRAM1627_GRANULOMETRIA_ESPECIFICA',     // alias antiguo
]);

const GRANULOMETRIA_CODIGOS_TBS = new Set([
  'IRAM1505_GRANULOMETRIA_TBS',
]);

/**
 * Detect if an ensayo is a granulometría by tipo.nombre.
 * The plain ensayos list may not carry full resultado.granulometria.
 */
function isGranulometria(ensayo) {
  // PR9-fix: filtrar por c\u00f3digo de tipo (whitelist HORMIGON, blacklist TBS)
  // antes de caer al match por nombre. Antes el match era por
  // `nombre.includes('granulometria')`, que tambi\u00e9n inclu\u00eda
  // `IRAM1505_GRANULOMETRIA_TBS` (nombre legible: "Granulometr\u00eda (TBS)").
  // Si un agregado ten\u00eda ambos cargados, esta ficha t\u00e9cnica de hormig\u00f3n
  // terminaba renderizando los 3 puntos del huso DNV en lugar de la curva
  // CIRSOC completa. Bug confirmado en test22.pdf.
  const codigo = ensayo?.tipo?.codigo;
  if (codigo) {
    if (GRANULOMETRIA_CODIGOS_HORMIGON.has(codigo)) return true;
    if (GRANULOMETRIA_CODIGOS_TBS.has(codigo)) return false;
  }
  // Fallback (cat\u00e1logos legacy sin c\u00f3digo): por nombre, EXCLUYENDO TBS.
  const nombre = (ensayo?.tipo?.nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!nombre.includes('granulometria')) {
    return !!ensayo?.resultado?.granulometria;
  }
  if (nombre.includes('tbs') || nombre.includes('dnv') || nombre.includes('huso')) return false;
  return true;
}

/**
 * Find the most recent granulometría ensayo WITH its full resultado.
 * resumen.items[*].ultimoEnsayo carries the full resultado; the plain ensayos
 * list endpoint often only has partial data.
 */
function findGranulometriaEnsayo(ensayos, resumen) {
  // Helper: ¿el ensayo tiene código explícito de hormigón?
  const esCodigoHormigon = (it) => {
    const cod = it?.tipo?.codigo;
    return cod && GRANULOMETRIA_CODIGOS_HORMIGON.has(cod);
  };

  // PR9-fix test23 — Filtro defensivo por `contextoAplicacion` del ensayo
  // concreto (no del tipo display). El backend agrupa código `_HORMIGON` y
  // `_TBS` bajo el mismo canónico (`IRAM1505_GRANULOMETRIA`), así que un
  // item puede mostrar `tipo.codigo = _GRANULOMETRIA` (display HORMIGON)
  // pero su `ultimoEnsayo` provenir de un ensayo cargado bajo `_TBS`. El
  // backend ya prefiere ensayos de contexto compatible con el `uso` pedido,
  // pero acá descartamos defensivamente cualquier residuo de TBS.
  const esEnsayoTBS = (ensayo) => {
    const ctx = ensayo?.contextoAplicacion;
    return ctx === 'TBS';
  };

  if (resumen?.items) {
    // Prioridad 1 → item con código de whitelist HORMIGÓN cuyo ultimoEnsayo
    // NO sea TBS y tenga granulometría.
    let granItem = resumen.items.find(it => {
      if (!esCodigoHormigon(it)) return false;
      if (esEnsayoTBS(it.ultimoEnsayo)) return false;
      const r = safeJson(it.ultimoEnsayo?.resultado);
      return !!r.granulometria;
    });
    // Prioridad 2 → cualquier granulometría no-TBS (fallback por nombre/código).
    if (!granItem) {
      granItem = resumen.items.find(it => {
        if (!isGranulometria({ tipo: it.tipo })) return false;
        if (esEnsayoTBS(it.ultimoEnsayo)) return false;
        const r = safeJson(it.ultimoEnsayo?.resultado);
        return !!r.granulometria;
      });
    }
    if (granItem) return granItem.ultimoEnsayo;
  }
  // Fallback sobre el plain list.
  const matching = (ensayos || []).filter(isGranulometria).filter((e) => !esEnsayoTBS(e));
  if (!matching.length) return null;
  // Preferir whitelist HORMIGÓN si hay; sino, la más reciente del filtro.
  const hormigonOnly = matching.filter(esCodigoHormigon);
  const lista = hormigonOnly.length > 0 ? hormigonOnly : matching;
  return lista.sort((a, b) => new Date(b.fechaEnsayo) - new Date(a.fechaEnsayo))[0];
}

/**
 * Defensive: some API responses carry resultado as a double-encoded JSON string
 * (legacy DB rows stored stringified JSON). Always return a parsed object.
 */
function safeJson(val) {
  if (!val) return {};
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return val;
}

/**
 * IRAM alternative → standard abertura mapping (3 pairs from IRAM 1627).
 * If the user measured with an alternative sieve, we display the standard label
 * but keep the actual measured %pasa value intact (no interpolation).
 */
const ALT_TO_STD = { 50: 53, 25: 26.5, 12.5: 13.2, 4.8: 4.75, 2.4: 2.36, 13: 13.2 };

/** Canonical IRAM standard label for a given abertura (standard or alternative). */
function stdTamizLabel(aberturaMm) {
  const stdAb = ALT_TO_STD[aberturaMm] ?? aberturaMm;
  return `${stdAb} mm`;
}

/**
 * Extract sieve rows from a granulometría resultado.
 *
 * ALWAYS uses g.tamices (raw user-entered data) — never ev.series.medida,
 * which contains interpolated values at standard sieve positions and would
 * misrepresent what was actually measured.
 *
 * Alternative sieves (25, 50, 12.5 mm) are displayed with their standard
 * IRAM label (26.5, 53, 13.2 mm) while keeping the original measured value.
 *
 * Banda limits from ev.series are looked up using the standard abertura so
 * they still align with the remapped display label.
 *
 * Returns { rows, hasBanda, tmnMm, moduloFinura }
 */
function extractGranRows(g) {
  if (!g) return { rows: [], hasBanda: false, tmnMm: null, moduloFinura: null };

  const ev     = g.evaluacion;
  const series = ev?.series; // { medida, bandaMin, bandaMax } — present only when evaluated vs banda

  // Build banda limit maps keyed by the STANDARD abertura (after ALT→STD remap),
  // so limits align with the remapped display label.
  const bandaMin = series?.bandaMin || [];
  const bandaMax = series?.bandaMax || [];
  const minMap   = new Map(bandaMin.map(p => [String(ALT_TO_STD[p.aberturaMm] ?? p.aberturaMm), p.pasaPct]));
  const maxMap   = new Map(bandaMax.map(p => [String(ALT_TO_STD[p.aberturaMm] ?? p.aberturaMm), p.pasaPct]));
  const fueraSet = new Set((ev?.fueraDeBanda || []).map(f => String(ALT_TO_STD[f.aberturaMm] ?? f.aberturaMm)));
  const hasBanda = bandaMin.length > 0 || bandaMax.length > 0;

  // Use raw tamices — the actual measured values, nothing interpolated.
  const tamices = (g.tamices || []).filter(
    t => t.habilitado !== false && t.isNA !== true && t.pasaPct != null && t.pasaPct !== ''
  );

  if (tamices.length > 0) {
    // Build a lookup from measured tamices: stdAbertura → pasaPct
    const medidoMap = new Map();
    for (const t of tamices) {
      const stdAb = ALT_TO_STD[t.aberturaMm] ?? t.aberturaMm;
      medidoMap.set(stdAb, Number(t.pasaPct));
    }

    // Always show the full IRAM principal series
    const SERIE_IRAM = [63, 53, 37.5, 26.5, 19, 13.2, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15];
    const rows = SERIE_IRAM.map(ab => {
      const stdKey = String(ab);
      const pasa = medidoMap.get(ab) ?? null;
      return {
        tamiz:      `${ab} mm`,
        aberturaMm: ab,
        pasaPct:    pasa,
        limInf:     minMap.get(stdKey) ?? null,
        limSup:     maxMap.get(stdKey) ?? null,
        estado:     pasa != null && (minMap.has(stdKey) || maxMap.has(stdKey))
                      ? (fueraSet.has(stdKey) ? 'FUERA' : 'OK')
                      : null,
      };
    }).filter(r => {
      // Must have data or band limits
      if (r.pasaPct == null && r.limInf == null && r.limSup == null) return false;
      // Filter out trivial tamices above TMN (100% pasante, no limits)
      if (r.pasaPct === 100 && r.limInf == null && r.limSup == null) return false;
      return true;
    });

    const tmnMm       = ev?.calculos?.tmn?.valor       ?? g.reportado?.tmnMm       ?? null;
    const moduloFinura = ev?.calculos?.moduloFinura?.valor ?? g.reportado?.moduloFinura ?? null;
    return { rows, hasBanda, tmnMm, moduloFinura };
  }

  // No tamices data at all
  return {
    rows: [],
    hasBanda: false,
    tmnMm:       ev?.calculos?.tmn?.valor       ?? g.reportado?.tmnMm       ?? null,
    moduloFinura: ev?.calculos?.moduloFinura?.valor ?? g.reportado?.moduloFinura ?? null,
  };
}

function estadoInfo(estado) {
  switch (estado) {
    case 'VIGENTE':    return { label: 'Vigente' };
    case 'POR_VENCER': return { label: 'Por vencer' };
    case 'VENCIDO':    return { label: 'Vencido' };
    case 'SIN_DATOS':  return { label: 'Sin datos' };
    case 'LEGACY':     return { label: 'Ficha legacy' };
    default:           return { label: estado || '—' };
  }
}

/* ════════════════════════════════════════════════════════
   Public export
   ════════════════════════════════════════════════════════ */

/**
 * @param {Object} opts
 * @param {string}   opts.agregadoNombre
 * @param {string}   opts.agregadoTipo        — "Fino" | "Grueso" | null
 * @param {string}   opts.legacyAgregadoId
 * @param {Object}   opts.meta                — { subtipoMaterial, cantera, productor, nroExpediente, aptitudes? }
 * @param {Object}   opts.caract              — each field: { valor, fechaEnsayo, laboratorio, nroInforme, estado }
 * @param {Array}    opts.ensayos             — all ensayos (may have partial resultado)
 * @param {Object}   opts.resumen             — { items: [{ tipo, estado, ultimoEnsayo, compliance }], veredictoGlobal }
 *   - `resumen.veredictoGlobal` (Prompt 2 C10.5): ComplianceResult agregado del material.
 *   - `resumen.items[i].compliance` (Prompt 3 C6.5): ComplianceResult per ensayo.
 * @param {Object}   opts.contextoEvaluacion  — Prompt 3 C9.3, opcional. Contexto bajo el cual
 *   se evaluó la aptitud del material. Usado en la sección G para listar
 *   ensayos requeridos faltantes cuando el veredicto es EVALUACIÓN INCOMPLETA.
 *   Shape: { tipoAgregado: 'FINO'|'GRUESO', expuestoDesgaste?: bool,
 *            claseExposicion?: string, fceMpa?: number }
 * @param {string}   opts.contextoAgregado    — PR6: 'HORMIGON' | 'TBS' | 'AMBOS'.
 *   Default: 'HORMIGON'. Determina qué flag de obligatoriedad/aplicación se lee
 *   del catálogo (`obligatorioHormigon` vs `obligatorioTBS`, `aplicaAHormigon`
 *   vs `aplicaATBS`). Sin este parámetro la ficha asume hormigón — coherente
 *   con el caso típico (la mayoría de tenants usa solo hormigón).
 * @param {Object}   opts.sections
 * @param {string}   opts.logoUrl
 */
// PR9-fix test23 — exportar helpers para tests unitarios. NO romper la
// API pública (`generarFichaTecnicaAgregadoPdf` sigue siendo el entry point).
export const __test__ = {
  isGranulometria,
  findGranulometriaEnsayo,
  GRANULOMETRIA_CODIGOS_HORMIGON,
  GRANULOMETRIA_CODIGOS_TBS,
};

export async function generarFichaTecnicaAgregadoPdf(opts) {
  const {
    agregadoNombre = '',
    agregadoTipo   = null,
    legacyAgregadoId = '',
    meta     = {},
    caract   = {},
    ensayos  = [],
    resumen  = null,
    contextoEvaluacion = null,
    contextoAgregado = 'HORMIGON',
    sections = {},
    logoUrl,
    // Modo del documento (decisión 2026-05-28, supersedes PR9 2026-05-04):
    //   DESCRIPTIVO (default): lista los datos sin emitir valoración
    //     normativa. No renderiza secciones de Cumplimiento ni Veredicto.
    //     Dibuja la banda IRAM 1627 como referencia visual, sin marcar
    //     desvíos.
    //   NORMATIVO: evalúa contra la matriz CIRSOC/IRAM completa, sin
    //     filtros por catálogo. Sección Cumplimiento lista toda la matriz
    //     aplicable + faltantes; Sección Veredicto emite dictamen formal.
    // Acepta los strings viejos 'PRESCRIPTIVO' / 'PRESTACIONAL' como
    // back-compat (callers no migrados).
    modoEvaluacion = 'DESCRIPTIVO',
  } = opts;
  const _modoUpper = String(modoEvaluacion).toUpperCase();
  const _modoNorm = (_modoUpper === 'NORMATIVO' || _modoUpper === 'PRESCRIPTIVO')
    ? 'NORMATIVO'
    : 'DESCRIPTIVO';

  // PR6: helpers para resolver flags multi-contexto del tipo. Si el tipo
  // viene del backend con los nuevos campos (`aplicaAHormigon`, etc.), los
  // usamos. Para tenants legacy que aún no tengan los campos, fallback al
  // legacy `obligatorio` global como antes (degradación grácil).
  const _usaH = contextoAgregado === 'HORMIGON' || contextoAgregado === 'AMBOS';
  const _usaTBS = contextoAgregado === 'TBS' || contextoAgregado === 'AMBOS';
  const tipoAplicaAlCtx = (tipo) => {
    if (!tipo) return true;
    // Si el tipo no expone los nuevos flags, asumimos que aplica (legacy).
    const tieneFlagsMultiCtx = (tipo.aplicaAHormigon !== undefined || tipo.aplicaATBS !== undefined);
    if (!tieneFlagsMultiCtx) return true;
    if (_usaH && tipo.aplicaAHormigon) return true;
    if (_usaTBS && tipo.aplicaATBS) return true;
    return false;
  };
  const tipoEsObligatorioEnCtx = (tipo) => {
    if (!tipo) return false;
    const tieneFlagsMultiCtx = (tipo.obligatorioHormigon !== undefined || tipo.obligatorioTBS !== undefined);
    if (!tieneFlagsMultiCtx) {
      // PR9.0 — Legacy fallback: el campo global `obligatorio` debe ser
      // EXPLÍCITAMENTE true para considerarse obligatorio. Antes el default
      // era `tipo.obligatorio !== false`, que trataba `undefined`/`null`
      // como obligatorio y listaba como pendientes ensayos del catálogo
      // viejo sin flag declarado. Default seguro = NO obligatorio salvo
      // declaración explícita (modo PRESTACIONAL: el usuario es soberano
      // de qué exige).
      return tipo.obligatorio === true;
    }
    if (_usaH && tipo.obligatorioHormigon) return true;
    if (_usaTBS && tipo.obligatorioTBS) return true;
    return false;
  };

  const {
    identificacion  = true,
    caracterizacion = true,
    granulometria   = true,
    complementarios = true,   // "Ensayos realizados" (antes D, ahora dinámica)
    cumplimiento    = true,
    veredicto       = true,
    advertencia     = true,   // Última sección (después del veredicto)
  } = sections;
  // Numeración dinámica de secciones: cada vez que se renderiza una sección
  // emitida, se incrementa el contador y se asigna la próxima letra (A, B, C…).
  // Antes los letrazos estaban hardcoded ('A. Identificación', 'D. Ensayos…')
  // produciendo secuencias inconsistentes (E → Advertencia sin letra → G) cuando
  // alguna sección quedaba deshabilitada.
  let _sectionIndex = 0;
  const nextSectionLetter = () => String.fromCharCode(65 + _sectionIndex++);
  const sectionLabel = (titulo) => `${nextSectionLetter()}. ${titulo}`;

  const doc      = new jsPDF('p', 'mm', 'a4');
  // Prompt 3 C9.3 (Fix C post-smoke) — registrar DejaVu Sans para soportar
  // los glyphs Unicode del helper canónico (✓ ⚠ ✗ ○ ℹ —) usados en bullets
  // de granulometría (sección C) y en el banner del veredicto del agregado
  // (sección G). Mismo patrón que certificadoCumplimientoPdf.js. Si la fuente
  // no está precargada, setFont funciona normalmente con Helvetica + sanitizer Latin-1.
  registerDejavuOnDoc(doc);
  if (hasDejavuLoaded()) {
    const originalSetFont = doc.setFont.bind(doc);
    doc.setFont = function patchedSetFont(family, style, weight) {
      const fam = String(family || '').toLowerCase();
      if (fam === 'helvetica' || fam === 'arial') {
        const wantBold = style === 'bold' || style === 'bolditalic';
        const fonts = doc.getFontList();
        const target = wantBold && fonts.DejaVuSans && fonts.DejaVuSans.includes('bold')
          ? ['DejaVuSans', 'bold']
          : ['DejaVuSans', 'normal'];
        return originalSetFont(target[0], target[1], weight);
      }
      return originalSetFont(family, style, weight);
    };
  }
  const pageW    = doc.internal.pageSize.getWidth();
  const pageH    = doc.internal.pageSize.getHeight();
  const margin   = 14;
  const contentW = pageW - margin * 2;
  let y = 0;

  const logoData = await fetchLogoBase64(logoUrl);

  function checkPage(need) {
    if (y + need > pageH - 20) { doc.addPage(); y = 15; }
  }

  function sectionTitle(text) {
    checkPage(14);
    y += 4;
    doc.setFillColor(...C.primary);
    doc.roundedRect(margin, y, contentW, 8, 1.5, 1.5, 'F');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.white);
    doc.text(text, margin + 3, y + 5.6);
    y += 12;
    doc.setTextColor(...C.text);
    doc.setFont('Helvetica', 'normal');
  }

  function kvRow(label, value, indent = 0) {
    checkPage(6);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text(label, margin + 2 + indent, y);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...C.text);
    doc.text((value != null && value !== '') ? String(value) : '—', margin + 55 + indent, y);
    y += 5;
  }

  /* ══════════════════════════════════════════
     Header
     ══════════════════════════════════════════ */
  doc.setFillColor(...C.headerBg);
  doc.rect(0, 0, pageW, 34, 'F');

  if (logoData) {
    try { doc.addImage(logoData, 'PNG', margin, 5, 24, 24); } catch { /* ignore */ }
  }

  const titleX = logoData ? margin + 28 : margin + 2;

  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...C.white);
  doc.text('Ficha Técnica del Agregado', titleX, 14);

  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 220, 240);
  doc.text(agregadoNombre || `Agregado #${legacyAgregadoId}`, titleX, 21);

  if (agregadoTipo) {
    doc.setFontSize(8);
    doc.setFont('Helvetica', 'bold');
    const badgeColor = agregadoTipo === 'Fino' ? [52, 152, 219] : [243, 156, 18];
    const badgeW = doc.getTextWidth(agregadoTipo) + 6;
    doc.setFillColor(...badgeColor);
    doc.roundedRect(titleX, 24, badgeW, 6, 1.5, 1.5, 'F');
    doc.setTextColor(...C.white);
    doc.text(agregadoTipo, titleX + 3, 28.3);
  }

  doc.setFontSize(8);
  doc.setFont('Helvetica', 'normal');
  doc.setTextColor(180, 200, 220);
  const rightX = pageW - margin;
  doc.text(fmtDate(), rightX, 10, { align: 'right' });
  doc.text(`ID: ${legacyAgregadoId}`, rightX, 16, { align: 'right' });

  y = 36;

  // Banner del modo del documento (decisión 2026-05-28).
  //   Descriptivo: leyenda discreta azul. El documento muestra los datos
  //     del agregado sin emitir veredicto.
  //   Normativo: banner ámbar destacado. El documento evalúa contra la
  //     matriz CIRSOC/IRAM completa.
  //
  // Fix audit 2026-05-28 (banner overflow): texto largo se wrappea con
  // `splitTextToSize` y la altura de la caja se calcula dinámicamente.
  // Antes la caja era de altura fija y el texto del modo normativo
  // (~195 mm) desbordaba el ancho útil de ~182 mm.
  {
    const bannerInnerPad = 3;
    const bannerInnerW = (pageW - 2 * margin) - 2 * bannerInnerPad;
    const titleH = 4;
    const lineH = 3.4;
    const padBottom = 1.5;
    let titleText, descText, fillRGB, strokeRGB, textRGB;
    if (_modoNorm === 'NORMATIVO') {
      titleText = 'VERIFICACIÓN NORMATIVA ESTRICTA';
      descText = 'Evalúa contra la matriz CIRSOC 200:2024 + serie IRAM completa, sin filtros del plan de control de calidad de la planta productora. Apto para auditorías externas, licitaciones y contraste técnico.';
      fillRGB = [255, 243, 205];
      strokeRGB = [220, 170, 50];
      textRGB = [133, 100, 4];
    } else {
      titleText = 'FICHA TÉCNICA DESCRIPTIVA';
      descText = 'Documento descriptivo. Lista los datos del agregado (caracterización, ensayos realizados, granulometría) sin emitir valoración normativa. Para verificación contra CIRSOC 200:2024 + IRAM generar el documento en modo Normativo.';
      fillRGB = [232, 244, 250];
      strokeRGB = [180, 210, 230];
      textRGB = [60, 90, 120];
    }
    doc.setFontSize(7);
    doc.setFont('Helvetica', 'normal');
    const descLines = doc.splitTextToSize(descText, bannerInnerW);
    const bannerH = 1.5 + titleH + descLines.length * lineH + padBottom;
    doc.setFillColor(...fillRGB);
    doc.setDrawColor(...strokeRGB);
    doc.rect(margin, y, pageW - 2 * margin, bannerH, 'FD');
    doc.setFontSize(8);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(...textRGB);
    doc.text(titleText, margin + bannerInnerPad, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(descLines, margin + bannerInnerPad, y + 4 + titleH);
    y += bannerH + 2;
  }
  doc.setTextColor(...C.text);

  /* ══════════════════════════════════════════
     A) Identificación
     ══════════════════════════════════════════ */
  if (identificacion) {
    sectionTitle(sectionLabel('Identificación'));
    const SUBTIPO_LABELS = { ARENA_NATURAL: 'Arena natural', ARENA_TRITURACION: 'Arena de trituración', CANTO_RODADO: 'Canto rodado', TRITURADO_NATURAL: 'Triturado natural', TRITURADO_ARTIFICIAL: 'Triturado artificial' };
    kvRow('Nombre / descripción',  agregadoNombre       || '\u2014');
    kvRow('Tipo de agregado',      agregadoTipo         || '\u2014');
    kvRow('Tipo de arena / roca',  SUBTIPO_LABELS[meta?.subtipoMaterial] || meta?.subtipoMaterial || '\u2014');
    kvRow('Cantera / yacimiento',  meta?.cantera        || '—');
    kvRow('Productor / proveedor', meta?.productor      || '—');
    kvRow('N.º expediente',        meta?.nroExpediente  || '—');
    kvRow('ID interno',            legacyAgregadoId);
    y += 3;
  }

  /* ══════════════════════════════════════════
     B) Caracterización básica
     fix: caract[key] IS the fuente object — no .fuente sub-property
          field is fechaEnsayo (not fecha)
     ══════════════════════════════════════════ */
  if (caracterizacion && caract) {
    sectionTitle(sectionLabel('Caracterización básica'));

    // 7B: la unidad va en el VALOR, NO en el label. Convención de fichas
    // técnicas: el label describe la propiedad, el valor lleva su magnitud +
    // unidad. Antes se duplicaba ("TMN (mm) ... 13,20 mm").
    const caracterRows = [
      { label: 'TMN',                       key: 'tmnMm',                       unit: 'mm',   nota: 'Derivado de granulometría (IRAM 1505)' },
      { label: 'Módulo de finura',          key: 'moduloFinura',                unit: '',     nota: 'Derivado de granulometría (IRAM 1505)' },
      { label: 'Densidad aparente SSS',     key: 'densidadRelativaAparenteSSS', unit: 'g/cm³', nota: null },
      { label: 'Densidad aparente seca',    key: 'densidadRelativaAparenteSeca',unit: 'g/cm³', nota: null },
      { label: 'Densidad real',             key: 'densidadRelativaReal',        unit: 'g/cm³', nota: null },
      { label: 'Absorción',                 key: 'absorcionPct',                unit: '%',    nota: null },
      { label: 'Desgaste Los Ángeles',      key: 'desgasteLAPct',               unit: '%',    nota: null },
      { label: 'Lajosidad IRAM 1687',       key: 'lajosidadPct',                unit: '%',    nota: null },
      { label: 'Elongación IRAM 1687',      key: 'elongacionPct',               unit: '%',    nota: null },
      { label: 'Pasa tamiz N.º 200',        key: 'pasa200Pct',                  unit: '%',    nota: null },
    ];

    const tableData = caracterRows
      .filter(r => caract[r.key] != null)
      .map(r => {
        // caract[r.key] = { valor, fechaEnsayo, laboratorio, nroInforme, idAgregadoEnsayo, estado }
        const entry = caract[r.key];
        // Fix audit 2026-05-28 (B.3 \u2014 precisi\u00F3n absorci\u00F3n inconsistente):
        // absorci\u00F3n ahora 2 decimales en todas las secciones (B, D, E).
        // Antes B usaba 1 decimal ("1,0 %"), D y E usaban 2 ("1,00 %") \u2014
        // mismo valor con tres representaciones distintas en el mismo PDF.
        let dec;
        if (r.key === 'absorcionPct') dec = 2;
        else if (r.unit === 'mm') dec = 2;
        else if (r.unit === 'g/cm\u00B3') dec = 3;
        else if (r.unit === '%') dec = 1;
        else dec = 2;
        const val = entry?.valor != null
          ? fmtNum(entry.valor, dec, r.unit || '')
          : '\u2014';
        // FIX: entry IS the fuente object (no .fuente sub-object), field is fechaEnsayo
        const fuenteStr = fuenteShort(entry);
        return [r.label, val, fuenteStr];
      });

    if (tableData.length > 0) {
      doc.autoTable({
        startY: y,
        head: [['Propiedad', 'Valor', 'Fuente (ensayo)']],
        body: tableData,
        margin: { left: margin, right: margin },
        headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: C.text },
        alternateRowStyles: { fillColor: C.lightBg },
        columnStyles: {
          0: { cellWidth: 75 },
          1: { cellWidth: 28, halign: 'center' },
          2: { cellWidth: 'auto' },
        },
        theme: 'plain',
      });
      y = doc.lastAutoTable.finalY + 5;
    } else {
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text('Sin datos de caracterización disponibles.', margin + 2, y);
      y += 8;
    }
  }

  /* ══════════════════════════════════════════
     C) Granulometría
     fix: fall back to g.tamices when ev.series.medida is empty
          (ensayo without banda objective selected)
     ══════════════════════════════════════════ */
  if (granulometria) {
    // 7C — Bloque atómico: header + ref ensayo + tabla + summary + gráfico
    // viven en la misma página. Sin esto, el header `sectionTitle` se dibujaba
    // al final de pág 1 y la tabla/gráfico saltaban a pág 2 (header huérfano).
    // Calculamos `granEnsayo` y `rows` ANTES del sectionTitle para estimar el
    // espacio total y, si no entra, saltamos de página primero.
    const granEnsayo = findGranulometriaEnsayo(ensayos, resumen);
    if (granEnsayo) {
      const resultadoTmp = safeJson(granEnsayo.resultado);
      const gTmp = resultadoTmp.granulometria;
      const rowsTmp = extractGranRows(gTmp).rows;
      // Estimación: 14 (sectionTitle) + 10 (ref+lab) + tabla (rows*5 + 8) +
      // 6 (summary TMN/MF) + 60 (gráfico) + 6 margen.
      const estTotal = 14 + 10 + (rowsTmp.length * 5 + 8) + 6 + 60 + 6;
      if (y + estTotal > pageH - 20 && estTotal < pageH - 30) {
        doc.addPage();
        y = 15;
      }
    }

    sectionTitle(sectionLabel('Granulometría'));

    if (granEnsayo) {
      // safeJson handles double-encoded resultado (legacy DB rows)
      const resultado = safeJson(granEnsayo.resultado);
      const g = resultado.granulometria;
      const { rows, hasBanda, tmnMm, moduloFinura } = extractGranRows(g);

      // Reference ensayo header
      checkPage(12);
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      doc.setFontSize(7.5);
      const normaRef = granEnsayo.tipo?.normaRef || 'IRAM 1505';
      const refLine = `${normaRef}  |  ${fmtDateShort(granEnsayo.fechaEnsayo)}  |  ${granEnsayo.nroInforme || '\u2014'}`;
      doc.text(refLine, margin + 2, y);
      y += 4;
      if (granEnsayo.laboratorio) {
        doc.setTextColor(...C.muted);
        doc.setFontSize(7);
        doc.text(`Lab.: ${granEnsayo.laboratorio}`, margin + 2, y);
        y += 4;
      }

      if (!hasBanda && !g?.evaluacionAuto && !g?.evaluacionAutoGrueso) {
        // Only show "no evaluation" if there's truly no evaluation at all
        doc.setFontSize(7);
        doc.setTextColor(...C.muted);
        doc.text('Sin evaluacion contra banda normativa.', margin + 2, y);
        y += 5;
      } else if (hasBanda) {
        // PR8.10 — Reorganización: "Conformidad granulométrica IRAM 1627:1997"
        // (la verificación adicional CIRSOC §3.2.3.2 se renderiza más abajo).
        const ev = g?.evaluacion;
        if (ev) {
          doc.setFontSize(7.5);
          // Prompt 3 C9.3: color canónico desde el ev (estado puede ser
          // 'CUMPLE' / 'INCOMPLETO' / otro; cumple es boolean fallback).
          const evCumple = ev.cumple || ev.estado === 'CUMPLE';
          const evCategoria = ev.estado === 'INCOMPLETO'
            ? VEREDICTO.EVALUACION_INCOMPLETA
            : (evCumple ? VEREDICTO.APTO : VEREDICTO.NO_APTO);
          doc.setTextColor(...getCategoriaPdfColor(evCategoria));
          const bandaNombre = g.objetivo?.nombre || 'IRAM 1627';
          const evText = evCumple
            ? `Conformidad granulométrica IRAM 1627:1997 (${bandaNombre}) — Cumple`
            : `Conformidad granulométrica IRAM 1627:1997 (${bandaNombre}) — No cumple (${ev.stats?.nFuera || 0} tamiz/es fuera, desvío: ${ev.stats?.peorDesvioPct || 0}%)`;
          doc.text(evText, margin + 2, y);
          doc.setTextColor(...C.text);
          y += 5;
        }
      }

      if (rows.length > 0) {
        // Build band lookups from auto-evaluation
        const autoAB = g?.evaluacionAuto?.bandaAB?.detalle || [];
        const autoAC = g?.evaluacionAuto?.bandaAC?.detalle || [];
        const autoG = g?.evaluacionAutoGrueso?.detalle || [];
        const abMap = new Map(autoAB.map(d => [d.aberturaMm, d]));
        const acMap = new Map(autoAC.map(d => [d.aberturaMm, d]));
        const agMap = new Map(autoG.map(d => [d.aberturaMm, d]));
        const hasAutoFino = autoAB.length > 0;
        const hasAutoGrueso = autoG.length > 0;
        const showBandCols = hasBanda || hasAutoFino || hasAutoGrueso;

        // Build columns dynamically
        let head;
        if (hasAutoFino) {
          head = ['Tamiz', '% Pasa', 'A-B inf', 'A-B sup', 'A-B', 'A-C sup', 'A-C'];
        } else if (showBandCols) {
          head = ['Tamiz', 'Abertura (mm)', 'Pasa (%)', 'Lim. inf.', 'Lim. sup.', 'Estado'];
        } else {
          head = ['Tamiz', 'Abertura (mm)', 'Pasa (%)'];
        }

        // M7 (auditoría 01-calidad): se quitó `round2(...)` previo a `fmtNum(..., 1, '%')`.
        // El doble redondeo (2 dec → 1 dec) podía cambiar el último dígito en
        // valores con .X45 (ej: 12,345 → round2 → 12,35 → fmtNum(1) → 12,4
        // vs fmtNum(1) directo → 12,3). fmtNum ya redondea internamente.
        const body = rows.map(p => {
          if (hasAutoFino) {
            const ab = abMap.get(p.aberturaMm);
            const ac = acMap.get(p.aberturaMm);
            return [
              p.tamiz,
              p.pasaPct != null ? fmtNum(p.pasaPct, 1, '%') : '-',
              ab ? fmtNum(ab.limInf, 0) : '-',
              ab ? fmtNum(ab.limSup, 0) : '-',
              ab?.estado || '-',
              ac ? fmtNum(ac.limSup, 0) : '-',
              ac?.estado || '-',
            ];
          }

          const base = [
            p.tamiz,
            // 7A: notación IRAM/ASTM exacta — NO redondear (4,75 != 4,8).
            fmtTamizAbertura(p.aberturaMm),
            p.pasaPct != null ? fmtNum(p.pasaPct, 1, '%') : '-',
          ];
          if (showBandCols) {
            const gd = agMap.get(p.aberturaMm);
            base.push(
              p.limInf != null ? fmtNum(p.limInf, 1, '%') : (gd ? fmtNum(gd.limInf, 0) : '-'),
              p.limSup != null ? fmtNum(p.limSup, 1, '%') : (gd ? fmtNum(gd.limSup, 0) : '-'),
              p.estado || gd?.estado || '-',
            );
          }
          return base;
        });

        // Mantener tabla de tamices + summary (TMN/MF) + gráfico granulométrico
        // juntos en la misma página: si no entran todos, saltamos antes del
        // título de la tabla. Estimación conservadora: ~5mm por fila + header
        // + ~6mm summary + ~60mm gráfico (chart 50 + margen 10).
        const estTableH   = (body.length + 1) * 5 + 4;
        const estSummaryH = 6;
        const estChartH   = 60;
        const estTotalH   = estTableH + estSummaryH + estChartH + 6;
        if (y + estTotalH > pageH - 20 && estTotalH < pageH - 30) {
          doc.addPage();
          y = 15;
        }

        // M8 (auditoría 01-calidad): columnStyles fijos para que el ancho de
        // columnas no se reasigne dinámicamente según contenido. La path
        // hasAutoFino tiene 7 columnas (Tamiz / % Pasa / 4 columnas A-B/A-C
        // / Estado A-C); las otras paths tienen 3 o 6 columnas.
        const columnStyles = hasAutoFino
          ? {
              0: { cellWidth: 22 }, // Tamiz
              1: { cellWidth: 22, halign: 'right' }, // % Pasa
              2: { cellWidth: 22, halign: 'right' }, // A-B inf
              3: { cellWidth: 22, halign: 'right' }, // A-B sup
              4: { cellWidth: 22, halign: 'center' }, // A-B
              5: { cellWidth: 22, halign: 'right' }, // A-C sup
              6: { cellWidth: 'auto', halign: 'center' }, // A-C
            }
          : showBandCols
            ? {
                0: { cellWidth: 24 }, // Tamiz
                1: { cellWidth: 24, halign: 'right' }, // Abertura mm
                2: { cellWidth: 24, halign: 'right' }, // Pasa %
                3: { cellWidth: 24, halign: 'right' }, // Lim. inf
                4: { cellWidth: 24, halign: 'right' }, // Lim. sup
                5: { cellWidth: 'auto', halign: 'center' }, // Estado
              }
            : {
                0: { cellWidth: 30 }, // Tamiz
                1: { cellWidth: 30, halign: 'right' }, // Abertura mm
                2: { cellWidth: 'auto', halign: 'right' }, // Pasa %
              };

        doc.autoTable({
          startY: y,
          head: [head],
          body,
          margin: { left: margin, right: margin },
          headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8, textColor: C.text },
          alternateRowStyles: { fillColor: C.lightBg },
          columnStyles,
          didParseCell: (data) => {
            if (data.section === 'body') {
              const raw = data.cell.raw;
              if (raw === 'FUERA') data.cell.styles.textColor = C.danger;
              if (raw === 'OK')    data.cell.styles.textColor = C.accent;
            }
          },
          theme: 'plain',
        });
        y = doc.lastAutoTable.finalY + 4;

        // Summary: TMN & MF
        const summaryParts = [];
        if (tmnMm      != null) summaryParts.push(`TMN: ${round2(tmnMm)} mm`);
        if (moduloFinura != null) summaryParts.push(`MF: ${round2(moduloFinura)}`);
        if (summaryParts.length) {
          checkPage(8);
          doc.setFontSize(8);
          doc.setFont('Helvetica', 'bold');
          doc.setTextColor(...C.muted);
          doc.text(summaryParts.join('   |   '), margin + 2, y);
          doc.setFont('Helvetica', 'normal');
          y += 6;
        }

        // ── Gráfico granulométrico ──
        if (rows.length >= 2) {
          const chartH = 50; // mm
          const chartW = contentW;
          checkPage(chartH + 10);

          const chartX = margin;
          const chartY = y;

          // Data: filter rows with valid pasaPct, sort by abertura desc
          const dataPoints = rows
            .filter(p => p.aberturaMm > 0 && p.pasaPct != null)
            .sort((a, b) => a.aberturaMm - b.aberturaMm);

          if (dataPoints.length >= 2) {
            // Chart area with left margin for Y labels and bottom margin for X labels + legend
            const yLabelW = 8;   // space for Y-axis labels
            const xLabelH = 6;   // space for X-axis labels
            const legendH = 6;   // space for legend row
            const plotX = chartX + yLabelW;
            const plotW = chartW - yLabelW;
            const plotH = chartH - 2;

            // Extend axis range to include band tamices (e.g. 9.5mm for fino bands)
            let axisMinAb = dataPoints[0].aberturaMm;
            let axisMaxAb = dataPoints[dataPoints.length - 1].aberturaMm;
            const autoEvalCheck = g?.evaluacionAuto;
            const autoEvalGCheck = g?.evaluacionAutoGrueso;
            if (autoEvalCheck?.bandaAB?.detalle?.length) {
              for (const d of autoEvalCheck.bandaAB.detalle) {
                if (d.aberturaMm < axisMinAb) axisMinAb = d.aberturaMm;
                if (d.aberturaMm > axisMaxAb) axisMaxAb = d.aberturaMm;
              }
            }
            if (autoEvalGCheck?.detalle?.length) {
              for (const d of autoEvalGCheck.detalle) {
                if (d.aberturaMm < axisMinAb) axisMinAb = d.aberturaMm;
                if (d.aberturaMm > axisMaxAb) axisMaxAb = d.aberturaMm;
              }
            }
            // Also extend from manual band rows
            for (const r of rows) {
              if ((r.limInf != null || r.limSup != null) && r.aberturaMm > 0) {
                if (r.aberturaMm < axisMinAb) axisMinAb = r.aberturaMm;
                if (r.aberturaMm > axisMaxAb) axisMaxAb = r.aberturaMm;
              }
            }

            const minAb = Math.log10(Math.max(0.1, axisMinAb));
            const maxAb = Math.log10(axisMaxAb);
            const abRange = maxAb - minAb || 1;

            const toX = (abMm) => plotX + ((Math.log10(abMm) - minAb) / abRange) * plotW;
            const toY = (pct) => chartY + plotH - (pct / 100) * plotH;

            // Background
            doc.setFillColor(252, 252, 252);
            doc.rect(plotX, chartY, plotW, plotH, 'F');

            // Grid lines
            doc.setDrawColor(230, 230, 230);
            doc.setLineWidth(0.1);
            for (let pct = 0; pct <= 100; pct += 10) {
              doc.line(plotX, toY(pct), plotX + plotW, toY(pct));
            }

            // Y-axis labels (left of plot)
            doc.setFontSize(5.5);
            doc.setTextColor(...C.muted);
            for (let pct = 0; pct <= 100; pct += 20) {
              doc.text(`${pct}%`, plotX - 1.5, toY(pct) + 1.2, { align: 'right' });
            }

            // X-axis: vertical grid + labels below plot
            // Collect all unique aberturas from data + bands for axis labels.
            // Notación IRAM canónica: usamos `fmtTamizAbertura` (7A) — el mapa
            // local fue eliminado a favor del helper de módulo.
            const allAberturas = new Set(dataPoints.map(p => p.aberturaMm));
            if (autoEvalCheck?.bandaAB?.detalle) autoEvalCheck.bandaAB.detalle.forEach(d => allAberturas.add(d.aberturaMm));
            if (autoEvalGCheck?.detalle) autoEvalGCheck.detalle.forEach(d => allAberturas.add(d.aberturaMm));
            rows.forEach(r => { if ((r.limInf != null || r.limSup != null) && r.aberturaMm > 0) allAberturas.add(r.aberturaMm); });
            const sortedAberturas = [...allAberturas].filter(a => a >= axisMinAb && a <= axisMaxAb).sort((a, b) => a - b);

            doc.setFontSize(5.5);
            for (const ab of sortedAberturas) {
              const x = toX(ab);
              doc.setDrawColor(235, 235, 235);
              doc.setLineWidth(0.1);
              doc.line(x, chartY, x, chartY + plotH);
              doc.setTextColor(...C.muted);
              doc.text(fmtTamizAbertura(ab), x, chartY + plotH + 3, { align: 'center' });
            }
            // X-axis title
            doc.setFontSize(5);
            doc.setTextColor(...C.muted);
            doc.text('Abertura (mm)', plotX + plotW / 2, chartY + plotH + xLabelH, { align: 'center' });

            // Banda curve letters from evaluacion
            const ev = g?.evaluacion;
            const minLetter = ev?.objetivo?.curvaMin?.curveLetter || 'A';
            const maxLetter = ev?.objetivo?.curvaMax?.curveLetter || 'B';

            // Banda curves — from manual evaluation OR from auto-evaluation
            const autoEval = g?.evaluacionAuto;
            const autoEvalG = g?.evaluacionAutoGrueso;
            const hasAutoEvalBands = autoEval?.bandaAB?.detalle?.length >= 2;
            const hasAutoEvalGrueso = autoEvalG?.detalle?.length >= 2;
            const drawBands = hasBanda || hasAutoEvalBands || hasAutoEvalGrueso;

            if (drawBands) {
              let bandaMinPts, bandaMaxPts;

              if (hasBanda) {
                // From manual evaluation rows
                bandaMinPts = rows.filter(p => p.limInf != null && p.aberturaMm > 0).sort((a, b) => a.aberturaMm - b.aberturaMm);
                bandaMaxPts = rows.filter(p => p.limSup != null && p.aberturaMm > 0).sort((a, b) => a.aberturaMm - b.aberturaMm);
              } else if (hasAutoEvalBands) {
                // From auto-evaluation A-B band
                const abDet = autoEval.bandaAB.detalle.sort((a, b) => a.aberturaMm - b.aberturaMm);
                bandaMinPts = abDet.map(d => ({ aberturaMm: d.aberturaMm, limInf: d.limInf }));
                bandaMaxPts = abDet.map(d => ({ aberturaMm: d.aberturaMm, limSup: d.limSup }));
              } else if (hasAutoEvalGrueso) {
                const gDet = autoEvalG.detalle.sort((a, b) => a.aberturaMm - b.aberturaMm);
                bandaMinPts = gDet.map(d => ({ aberturaMm: d.aberturaMm, limInf: d.limInf }));
                bandaMaxPts = gDet.map(d => ({ aberturaMm: d.aberturaMm, limSup: d.limSup }));
              }

              if (bandaMinPts?.length >= 2 && bandaMaxPts?.length >= 2) {
                // ── Sombreado entre bandas (fill between min and max) ──
                // Use light green color (simulates transparency on white background)
                doc.setFillColor(220, 245, 225);
                doc.setDrawColor(220, 245, 225);
                doc.setLineWidth(0.05);
                for (let i = 0; i < Math.min(bandaMinPts.length, bandaMaxPts.length) - 1; i++) {
                  const x1 = toX(bandaMinPts[i].aberturaMm);
                  const x2 = toX(bandaMinPts[i+1].aberturaMm);
                  const yMinA = toY(bandaMinPts[i].limInf);
                  const yMinB = toY(bandaMinPts[i+1].limInf);
                  const yMaxA = toY(bandaMaxPts[i].limSup);
                  const yMaxB = toY(bandaMaxPts[i+1].limSup);
                  doc.triangle(x1, yMaxA, x2, yMaxB, x1, yMinA, 'F');
                  doc.triangle(x2, yMaxB, x2, yMinB, x1, yMinA, 'F');
                }

                // Curva A (min) — green dashed
                doc.setDrawColor(34, 139, 34);
                doc.setLineWidth(0.25);
                doc.setLineDashPattern([1.2, 0.8], 0);
                for (let i = 1; i < bandaMinPts.length; i++) {
                  doc.line(toX(bandaMinPts[i-1].aberturaMm), toY(bandaMinPts[i-1].limInf), toX(bandaMinPts[i].aberturaMm), toY(bandaMinPts[i].limInf));
                }
                doc.setLineDashPattern([], 0);

                // Curva B/C (max) — orange dashed
                doc.setDrawColor(200, 100, 30);
                doc.setLineWidth(0.25);
                doc.setLineDashPattern([1.2, 0.8], 0);
                for (let i = 1; i < bandaMaxPts.length; i++) {
                  doc.line(toX(bandaMaxPts[i-1].aberturaMm), toY(bandaMaxPts[i-1].limSup), toX(bandaMaxPts[i].aberturaMm), toY(bandaMaxPts[i].limSup));
                }
                doc.setLineDashPattern([], 0);

                // Also draw Curva C if auto-eval has A-C data (for fino)
                if (hasAutoEvalBands && autoEval.bandaAC?.detalle?.length >= 2) {
                  const acDet = autoEval.bandaAC.detalle.sort((a, b) => a.aberturaMm - b.aberturaMm);
                  doc.setDrawColor(180, 180, 50); // yellowish for C
                  doc.setLineWidth(0.2);
                  doc.setLineDashPattern([0.8, 0.6], 0);
                  for (let i = 1; i < acDet.length; i++) {
                    doc.line(toX(acDet[i-1].aberturaMm), toY(acDet[i-1].limSup), toX(acDet[i].aberturaMm), toY(acDet[i].limSup));
                  }
                  doc.setLineDashPattern([], 0);
                }
              }
            }

            // Measured curve (solid blue, thicker)
            doc.setDrawColor(37, 99, 235);
            doc.setLineWidth(0.5);
            for (let i = 1; i < dataPoints.length; i++) {
              doc.line(
                toX(dataPoints[i-1].aberturaMm), toY(dataPoints[i-1].pasaPct),
                toX(dataPoints[i].aberturaMm), toY(dataPoints[i].pasaPct)
              );
            }

            // Build set of "fuera" aberturas from auto-eval A-B band
            const fueraAutoSet = new Set();
            // Only use auto-eval fuera points if there's no manual band evaluation
            if (!hasBanda) {
              if (hasAutoEvalBands) {
                for (const d of (autoEval.bandaAB?.detalle || [])) {
                  if (d.estado === 'FUERA') fueraAutoSet.add(d.aberturaMm);
                }
              }
              if (hasAutoEvalGrueso) {
                for (const d of (autoEvalG.detalle || [])) {
                  if (d.estado === 'FUERA') fueraAutoSet.add(d.aberturaMm);
                }
              }
            }

            // Points on measured curve
            for (const p of dataPoints) {
              const px = toX(p.aberturaMm);
              const py = toY(p.pasaPct);
              const isFuera = p.estado === 'FUERA' || fueraAutoSet.has(p.aberturaMm);
              doc.setFillColor(...(isFuera ? C.danger : [34, 197, 94]));
              doc.circle(px, py, 0.7, 'F');
            }

            // ── Legend row (below X-axis labels, well separated) ──
            const legendY = chartY + plotH + xLabelH + 3;
            doc.setFontSize(6);
            doc.setFont('Helvetica', 'normal');
            let lx = plotX;

            // Medida
            doc.setDrawColor(37, 99, 235);
            doc.setLineWidth(0.5);
            doc.line(lx, legendY - 0.5, lx + 5, legendY - 0.5);
            doc.setFillColor(37, 99, 235);
            doc.circle(lx + 2.5, legendY - 0.5, 0.5, 'F');
            doc.setTextColor(37, 99, 235);
            doc.text('Medida', lx + 7, legendY);
            lx += 28;

            if (drawBands) {
              // Curva A
              doc.setDrawColor(34, 139, 34);
              doc.setLineWidth(0.25);
              doc.setLineDashPattern([1, 0.6], 0);
              doc.line(lx, legendY - 0.5, lx + 5, legendY - 0.5);
              doc.setLineDashPattern([], 0);
              doc.setTextColor(34, 139, 34);
              doc.text('Curva A', lx + 7, legendY);
              lx += 25;

              // Curva B
              doc.setDrawColor(200, 100, 30);
              doc.setLineWidth(0.25);
              doc.setLineDashPattern([1, 0.6], 0);
              doc.line(lx, legendY - 0.5, lx + 5, legendY - 0.5);
              doc.setLineDashPattern([], 0);
              doc.setTextColor(200, 100, 30);
              doc.text('Curva B', lx + 7, legendY);
              lx += 25;

              // Curva C (if fino auto-eval)
              if (hasAutoEvalBands && autoEval?.bandaAC?.detalle?.length >= 2) {
                doc.setDrawColor(180, 180, 50);
                doc.setLineWidth(0.2);
                doc.setLineDashPattern([0.8, 0.6], 0);
                doc.line(lx, legendY - 0.5, lx + 5, legendY - 0.5);
                doc.setLineDashPattern([], 0);
                doc.setTextColor(180, 180, 50);
                doc.text('Curva C', lx + 7, legendY);
                lx += 25;
              }

              // Fuera indicator
              doc.setFillColor(...C.danger);
              doc.circle(lx + 2, legendY - 0.5, 0.5, 'F');
              doc.setTextColor(...C.danger);
              doc.text('Fuera de banda', lx + 5, legendY);
            }

            doc.setTextColor(...C.text);
            doc.setDrawColor(...C.text);
            doc.setLineWidth(0.2);
            y = legendY + legendH;
          }
        }
      } else {
        // Has granulometría ensayo but resultado has no sieve data at all
        checkPage(8);
        doc.setFontSize(8);
        doc.setTextColor(...C.muted);
        doc.text('El ensayo no tiene datos de tamizado registrados.', margin + 2, y);
        y += 8;
      }
      // ── Auto-evaluation results (FINO: A-B & A-C, GRUESO: Tabla 3.5) ──
      //
      // Decisión 2026-05-28: en modo DESCRIPTIVO las verificaciones
      // normativas (banda IRAM 1627, §3.2.3.2 CIRSOC, Tabla 3.5, MF rule)
      // se omiten. El gráfico de la curva sobre las bandas ya se dibujó
      // arriba como referencia visual; el lector compara y decide. En
      // DESCRIPTIVO agregamos solo una nota al pie aclaratoria.
      const ea = g?.evaluacionAuto;
      const eag = g?.evaluacionAutoGrueso;

      if (_modoNorm === 'DESCRIPTIVO') {
        checkPage(8);
        y += 1;
        doc.setFontSize(7);
        doc.setFont('Helvetica', 'italic');
        doc.setTextColor(...C.muted);
        const nota = doc.splitTextToSize(
          'Bandas IRAM 1627 graficadas como referencia. La verificación de cumplimiento contra las bandas y los requisitos CIRSOC §3.2.3.2 se emite en modo Normativo.',
          contentW - 4
        );
        for (const ln of nota) {
          checkPage(4);
          doc.text(ln, margin + 2, y);
          y += 3.5;
        }
        doc.setFont('Helvetica', 'normal');
        doc.setTextColor(...C.text);
        y += 2;
      } else if (ea) {
        // PR8.10 — FINO: separar IRAM 1627:1997 puro vs CIRSOC §3.2.3.2 (verif. adicionales).
        // Fix C2 post-smoke: usar prefijo ASCII-safe en lugar de glifos Unicode.
        // Razón: la fuente default de jsPDF (Helvetica WinAnsi) sólo soporta
        // Latin-1; los glifos canónicos Unicode (✓ ⚠ ✗ ○) sólo renderizan si
        // DejaVu está precargada en `public/fonts/`.
        const ASCII_PREFIX = {
          [VEREDICTO.APTO]:                   'OK',
          [VEREDICTO.APTO_CON_OBSERVACIONES]: 'OK*',
          [VEREDICTO.APTITUD_CONDICIONADA]:   '!',
          [VEREDICTO.NO_APTO]:                'X',
          [VEREDICTO.EVALUACION_INCOMPLETA]:  '?',
        };
        // Prompt 3 C9.3: cada regla CIRSOC se asocia a una categoría visual canónica.
        // `cumple_con_tolerancia` (D20 paradigma) → APTO_CON_OBSERVACIONES.
        const granuloEstadoToCat = (st) => st === 'cumple' ? VEREDICTO.APTO
          : st === 'cumple_con_tolerancia' ? VEREDICTO.APTO_CON_OBSERVACIONES
          : st === 'no_cumple' ? VEREDICTO.NO_APTO
          : VEREDICTO.EVALUACION_INCOMPLETA;
        const boolToCat = (b) => b ? VEREDICTO.APTO : VEREDICTO.NO_APTO;
        const renderLines = (lines) => {
          // PR9-fix: hacer wrap del texto si es más ancho que el área útil.
          // Antes `doc.text()` directo desbordaba la página por la derecha
          // cuando la línea era larga (caso del MF en ficha del agregado).
          // Indentamos las líneas continuadas para que se distinga del prefijo.
          const indentLeft = margin + 4;
          const prefixWidth = 7;        // ancho aproximado de "OK*  " en pt
          const wrapWidth = contentW - 4 - prefixWidth;
          for (const ln of lines) {
            doc.setFontSize(7.5);
            const pres = getCategoriaPdfPresentation(ln.categoria);
            doc.setTextColor(...pres.color);
            const prefix = ASCII_PREFIX[ln.categoria] || '?';
            const wrapped = doc.splitTextToSize(String(ln.text || ''), wrapWidth);
            checkPage(4 * Math.max(1, wrapped.length) + 1);
            // Primera línea con prefijo, las siguientes con sangría.
            doc.text(`${prefix}  ${wrapped[0]}`, indentLeft, y);
            y += 4;
            for (let i = 1; i < wrapped.length; i++) {
              doc.text(wrapped[i], indentLeft + prefixWidth, y);
              y += 4;
            }
          }
          doc.setTextColor(...C.text);
        };

        const rgAB = ea.resultadoGlobal?.bandaAB;
        const rgAC = ea.resultadoGlobal?.bandaAC;
        const rgFrac = ea.resultadoGlobal?.fraccion;

        // ── BLOQUE 1: IRAM 1627:1997 puro ──
        checkPage(20);
        y += 2;
        doc.setFontSize(8);
        doc.setFont('Helvetica', 'bold');
        doc.setTextColor(...C.text);
        doc.text('Conformidad granulométrica IRAM 1627:1997', margin + 2, y);
        doc.setFont('Helvetica', 'normal');
        y += 5;

        const linesIRAM = [
          { categoria: granuloEstadoToCat(rgAB), text: `Banda A-B (IRAM 1627 §3.2): ${rgAB === 'cumple' ? 'Cumple' : rgAB === 'cumple_con_tolerancia' ? 'Cumple con tolerancia §3.2.4' : 'No cumple'}${ea.bandaAB?.fueraDeBanda > 0 ? ` (${ea.bandaAB.fueraDeBanda} fuera, desvío ${ea.bandaAB.peorDesvio} pp)` : ''}` },
          { categoria: granuloEstadoToCat(rgAC), text: `Banda A-C (banda extendida IRAM 1627): ${rgAC === 'cumple' ? 'Cumple' : 'No cumple'}` },
        ];
        if (ea.tolerancia10pp?.aplica) {
          linesIRAM.push({
            categoria: boolToCat(ea.tolerancia10pp.cumple),
            text: `Tolerancia 10 pp sobre Curva B (IRAM 1627 §3.2.4): ${ea.tolerancia10pp.excesoTotal} pp (máx. 10 pp en tamices 1,18 / 0,600 / 0,300 mm)`,
          });
        }
        renderLines(linesIRAM);

        // ── BLOQUE 2: CIRSOC 200:2024 §3.2.3.2 (verificaciones adicionales) ──
        checkPage(20);
        y += 2;
        doc.setFontSize(8);
        doc.setFont('Helvetica', 'bold');
        doc.setTextColor(...C.text);
        doc.text('Verificación CIRSOC 200:2024 §3.2.3.2', margin + 2, y);
        doc.setFont('Helvetica', 'normal');
        y += 5;

        // PR8.1 — MF: variación ±0.20 vs MF de diseño (no más rango 2.3-3.1).
        // Datos canónicos en evaluacion.reglasCIRSOC.moduloFinura
        // (con campos: valor, mfDiseno, delta, estado).
        const mfRule = g?.evaluacion?.reglasCIRSOC?.moduloFinura
          || ea.moduloFinura
          || null;
        const mfVal = mfRule?.valor ?? ea.moduloFinura?.valor ?? null;
        const mfDiseno = mfRule?.mfDiseno ?? null;
        const mfDelta = mfRule?.delta ?? null;
        const mfEstado = mfRule?.estado || null;

        // PR9-fix: usar ASCII puro (`<=` en vez de `≤`, `|d|` en vez de `|Δ|`)
        // para evitar que jsPDF expanda el kerning carácter por carácter cuando
        // la fuente Helvetica no tiene el glifo Unicode. Cuando DejaVu está
        // cargada, igual se ve bien — pero ASCII es seguro en cualquier entorno.
        // PR9-fix2: la ficha técnica del agregado NO debe hablar de
        // "dosificación" — el agregado es independiente y participa de
        // muchas mezclas distintas. La verificación §3.2.3.2.g (variación
        // del MF respecto al MF de diseño) pertenece al INFORME DE LA
        // DOSIFICACIÓN, no a la ficha del agregado. Acá solo reportamos
        // el MF medido como dato característico del agregado.
        let mfText, mfCat;
        if (mfVal == null) {
          mfText = 'Módulo de finura: sin dato — cargar resultado del ensayo de granulometría.';
          mfCat = VEREDICTO.APTO_CON_OBSERVACIONES;
        } else if (mfDiseno == null) {
          // Ficha del agregado: no hay MF de diseño porque el agregado
          // todavía no está asignado a una mezcla específica. Mostramos
          // el valor característico y dejamos constancia de dónde se
          // hace la verificación.
          mfText = `Módulo de finura del agregado: ${mfVal.toFixed(2)}. La verificación §3.2.3.2.g (variación máx. +/-0,20 vs MF de diseño) se realiza en el informe de cada mezcla que use este agregado.`;
          mfCat = VEREDICTO.APTO;
        } else if (mfEstado === 'desviado') {
          // Hay MF de diseño en el contexto (caller pasó dosificación) →
          // sí podemos verificar §3.2.3.2.g.
          const deltaAbs = mfDelta != null ? Math.abs(mfDelta).toFixed(2) : '?';
          mfText = `Módulo de finura: ${mfVal.toFixed(2)} (MF diseño ${mfDiseno.toFixed(2)}, |d|=${deltaAbs} > 0,20). §3.2.3.2.g: rechazar la partida o ajustar proporciones (decisión DO).`;
          mfCat = VEREDICTO.APTO_CON_OBSERVACIONES;
        } else {
          const deltaAbs = mfDelta != null ? Math.abs(mfDelta).toFixed(2) : '0,00';
          mfText = `Módulo de finura: ${mfVal.toFixed(2)} (MF diseño ${mfDiseno.toFixed(2)}, |d|=${deltaAbs} <= 0,20). §3.2.3.2.g cumple.`;
          mfCat = VEREDICTO.APTO;
        }

        const linesCIRSOC = [
          { categoria: mfCat, text: mfText },
          { categoria: granuloEstadoToCat(rgFrac), text: `Fracción máx. entre tamices consecutivos (§3.2.3.2.e): ${ea.fraccionMaxima?.peorValor != null ? ea.fraccionMaxima.peorValor + '%' : '-'} (máx. 45%)${ea.fraccionMaxima?.peorEntre ? ' — ' + ea.fraccionMaxima.peorEntre : ''}` },
        ];
        // Banda A-C uso: cuando A-B no cumple pero A-C sí, CIRSOC §3.2.3.2.f
        // permite el uso bajo condiciones (H <= 20 + estudio o antecedentes).
        // PR9-fix: ASCII `<=` en vez de `≤` para no romper kerning de jsPDF.
        if (rgAC === 'cumple' && rgAB !== 'cumple' && rgAB !== 'cumple_con_tolerancia') {
          linesCIRSOC.push({
            categoria: VEREDICTO.APTO_CON_OBSERVACIONES,
            text: 'Uso de banda A-C (§3.2.3.2.f): admisible solo en hormigones con f\'c <= 20 MPa o con estudio/antecedentes específicos.',
          });
        }
        renderLines(linesCIRSOC);

        if (ea.implicancias) {
          y += 1;
          checkPage(10);
          doc.setFontSize(7);
          doc.setTextColor(...C.muted);
          const impLines = doc.splitTextToSize(ea.implicancias, contentW - 10);
          for (const il of impLines) {
            checkPage(4);
            doc.text(il, margin + 4, y);
            y += 3.5;
          }
          doc.setTextColor(...C.text);
        }
        y += 3;
      }

      if (eag && !eag.error && !hasBanda && _modoNorm === 'NORMATIVO') {
        // GRUESO: show Table 3.5 auto-evaluation (only if no manual band evaluation)
        // Modo DESCRIPTIVO omite la evaluación (la nota de referencia ya
        // explica que la verificación se emite en modo Normativo).
        checkPage(15);
        y += 2;
        doc.setFontSize(8);
        doc.setFont('Helvetica', 'bold');
        doc.setTextColor(...C.text);
        doc.text(`Evaluación: Tabla 3.5 CIRSOC 200:2024 — TMN ${eag.bandaNominal || eag.tmnMm} mm`, margin + 2, y);
        doc.setFont('Helvetica', 'normal');
        y += 5;
        doc.setFontSize(7.5);
        // Prompt 3 C9.3: color canónico desde boolean. Texto descriptivo
        // preservado (reporta cuántos tamices fuera + desvío en pp).
        doc.setTextColor(...getCategoriaPdfColor(eag.cumple));
        doc.text(eag.cumple ? 'Cumple — Granulometría dentro de los límites.' : `No cumple — ${eag.fueraDeBanda} tamiz(ces) fuera de banda (desvío ${eag.peorDesvio} pp).`, margin + 4, y);
        doc.setTextColor(...C.text);
        y += 5;

        // PR8.17 — Nota informativa L_FAG (IRAM 1531 §5.1.2.4).
        // El sistema NO aplica esta fórmula como motor de cálculo (decisión
        // DH-1531-003): el límite de finos del AG sigue siendo el valor fijo
        // de Tabla 3.6. La fórmula se incluye como referencia para que el
        // técnico la aplique manualmente si su laboratorio lo requiere.
        checkPage(14);
        doc.setFontSize(7);
        doc.setTextColor(...C.muted);
        const lfagNotes = [
          'Nota L_FAG (IRAM 1531 §5.1.2.4): el límite de finos del AG puede ajustarse',
          'según el contenido de finos del AF mediante:',
          "    L_FAG = 1% + (P_FAF · (L_FAF − C_FAF)) / (100 − P_FAF)",
          'Variables: P_FAF = % AF en mezcla, L_FAF = límite finos AF, C_FAF = % finos',
          'medidos en AF. Aplicación manual; este informe usa el límite fijo de Tabla 3.6.',
        ];
        for (const ln of lfagNotes) {
          checkPage(4);
          doc.text(ln, margin + 4, y);
          y += 3.2;
        }
        doc.setTextColor(...C.text);
        y += 2;
      }

    } else {
      checkPage(8);
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text('Sin ensayos de granulometría registrados.', margin + 2, y);
      y += 8;
    }
  }

  /* ══════════════════════════════════════════
     "Ensayos realizados" — sólo si la opción está habilitada en el dialog.
     Filtros aplicados:
       - estado != NO_APLICA (no aplica al tipo de agregado)
       - no derivados (TMN/MF se calculan a partir de granulometría)
       - granulometría excluida (ya está en su propia sección)
       - visibleEnUI / visibleEnCards (configurable por catálogo)
       - **obligatorio**: si NO es obligatorio Y no fue realizado, se omite del
         listado para mantener coherencia con el veredicto. Si es obligatorio
         pero no fue realizado, se muestra como "Sin datos" para señalar la falta.
     ══════════════════════════════════════════ */
  if (complementarios) {
    sectionTitle(sectionLabel('Ensayos realizados'));

    const items = (resumen?.items || []).filter((it) => {
      if (it.estado === 'NO_APLICA') return false;
      if (it.tipo?.esDerivado) return false;
      if (isGranulometria({ tipo: it.tipo })) return false;
      if (it.tipo?.visibleEnUI === false) return false;
      if (it.tipo?.visibleEnCards === false) return false;
      // PR6: filtrar tipos que NO aplican al contexto del agregado
      // (ej. ensayos solo-TBS no aparecen en agregados solo-hormigón).
      if (!tipoAplicaAlCtx(it.tipo)) return false;
      // Coherencia con el veredicto: ensayos NO obligatorios sin resultado se omiten.
      // PR6: leer obligatorio[contexto] en lugar de `obligatorio` global legacy.
      const tieneResultado = !!it.ultimoEnsayo?.resultado;
      const esObligatorio = tipoEsObligatorioEnCtx(it.tipo);
      if (!tieneResultado && !esObligatorio) return false;
      return true;
    });

    if (items.length > 0) {
      // Extract result value from an ensayo
      const extractResultado = (ensayo, tipoNombre) => {
        if (!ensayo) return '\u2014';
        let r = safeJson(ensayo.resultado);
        if (!r || Object.keys(r).length === 0) return '\u2014';

        // Densidad y absorción (IRAM 1520 / 1533) — show all values
        if (r.densidadRelativaAparenteSSS != null || r.densidadRelativaReal != null) {
          const parts = [];
          if (r.densidadRelativaReal != null) parts.push(`d1: ${fmtNum(r.densidadRelativaReal, 3)}`);
          if (r.densidadRelativaAparenteSeca != null) parts.push(`d2: ${fmtNum(r.densidadRelativaAparenteSeca, 3)}`);
          if (r.densidadRelativaAparenteSSS != null) parts.push(`d3: ${fmtNum(r.densidadRelativaAparenteSSS, 3)}`);
          if (r.absorcionPct != null) parts.push(`A: ${fmtNum(r.absorcionPct, 2)} %`);
          // Prompt 3 C12 (Fix A): separar en l\u00EDneas dentro de la celda en lugar
          // de combinar con `\u00B7` (que rendea confuso en jsPDF default font y mete
          // varias m\u00E9tricas distintas en una sola l\u00EDnea ilegible). autoTable
          // respeta '\n'. (Fix B): decimales de absorci\u00F3n a 2 (alineado al cert).
          return parts.join('\n');
        }

        // Materia orgánica — cualitativo
        if (r.resultadoColorimetrico) return r.resultadoColorimetrico === 'menor_500' ? '< 500 ppm' : '\u2265 500 ppm';
        // Peso unitario — two values
        if (r.puc != null || r.pus != null) {
          const parts = [];
          if (r.puc != null) parts.push(`PUC: ${fmtNum(r.puc, 0)}`);
          if (r.pus != null) parts.push(`PUS: ${fmtNum(r.pus, 0)}`);
          return parts.join(' / ') + ' kg/m\u00B3';
        }
        // Equivalente arena
        if (r.equivalenteArenaPct != null) return fmtNum(r.equivalenteArenaPct, 0, '%');
        // Partículas blandas — cualitativo
        if (r.resultadoCualitativo) return r.resultadoCualitativo === 'no_contiene' ? 'No contiene' : fmtNum(r.valor, 1, '%');
        // Durabilidad
        if (r.perdidaPct != null) return fmtNum(r.perdidaPct, 1, '%');
        // Generic valor field
        if (r.valor != null) {
          const prefix = r.operador === 'menor_que' ? '< ' : r.operador === 'mayor_que' ? '> ' : (r.esMenorQue ? '< ' : '');
          return prefix + fmtNum(r.valor, r.valor < 1 ? 2 : r.valor < 10 ? 1 : 0, '%');
        }
        // Legacy fields
        for (const k of ['terronesPct','pasa200Pct','materiasCarbonosaPct','salesSolublesPct','sulfatosSO3Pct','desmenuzablesPct','losAngelesPct','lajosidadPct','elongacionPct','perdidaPct','perdidaPctTotal']) {
          if (r[k] != null) return fmtNum(r[k], r[k] < 1 ? 2 : 1, '%');
        }
        return '\u2014';
      };

      // Find common lab (to show once at bottom instead of per-row)
      const labs = new Set(items.map(it => it.ultimoEnsayo?.laboratorio).filter(Boolean));
      const commonLab = labs.size === 1 ? [...labs][0] : null;

      // Decisi\u00f3n 2026-05-28: en modo DESCRIPTIVO omitimos la columna
      // "Estado" porque es un veredicto operativo (VIGENTE / VENCIDO / POR
      // VENCER) cuyo VENCIDO el lector podr\u00eda interpretar como juicio
      // negativo. La fecha del ensayo basta para que el lector valore
      // vigencia. En NORMATIVO la columna se mantiene como hasta ahora.
      const incluyeEstado = _modoNorm === 'NORMATIVO';
      const body = items.map(it => {
        const e = it.ultimoEnsayo;
        const row = [
          sanitizeUnicode(it.tipo?.nombre || '\u2014'),
          it.tipo?.normaRef || '\u2014',
          fmtDateShort(e?.fechaEnsayo),
          extractResultado(e, it.tipo?.nombre),
        ];
        if (incluyeEstado) row.push(estadoInfo(it.estado).label);
        row.push(e?.nroInforme || '\u2014');
        return row;
      });

      doc.autoTable({
        startY: y,
        head: [incluyeEstado
          ? ['Ensayo', 'Norma', 'Fecha', 'Resultado', 'Estado', 'Informe']
          : ['Ensayo', 'Norma', 'Fecha', 'Resultado', 'Informe']],
        body,
        margin: { left: margin, right: margin },
        headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 7.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7.5, textColor: C.text },
        alternateRowStyles: { fillColor: C.lightBg },
        columnStyles: {
          0: { cellWidth: 55 },
          1: { cellWidth: 22 },
          2: { cellWidth: 22 },
          3: { cellWidth: 35, fontStyle: 'bold' },
          // En NORMATIVO: col 4 = Estado, col 5 = Informe.
          // En DESCRIPTIVO: col 4 = Informe (estado omitido), col 5 inexistente.
          4: incluyeEstado ? { cellWidth: 18 } : { cellWidth: 28 },
          ...(incluyeEstado ? { 5: { cellWidth: 28 } } : {}),
        },
        didParseCell: (data) => {
          if (incluyeEstado && data.section === 'body' && data.column.index === 4) {
            switch (data.cell.raw) {
              case 'Vigente':    data.cell.styles.textColor = [22, 163, 74];  break;
              case 'Por vencer': data.cell.styles.textColor = [202, 138, 4]; break;
              case 'Vencido':    data.cell.styles.textColor = C.danger;       break;
              case 'Sin datos':  data.cell.styles.textColor = C.muted;        break;
              default: break;
            }
          }
        },
        theme: 'plain',
      });
      y = doc.lastAutoTable.finalY + 2;

      // Show lab once at bottom if common
      if (commonLab) {
        doc.setFont('Helvetica', 'italic');
        doc.setFontSize(7);
        doc.setTextColor(...C.muted);
        doc.text(`Laboratorio: ${commonLab}`, margin + 2, y);
        y += 5;
      }
      y += 3;
    } else {
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text('Sin ensayos registrados.', margin + 2, y);
      y += 8;
    }
  }

  /* ══════════════════════════════════════════
     E) Cumplimiento normativo (tabla resumen)

     Decisión 2026-05-28: la sección Cumplimiento solo se renderiza en
     modo NORMATIVO. En DESCRIPTIVO el documento no emite valoración
     normativa, por lo que la tabla de cumplimiento queda omitida.
     ══════════════════════════════════════════ */
  if (cumplimiento && _modoNorm === 'NORMATIVO' && resumen?.items?.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = margin; }
    sectionTitle(sectionLabel('Cumplimiento normativo - CIRSOC 200-2024'));

    const esAF = (agregadoTipo || '').toUpperCase() === 'FINO';
    const compRows = [];

    // Helper: find resultado from resumen items by codigo fragment
    const _findRes = (codigoFrags) => {
      const item = (resumen?.items || []).find(it => {
        const cod = it.tipo?.codigo || '';
        return codigoFrags.some(f => cod.includes(f)) && it.estado !== 'NO_APLICA';
      });
      if (!item?.ultimoEnsayo) return null;
      let r = item.ultimoEnsayo.resultado;
      if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
      return r;
    };

    // Helper: evaluate max limit
    const _evalMax = (val, lim) => {
      if (val == null) return 'Sin dato';
      if (val > lim) return 'No cumple';
      return 'Cumple';
    };
    const _evalMin = (val, lim) => {
      if (val == null) return 'Sin dato';
      return val >= lim ? 'Cumple' : 'No cumple';
    };

    const _add = (req, unit, spec, val, estado, obs) => {
      compRows.push([req, unit, spec, val || '-', estado || 'Sin dato', obs || '']);
    };

    // Densidades
    const _dr = _findRes(esAF ? ['1520_DENSIDAD'] : ['1533_DENSIDAD']);
    _add('Densidad SSS (d3)', '-', 'Sin req.', _dr?.densidadRelativaAparenteSSS != null ? fmtNum(_dr.densidadRelativaAparenteSSS, 3) : null, 'Info.', '');
    _add('Densidad seca (d2)', '-', 'Sin req.', _dr?.densidadRelativaAparenteSeca != null ? fmtNum(_dr.densidadRelativaAparenteSeca, 3) : null, 'Info.', '');
    _add('Densidad real (d1)', '-', 'Sin req.', _dr?.densidadRelativaReal != null ? fmtNum(_dr.densidadRelativaReal, 3) : null, 'Info.', '');
    // Prompt 3 C12 Fix B: 2 decimales (alineado al cert + cards de Caracterización).
    _add('Absorcion', '%', 'Sin req.', _dr?.absorcionPct != null ? fmtNum(_dr.absorcionPct, 2, '%') : null, 'Info.', '');

    // Pasante #200
    // M6 (auditoría 01-calidad): la ficha técnica del agregado NO conoce el
    // destino (con / sin desgaste superficial). Para AF entre 3% y 5% el valor
    // pasa el límite laxo (5%) pero excede el estricto (3%). Antes el estado
    // mostraba "Cumple" plano, lo que era engañoso si el material termina
    // usándose en un destino con desgaste. Ahora marca "Atención" en ese rango
    // y la columna observación explica la condicionalidad.
    const _pr = _findRes(['1540', '1674_MATERIAL']);
    const _pVal = _pr?.pasa200Pct ?? _pr?.valor;
    const pLim = esAF ? 5.0 : 1.5;
    let pasanteEstado = _evalMax(_pVal, pLim);
    let pasanteObs = esAF ? '3% desgaste; 5% otros' : '1% grava; 1,5% piedra partida';
    if (esAF && _pVal != null && _pVal > 3.0 && _pVal <= 5.0) {
      pasanteEstado = 'Atencion';
      pasanteObs = 'Cumple <= 5% (sin desgaste); excede 3% — depende del destino. Confirmar contexto.';
    }
    _add('Pasante #200', '%', esAF ? '<= 3,0 / 5,0' : '<= 1,0 / 1,5',
      _pVal != null ? fmtNum(_pVal, 2, '%') : null, pasanteEstado, pasanteObs);

    // Terrones
    const _tr = _findRes(['TERRONES']);
    const tLim = esAF ? 3.0 : 2.0;
    _add('Terrones arcilla y p.f.', '%', `<= ${fmtNum(tLim, 1)}`, _tr?.valor != null ? fmtNum(_tr.valor, 1, '%') : null, _evalMax(_tr?.valor, tLim), '');

    // Sulfatos. Norma usa 2 dec para AF (0,10 IRAM 1512 §5.2.5 / Tabla 3.4)
    // y 3 dec para AG (0,075 IRAM 1531 / Tabla 3.6). Antes se imprimía siempre
    // con 3 dec → AF salía como "<= 0,100" — auditoría 01-calidad M5.
    const _sr = _findRes(['SULFATOS_SO3', 'SULFATOS']);
    const sLim = esAF ? 0.1 : 0.075;
    const sLimDec = esAF ? 2 : 3;
    _add('Sulfatos (SO3)', '%', `<= ${fmtNum(sLim, sLimDec)}`, _sr?.valor != null ? fmtNum(_sr.valor, 2, '%') : null, _evalMax(_sr?.valor, sLim), '');

    // Sales
    const _slr = _findRes(['SALES_SOLUBLES']);
    _add('Sales solubles', '%', '<= 1,5', _slr?.valor != null ? fmtNum(_slr.valor, 2, '%') : null, _evalMax(_slr?.valor, 1.5), '');

    // Cloruros (IRAM 1512 Tabla 1: AF <= 0,04% / IRAM 1531 Tabla 1: AG <= 0,003%)
    const _clr = _findRes(['CLORUROS']);
    const _clOp = _clr?.operador || (_clr?.esMenorQue ? 'menor_que' : null);
    const _clPfx = _clOp === 'menor_que' ? '< ' : _clOp === 'mayor_que' ? '> ' : '';
    const _clDisp = _clOp ? `${_clPfx}${fmtNum(_clr.valor, _clOp === 'menor_que' ? 2 : 3)}` : (_clr?.valor != null ? fmtNum(_clr.valor, 3) : null);
    if (esAF) {
      const clEfect = _clOp === 'menor_que' ? 0 : _clr?.valor;
      _add('Cloruros solubles', '%', '<= 0,04', _clDisp ? _clDisp + ' %' : null, _evalMax(clEfect, 0.04), 'IRAM 1512 Tabla 1 + art. 2.2.8');
    } else {
      // Vocabulario alineado con `lib/compliance/pdfPresentation.js`:
      //   - 'Sin dato'              → no hay ensayo cargado (o sin valor reportable).
      //   - 'EVALUACIÓN INCOMPLETA' → hay valor pero la precisión del lab (cota
      //                                superior) no permite afirmar cumplimiento
      //                                contra el límite normativo (caso M12).
      let clEstado = 'Sin dato';
      if (_clr?.valor != null) {
        if (_clOp === 'menor_que' && _clr.valor > 0.003) clEstado = 'EVALUACIÓN INCOMPLETA';
        else if (_clOp === 'mayor_que' && _clr.valor > 0.003) clEstado = 'No cumple';
        else clEstado = _evalMax(_clOp === 'menor_que' ? 0 : _clr.valor, 0.003);
      }
      _add('Cloruros solubles', '%', '<= 0,003', _clDisp ? _clDisp + ' %' : null, clEstado, 'IRAM 1531 Tabla 1. Precision <= 0,001% req.');
    }

    // Materia orgánica (fino)
    if (esAF) {
      const _or = _findRes(['MATERIA_ORGANICA']);
      const orgC = _or?.resultadoColorimetrico;
      _add('Materia organica', 'mg/kg', '< 500', orgC === 'menor_500' ? '< 500' : orgC === 'igual_o_mayor_500' ? '>= 500' : null, orgC === 'menor_500' ? 'Cumple' : orgC === 'igual_o_mayor_500' ? 'No cumple' : 'Sin dato', '');
    }

    // Carbonosas
    const _cr = _findRes(['MATERIAS_CARBONOSAS']);
    _add('Materias carbonosas', '%', '<= 0,5 / 1,0', _cr?.valor != null ? fmtNum(_cr.valor, 2, '%') : null, _evalMax(_cr?.valor, 1.0),
      '0,5% aspecto superficial importante; 1,0% otros destinos');

    // Equivalente arena (fino)
    if (esAF) {
      const _er = _findRes(['EQUIVALENTE_ARENA']);
      const _eVal = _er?.equivalenteArenaPct ?? _er?.ea_promedio ?? _er?.valor;
      _add('Equivalente de arena', '%', '>= 75', _eVal != null ? fmtNum(_eVal, 0, '%') : null, _evalMin(_eVal, 75), '');
    }

    // PUC/PUS
    const _pur = _findRes(['PESO_UNITARIO']);
    _add('PUC / PUS', 'kg/m\u00B3', 'Sin req.', _pur?.puc != null ? `${fmtNum(_pur.puc, 0)} / ${fmtNum(_pur.pus, 0)}` : null, 'Info.', '');

    // Durabilidad
    const _dur = _findRes(['DURABILIDAD', 'ESTABILIDAD']);
    const durVal = _dur?.perdidaPct ?? _dur?.valor;
    const durLim = esAF ? 10 : 12;
    _add('Durabilidad Na2SO4', '%', `<= ${durLim}`, durVal != null ? fmtNum(durVal, 1, '%') : null, _evalMax(durVal, durLim), 'Solo exigible para clases C1/C2 (congelación-deshielo)');

    // Grueso only
    if (!esAF) {
      const _lr = _findRes(['1687_1_LAJOSIDAD']);
      const ljVal = _lr?.lajosidadPct ?? _lr?.valor;
      _add('Lajosidad', '%', '<= 30 / 25', ljVal != null ? fmtNum(ljVal, 0, '%') : null, _evalMax(ljVal, 30), '30% gral; 25% H>=50');

      const _elr = _findRes(['1687_2_ELONGACION']);
      const elVal = _elr?.elongacionPct ?? _elr?.valor;
      _add('Elongacion', '%', '<= 45 / 40', elVal != null ? fmtNum(elVal, 0, '%') : null, _evalMax(elVal, 45), '45% gral; 40% H>=50');

      const _dlar = _findRes(['DESGASTE_LA', 'LOS_ANGELES']);
      const dlaVal = _dlar?.losAngelesPct ?? _dlar?.perdidaPct ?? _dlar?.valor;
      _add('Desgaste Los Angeles', '%', '<= 50 / 30', dlaVal != null ? fmtNum(dlaVal, 1, '%') : null, _evalMax(dlaVal, 50), '50% gral; 30% abrasion');

      const _polr = _findRes(['POLVO_ADHERIDO']);
      _add('Polvo adherido', '%', '<= 1,5', _polr?.valor != null ? fmtNum(_polr.valor, 1, '%') : null, _evalMax(_polr?.valor, 1.5), 'IRAM 1531 / IRAM 1883');

      const _blr = _findRes(['PARTICULAS_BLANDAS']);
      const blDisp = _blr?.resultadoCualitativo === 'no_contiene' ? 'No contiene' : (_blr?.valor != null ? fmtNum(_blr.valor, 1, '%') : null);
      _add('Particulas blandas', '%', '<= 5,0', blDisp, _blr?.resultadoCualitativo === 'no_contiene' ? 'Cumple' : _evalMax(_blr?.valor, 5.0), '');
    }

    // ── Granulometría — evaluación automática ──
    const _gr = _findRes(['GRANULOMETRIA', '1505']);
    const _gg = _gr?.granulometria;
    const _ea = _gg?.evaluacionAuto;
    const _eag = _gg?.evaluacionAutoGrueso;

    if (esAF && _ea) {
      const rg = _ea.resultadoGlobal || {};
      _add('Granulometria banda A-B', '-', 'IRAM 1627 T.3.3',
        _ea.bandaAB?.fueraDeBanda > 0 ? `${_ea.bandaAB.fueraDeBanda} fuera` : 'Dentro',
        rg.bandaAB === 'cumple' ? 'Cumple' : rg.bandaAB === 'cumple_con_tolerancia' ? 'Atencion' : 'No cumple',
        _ea.bandaAB?.peorDesvio ? `Desvio: ${_ea.bandaAB.peorDesvio} pp` : '');
      _add('Granulometria banda A-C', '-', 'IRAM 1627 T.3.3',
        _ea.bandaAC?.fueraDeBanda > 0 ? `${_ea.bandaAC.fueraDeBanda} fuera` : 'Dentro',
        rg.bandaAC === 'cumple' ? 'Cumple' : 'No cumple',
        rg.bandaAC === 'cumple' ? 'Solo H <= 20' : '');
      if (_ea.tolerancia10pp?.aplica) {
        _add('Tolerancia 10 pp (Curva B) §3.2.4', '-', '<= 10 pp',
          `${_ea.tolerancia10pp.excesoTotal} pp`,
          _ea.tolerancia10pp.cumple ? 'Cumple' : 'No cumple', '1,18 / 0,600 / 0,300 µm');
      }
      _add('Fracción máx. entre tamices', '%', '<= 45',
        _ea.fraccionMaxima?.peorValor != null ? `${_ea.fraccionMaxima.peorValor}` : '-',
        rg.fraccion === 'cumple' ? 'Cumple' : 'No cumple',
        _ea.fraccionMaxima?.peorEntre || '');
    }
    if (!esAF) {
      // Use manual band evaluation if available, otherwise auto-evaluation
      const evManual = _gg?.evaluacion;
      const _disc = _gg?._discrepanciaBanda;
      if (evManual && evManual.stats) {
        const bandaNombre = _gg?.objetivo?.nombre || 'IRAM 1627';
        _add('Granulometria', '-', bandaNombre,
          evManual.cumple ? 'Dentro' : `${evManual.stats.nFuera} fuera`,
          evManual.cumple ? 'Cumple' : 'No cumple',
          evManual.stats.peorDesvioPct ? `Desvio: ${evManual.stats.peorDesvioPct} pp` : '');
      } else if (_eag && !_eag.error) {
        _add('Granulometria Tabla 3.5', '-', `TMN ${_eag.bandaNominal || _eag.tmnMm} mm`,
          _eag.cumple ? 'Dentro' : `${_eag.fueraDeBanda} fuera`,
          _eag.cumple ? 'Cumple' : 'No cumple',
          _eag.peorDesvio ? `Desvio: ${_eag.peorDesvio} pp` : '');
      }
      // Aviso: la curva objetivo elegida difiere de la que sugiere Tabla 3.5 por
      // TMN. Si el usuario eligió mal la curva, este renglón lo alerta.
      if (_disc) {
        const resumen = `Verificar curva (sugerida Tabla 3.5: ${_disc.bandaTabla35}, TMN ${_disc.tmnCalculado} mm)`;
        _add('Granulometria - Atencion', '-', 'Discrepancia banda', resumen, 'Atencion', _disc.mensaje);
      }
    }

    if (compRows.length > 0) {
      doc.autoTable({
        startY: y,
        head: [['Requisito', 'Unidad', 'Espec.', 'Resultado', 'Estado', 'Observaciones']],
        body: compRows,
        margin: { left: margin, right: margin },
        headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 7, fontStyle: 'bold' },
        bodyStyles: { fontSize: 7, textColor: C.text },
        alternateRowStyles: { fillColor: C.lightBg },
        columnStyles: {
          0: { cellWidth: 42 },
          1: { cellWidth: 14, halign: 'center' },
          2: { cellWidth: 24, halign: 'center' },
          3: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
          4: { cellWidth: 20, halign: 'center' },
          5: { cellWidth: 'auto', fontSize: 6 },
        },
        theme: 'plain',
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 4) {
            // Prompt 3 C9.3: el TEXTO de la celda ('Cumple' / 'No cumple' /
            // 'Atencion' / 'Sin dato') se preserva — vocabulario técnico por
            // requisito individual. Sólo el COLOR migra al canónico:
            //   Cumple    → verde APTO
            //   No cumple → rojo NO_APTO
            //   Atencion  → naranja APTITUD_CONDICIONADA
            //   Sin dato / otro → muted
            const v = data.cell.raw;
            const cat = v === 'Cumple'    ? VEREDICTO.APTO
                      : v === 'No cumple' ? VEREDICTO.NO_APTO
                      : v === 'Atencion'  ? VEREDICTO.APTITUD_CONDICIONADA
                      : null;
            if (cat) {
              data.cell.styles.textColor = getCategoriaPdfColor(cat);
              data.cell.styles.fontStyle = 'bold';
            } else {
              data.cell.styles.textColor = C.muted;
            }
          }
          if (data.section === 'body' && data.column.index === 3 && data.cell.raw === '-') {
            data.cell.styles.textColor = C.muted;
          }
        },
      });
      y = doc.lastAutoTable.finalY + 3;
      doc.setFontSize(6);
      doc.setTextColor(...C.muted);
      doc.text(`Normas: CIRSOC 200-2024 ${esAF ? '(Tablas 3.3, 3.4)' : '(Tablas 3.5, 3.6, 3.7)'} - ${esAF ? 'IRAM 1512' : 'IRAM 1531'}`, margin, y);
      y += 6;
    }
  }

  /* ══════════════════════════════════════════
     Veredicto del agregado — penúltima sección, antes de Advertencia.
     Orden de informes técnicos: dictamen primero, advertencias/disclaimers
     al final. Renderiza:
       - Banner color con label canónico (APTO / APTO CON OBSERVACIONES /
         APTITUD CONDICIONADA / NO APTO / EVALUACIÓN INCOMPLETA)
       - Texto formal del dictamen para la categoría
       - Listas detalladas en orden de severidad (cuando aplica):
         1. Razones de no aptitud  (compliance.status='fail')
         2. Condiciones            (compliance.status='conditionalPass')
         3. Observaciones          (compliance.status='passWithObservations')
         4. Ensayos pendientes     (cuando EVALUACIÓN INCOMPLETA)
     Fallback: cuando `resumen.veredictoGlobal` falta (datos pre-Prompt 2),
     degrada a EVALUACIÓN INCOMPLETA con explicación.

     Decisión 2026-05-28: solo se renderiza en modo NORMATIVO. El modo
     DESCRIPTIVO no emite veredicto.
     ══════════════════════════════════════════ */
  if (veredicto && _modoNorm === 'NORMATIVO') {
    // PR6: reservar espacio TOTAL (título 14mm + banner 14mm + dictamen 10-14mm
    // + primer item ~10mm = ~50mm) ANTES de renderizar el título. Sin esto,
    // sectionTitle se dibujaba al final de la página actual y el checkPage(40)
    // posterior saltaba al banner a la página siguiente, dejando el header
    // huérfano (test5/test6 ambos lo mostraban).
    checkPage(54);
    sectionTitle(sectionLabel('Veredicto del agregado'));

    // Resolver veredicto + categoría visual canónica.
    const veredictoGlobal = resumen?.veredictoGlobal || null;
    const pres = getCategoriaPdfPresentation(veredictoGlobal);
    const categoria = pres.categoria;

    // ── Banner color con label canónico ──
    // checkPage adicional defensivo (en el flujo normal el de arriba ya garantiza
    // espacio; este queda como red de seguridad si entre el título y el banner
    // se hubiera incrementado `y` por algún side effect).
    checkPage(40);
    doc.setFillColor(...pres.color);
    doc.roundedRect(margin, y, contentW, 14, 2, 2, 'F');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...C.white);
    // Fix C2 post-smoke: sin glifo Unicode (no garantizado en jsPDF default font).
    // El color de fondo del banner + el label canónico ya transmiten la categoría
    // sin necesidad de prefijo decorativo.
    doc.text(pres.label, pageW / 2, y + 9, { align: 'center' });
    y += 18;

    // ── Texto formal del dictamen según las categorías canónicas ──
    const dictamenText = (() => {
      switch (categoria) {
        case VEREDICTO.APTO:
          return 'El agregado evaluado es apto para uso en hormigón según los requisitos de IRAM 1512 y CIRSOC 200:2024.';
        case VEREDICTO.APTO_CON_OBSERVACIONES:
          return 'El agregado evaluado es apto para uso en hormigón. Se registran observaciones técnicas que se detallan a continuación.';
        case VEREDICTO.APTITUD_CONDICIONADA:
          return 'El agregado evaluado es apto sujeto a las condiciones de aplicabilidad indicadas a continuación. Su uso fuera de las condiciones declaradas no está respaldado por esta evaluación.';
        case VEREDICTO.NO_APTO:
          return 'El agregado evaluado no cumple con uno o más requisitos normativos esenciales. No apto para uso en hormigón.';
        // PR6: APTITUD NO DETERMINADA — estado neutro cuando el plan de
        // control de calidad de la planta no requiere evaluar parámetros
        // para este contexto. El sistema NO afirma APTO ni NO APTO; declara
        // explícitamente que no hay base para emitir veredicto.
        case VEREDICTO.APTITUD_NO_DETERMINADA:
          return 'Aptitud no determinada. El plan de control de calidad de la planta productora no requiere evaluar parámetros normativos para este contexto, por lo que el sistema no emite dictamen de aptitud. Para verificación normativa estricta (auditoría externa o licitación), generar el documento en modo de verificación normativa.';
        case VEREDICTO.EVALUACION_INCOMPLETA:
        default:
          return 'Evaluación no concluida. Se requieren ensayos adicionales para emitir un dictamen definitivo. Ver detalle a continuación.';
      }
    })();

    checkPage(15);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    const dictLines = doc.splitTextToSize(dictamenText, contentW - 4);
    for (const ln of dictLines) {
      checkPage(5);
      doc.text(ln, margin + 2, y);
      y += 4.5;
    }
    y += 3;

    // ── Listas detalladas (orden: razones > condiciones > observaciones > pendientes) ──

    // Recolectar items del resumen con su compliance per-ensayo.
    const items = (resumen?.items || []).filter((it) => it.estado !== 'NO_APLICA');
    const itemsBy = (status) => items.filter((it) => it.compliance?.status === status);

    // Helper para renderizar una lista titulada con bullets.
    const renderLista = (titulo, lineas, colorTitulo) => {
      if (!lineas.length) return;
      checkPage(10);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...colorTitulo);
      doc.text(titulo, margin + 2, y);
      y += 5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      for (const linea of lineas) {
        const wrapped = doc.splitTextToSize(`• ${linea}`, contentW - 6);
        // Mantener un bullet entero junto: si no entra completo, salto antes
        // del bullet en lugar de partirlo a mitad de línea entre páginas.
        checkPage(wrapped.length * 3.8);
        for (const w of wrapped) {
          doc.text(w, margin + 4, y);
          y += 3.8;
        }
      }
      y += 2;
    };

    // 1) Razones de no aptitud (compliance.status === 'fail')
    const fails = itemsBy('fail');
    if (fails.length) {
      const lineas = fails.flatMap((it) => {
        const tipoLabel = sanitizeUnicode(it.tipo?.nombre || it.tipo?.codigo || 'Ensayo');
        const norma = it.tipo?.normaRef ? ` (${it.tipo.normaRef})` : '';
        const reasons = it.compliance?.reasons || [];
        if (reasons.length === 0) {
          return [`${tipoLabel}${norma}: no cumple requisito normativo.`];
        }
        return reasons.map((r) => `${tipoLabel}${norma}: ${r}`);
      });
      renderLista('Motivos de no aptitud:', lineas, getCategoriaPdfColor(VEREDICTO.NO_APTO));
    }

    // 2) Condiciones de aplicabilidad (compliance.status === 'conditionalPass')
    const conditionals = itemsBy('conditionalPass');
    if (conditionals.length) {
      const lineas = conditionals.flatMap((it) => {
        const tipoLabel = sanitizeUnicode(it.tipo?.nombre || it.tipo?.codigo || 'Ensayo');
        const norma = it.tipo?.normaRef ? ` (${it.tipo.normaRef})` : '';
        const conditions = it.compliance?.conditions || [];
        if (conditions.length === 0) {
          return [`${tipoLabel}${norma}: requiere verificación contextual.`];
        }
        return conditions.map((c) => {
          const desc = c.description || c.key || 'condición';
          return `${tipoLabel}${norma}: ${desc}`;
        });
      });
      renderLista('Condiciones de aplicabilidad:', lineas, getCategoriaPdfColor(VEREDICTO.APTITUD_CONDICIONADA));
    }

    // 3) Observaciones técnicas (compliance.status === 'passWithObservations')
    const obsItems = itemsBy('passWithObservations');
    if (obsItems.length) {
      const lineas = obsItems.map((it) => {
        const tipoLabel = sanitizeUnicode(it.tipo?.nombre || it.tipo?.codigo || 'Ensayo');
        const norma = it.tipo?.normaRef ? ` (${it.tipo.normaRef})` : '';
        const observation = it.compliance?.observation || 'observación técnica registrada.';
        return `${tipoLabel}${norma}: ${observation}`;
      });
      renderLista('Observaciones técnicas:', lineas, getCategoriaPdfColor(VEREDICTO.APTO_CON_OBSERVACIONES));
    }

    // 4) Ensayos pendientes (cuando EVALUACIÓN INCOMPLETA, lista qué falta)
    //
    // Decisión 2026-05-28: esta sección solo aplica en modo NORMATIVO (el
    // guard del veredicto ya garantizó ese modo arriba). Fuente preferida
    // de la lista: `resumen.ensayosFaltantesPorNorma` que el backend
    // computa con la matriz prescriptiva completa. Como fallback (response
    // legacy sin ese campo), invocamos el mirror frontend.
    if (categoria === VEREDICTO.EVALUACION_INCOMPLETA) {
      let pendientesLineas = [];
      let noConcluyentesLineas = [];

      const faltantesBackend = resumen?.ensayosFaltantesPorNorma || [];
      if (faltantesBackend.length > 0) {
        pendientesLineas = faltantesBackend.map((f) => {
          const nombre = sanitizeUnicode(f.nombre || f.codigo);
          const norma = f.normaRef ? ` (${f.normaRef})` : '';
          return `${nombre}${norma}: ${f.motivo}`;
        });
      } else {
        // Fallback: response legacy sin `ensayosFaltantesPorNorma`. Usa el
        // engine puro del mirror frontend en modo NORMATIVO.
        const tipoAgregadoNorm = (agregadoTipo || '').toString().toUpperCase();
        const evalRes = evaluarMaterial(
          {
            items: resumen?.items || [],
            contextoAgregado,
            tipoAgregado: tipoAgregadoNorm || null,
          },
          { modo: 'NORMATIVO' }
        );
        pendientesLineas = (evalRes.ensayosFaltantes || []).map((f) => {
          const nombre = sanitizeUnicode(f.nombre);
          const norma = f.normaRef ? ` (${f.normaRef})` : '';
          return `${nombre}${norma}: ${f.motivo}`;
        });
        noConcluyentesLineas = (evalRes.ensayosNoConcluyentes || []).map((nc) => {
          const nombre = sanitizeUnicode(nc.nombre);
          const norma = nc.normaRef ? ` (${nc.normaRef})` : '';
          return `${nombre}${norma}: ${nc.motivo}`;
        });
      }

      // Items presentes pero con compliance pending/notEvaluated/inconclusive
      // se agregan a pendientes (sin duplicar).
      const pendingItems = items.filter((it) => {
        if (!tipoAplicaAlCtx(it.tipo)) return false;
        return it.compliance?.status === 'pending' ||
               it.compliance?.status === 'notEvaluated' ||
               it.compliance?.status === 'inconclusive';
      });
      for (const it of pendingItems) {
        const cod = it.tipo?.codigo;
        if (!cod) continue;
        if (pendientesLineas.some((l) => l.includes(cod))) continue;
        const tipoLabel = sanitizeUnicode(it.tipo?.nombre || cod);
        const norma = it.tipo?.normaRef ? ` (${it.tipo.normaRef})` : '';
        pendientesLineas.push(`${tipoLabel}${norma}: pendiente — exigido por la normativa vigente.`);
      }

      if (pendientesLineas.length) {
        renderLista('Ensayos pendientes para emitir dictamen definitivo:', pendientesLineas, getCategoriaPdfColor(VEREDICTO.EVALUACION_INCOMPLETA));
      }
      if (noConcluyentesLineas.length) {
        renderLista('Ensayos cargados sin veredicto concluyente:', noConcluyentesLineas, getCategoriaPdfColor(VEREDICTO.APTO_CON_OBSERVACIONES));
      }
      if (!pendientesLineas.length && !noConcluyentesLineas.length) {
        // Caso degradación sin contexto y sin items pending — explicar.
        checkPage(10);
        doc.setFont('Helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...C.muted);
        const txt = 'No se proporcionó contexto técnico de evaluación al generar este informe (datos legacy o material recientemente cargado). Para un dictamen definitivo, completar la evaluación con tipo de agregado, exposición prevista y resistencia objetivo.';
        const wrapped = doc.splitTextToSize(txt, contentW - 4);
        for (const w of wrapped) {
          checkPage(4);
          doc.text(w, margin + 2, y);
          y += 3.5;
        }
        y += 2;
        doc.setTextColor(...C.text);
      }
    }
  }

  /* ══════════════════════════════════════════
     Advertencia técnica — última sección del informe.
     Disclaimer general + alerta de clasificación si AgregadoMeta la registra.
     Va al final por convención: el dictamen va antes que el disclaimer.
     ══════════════════════════════════════════ */
  if (advertencia) {
    sectionTitle(sectionLabel('Advertencia técnica'));

    // Decisión 2026-05-28: el texto de la advertencia se adapta al modo.
    // En DESCRIPTIVO se explicita que el documento NO emite juicio normativo
    // y se remite al modo NORMATIVO para la verificación formal.
    // La altura de la caja se calcula dinámicamente para no cortar el texto.
    const advertText = _modoNorm === 'NORMATIVO'
      ? ('Esta ficha técnica se genera automáticamente a partir de los datos del sistema. '
        + 'Los valores de caracterización corresponden al ensayo más reciente para cada propiedad y pueden '
        + 'haber sido obtenidos en distintas fechas. Verificar vigencia antes de usar en diseños de mezcla. '
        + 'TMN y módulo de finura son derivados del ensayo granulométrico indicado. '
        + 'El veredicto de aptitud se emite contra la matriz CIRSOC 200:2024 + serie IRAM, sin filtros del plan de control de calidad de la planta productora.')
      : ('Este documento es DESCRIPTIVO. Lista los datos del agregado (caracterización, ensayos realizados, '
        + 'granulometría medida) sin emitir valoración normativa. No declara CUMPLE / NO CUMPLE / APTO / NO APTO. '
        + 'Para una verificación normativa formal contra CIRSOC 200:2024 + serie IRAM (auditoría externa, '
        + 'licitación, contraste técnico), generar el documento en modo Normativo. '
        + 'Los valores de caracterización corresponden al ensayo más reciente para cada propiedad.');
    // Decisión 2026-05-28 (sesión 4 — caja full-width + font 10pt + justify):
    //
    // El usuario quiere: caja full-width + texto que ocupe el ancho + sin
    // espaciado inflado. Las sesiones previas mostraron que a 8pt el texto
    // satura naturalmente solo ~75% del ancho de la caja, por lo que
    // justify a 8pt infla los espacios 5-9× (palabras flotando) y
    // left-align deja 25% vacío.
    //
    // Solución: subir font-size a 10pt. A 10pt cada carácter es 25% más
    // ancho, así que las líneas naturales saturan ~94% del ancho (vs 75%
    // a 8pt). El surplus a justificar pasa de 25% a ~6% — Tw resultante
    // de ~1mm extra por gap (2× natural, dentro del rango aceptable).
    // Es la diferencia entre "justify mal aplicado por baja saturación" y
    // "justify aplicado a texto que ya satura ~94% naturalmente".
    //
    // Trade-off: el cuadro queda más alto y el texto se ve un poco más
    // "loud" para un disclaimer — pero ese es justamente el rol de una
    // ADVERTENCIA. Y aprovecha el ancho del banner como pidió el usuario.
    const bodySize = 10;
    const titleSize = 11;
    const lineH = 4.8;
    const padX = 3;

    doc.setFontSize(bodySize);
    doc.setFont('Helvetica', 'normal');
    const advertLines = doc.splitTextToSize(advertText, contentW - padX * 2);
    const boxH = 9 + advertLines.length * lineH;

    checkPage(boxH + 4);
    doc.setFillColor(255, 243, 205);
    doc.roundedRect(margin, y, contentW, boxH, 1.5, 1.5, 'F');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(titleSize);
    doc.setTextColor(146, 64, 14);
    doc.text('ADVERTENCIA', margin + padX, y + 6);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(bodySize);
    doc.setTextColor(92, 51, 23);
    // Justify: el cap de Tw aceptable es alto porque saturación natural ~94%.
    // La última línea queda left-aligned (estándar de jsPDF — correcto).
    doc.text(advertLines, margin + padX, y + 12, {
      align: 'justify',
      maxWidth: contentW - padX * 2,
      lineHeightFactor: 1.15,
    });
    y += boxH + 6;

    // Classification warning from AgregadoMeta
    const alertaClasif = meta?.alertaClasificacion;
    if (alertaClasif) {
        checkPage(15);
        doc.setFontSize(8);
        doc.setFont('Helvetica', 'bold');
        doc.setTextColor(...C.danger);
        doc.text('NOTA:', margin + 2, y);
        doc.setFont('Helvetica', 'normal');
        doc.setTextColor(...C.text);
        y += 4;
        const alertLines = doc.splitTextToSize(alertaClasif.mensaje, contentW - 4);
        for (const line of alertLines) {
            checkPage(4);
            doc.text(line, margin + 2, y);
            y += 3.5;
        }
        y += 3;
    }
  }

  /* ── Footer on every page ── */
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.setFont('Helvetica', 'normal');
    doc.text('Hormiqual — Ficha técnica del agregado', margin, pageH - 8);
    doc.text(`Página ${i} de ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' });
    doc.text(`Generado: ${fmtDate()}`, pageW / 2, pageH - 8, { align: 'center' });
  }

  /* ── Save ── */
  const nameSlug = slug(agregadoNombre) || `agregado_${legacyAgregadoId}`;
  doc.save(`ficha_tecnica_${nameSlug}_${fmtDateFile()}.pdf`);
}
