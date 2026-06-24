import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { generarIRAM1627SVG } from '../dosificacion-diseno/iram1627Svg.js';
import { getCategoriaPdfColor } from '../../../lib/compliance/pdfPresentation';
import { VEREDICTO } from '../../../lib/compliance';
// shilstoneSvg is CJS — imported dynamically where used (same pattern as dosificación PDF)

/* ───────── Categorización de hits cumple/CUMPLE en este archivo (Prompt 3 C9.4) ─────────
 *
 * Este archivo es un caso especial documentado en DEFERRED.md D26:
 * coexiste un modelo prestacional de mezcla (6 estados) con el modelo
 * canónico de compliance (7 categorías). La decisión deliberada de dominio
 * (ver comentario inline en `consolidarEstadoMezcla` ~L139) es:
 *   - Reservar NO_CUMPLE para casos verdaderamente bloqueantes
 *   - Encauzar desvíos gestionables a CON_DESVIOS / REQUIERE_AJUSTE con
 *     lenguaje no-terminal (gestionable con pastón de prueba)
 *   - Distinguir conformidad normativa de viabilidad técnica
 *
 * Por eso C9.4 (camino α aprobado por stakeholder) migra MUY POCOS sitios:
 *
 * (A) DISPLAY per CELDA en tabla cumplimiento — migrado:
 *     - `didParseCell` de `_renderCumplTable` (~L1975) — color canónico
 *       (mismo patrón que C9.3); texto técnico por celda preservado
 *       ('Cumple' / 'Cumple (LD)' / 'Cumple (>)' / 'No cumple' / 'Info.' /
 *        'No concluyente' / 'Sin dato').
 *
 * (B) MODELO PRESTACIONAL preservado por D26:
 *     - `consolidarEstadoMezcla` con sus 6 estados (CUMPLE / CUMPLE_OBS /
 *       REQUIERE_AJUSTE / CON_DESVIOS / NO_CUMPLE / INCOMPLETA)
 *     - `ESTADO_MEZCLA_LABELS` / `ESTADO_MEZCLA_COLORS` / `VIAB_MEZCLA_LABELS`
 *     - Textos formales del consolidador (conclusion por estado)
 *
 *     `bandaLabel` (~L1137) — display per-banda con vocabulario propio
 *     ("CUMPLE BANDA" / "CUMPLE BANDA A-C (no cumple A-B)" /
 *      "CUMPLE BANDA CON OBSERVACIONES" / "NO CUMPLE BANDA"). Acoplado al
 *     output de `evaluarContraBanda` (D21 — fuera del scope canónico).
 *
 *     `c.cumple95` (~L2308) — trace flag de trazabilidad de cálculo (>= 95%
 *     pasante para selección TMN), NO veredicto. Renderiza 'Sí' / 'No'.
 *
 * (C) COMENTARIOS + REGLAS NORMATIVAS preservados.
 *
 * Trigger que dispararía la canonización del consolidador: ver D26 en
 * DEFERRED.md (resumido: certificado formal de mezcla que requiera veredicto
 * canónico cross-módulo). No hay caller hoy que lo demande.
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
  headerFg:  [255, 255, 255],
  tableBg:   [235, 245, 251],
};

/* ════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════ */
function fmtDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateFile() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function slug(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

/** Generate a short unique report ID based on timestamp + random. */
function generateReportId(prefix = 'MZC') {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rnd = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}

/** Format number with comma decimal separator (Argentine convention). */
function fmtNum(value, digits = 2) {
  if (value == null || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  // B3/M1: force comma decimal, no thousands separator (avoid ambiguity "1.208")
  const s = num.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
  return s.replace('.', ',');
}

/** Short decimal formatter (comma separator). */
// M9 (auditoría 01-calidad): guardia Number.isFinite. Antes, valores no
// numéricos (strings vacíos, NaN del backend, undefined explícito) imprimían
// literal "NaN" en el PDF. Ahora caen al placeholder "—" como fmtNum.
const fmtDec = (v, d = 1) => {
  if (v == null) return '—';
  const num = Number(v);
  if (!Number.isFinite(num)) return '—';
  return num.toFixed(d).replace('.', ',');
};

/** Sanitize text for PDF — replace Unicode symbols unsupported by standard fonts */
const sanitizePdf = (s) => typeof s === 'string'
  ? s.replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≠/g, '<>').replace(/±/g, '+/-').replace(/³/g, '3').replace(/²/g, '2').replace(/μ/g, 'u')
     // BUG-7: collapse exactly double periods (preserve "..." ellipsis and longer runs)
     .replace(/(?<!\.)\.\.(?!\.)/g, '.')
  : s;

/* ════════════════════════════════════════════════════════
   Estado de la mezcla — modelo prestacional (filosofía 2026)
   ════════════════════════════════════════════════════════
   El consolidador previo emitía "NO_CUMPLE" como veredicto terminal apenas
   había más de 2 tamices fuera de banda, confundiendo "no conformidad
   normativa" con "inviabilidad técnica". El modelo nuevo:

   - Reserva NO_CUMPLE para casos verdaderamente bloqueantes (mezcla sin
     curva, datos insuficientes que impiden cualquier validación, o desvíos
     extremos > 8 pp en muchos tamices).
   - Encauza los desvíos gestionables a CON_DESVIOS o REQUIERE_AJUSTE, con
     lenguaje no terminal: el material puede seguir siendo viable con
     pastón de prueba y aceptación técnica del desvío.
   - Mantiene visibles todos los hallazgos: nada se omite.

   Estados:
   - CUMPLE             — banda satisfecha, sin observaciones
   - CUMPLE_OBS         — desvíos menores, dentro de criterio
   - REQUIERE_AJUSTE    — desvíos puntuales gestionables con ajuste
   - CON_DESVIOS        — desvíos relevantes respecto del criterio normativo
                          (no equivale a "inviable": gestionable con pastón)
   - NO_CUMPLE          — incompatibilidad real (datos insuficientes para
                          validar, o desvíos extremos no gestionables)
   - INCOMPLETA         — sin curva o sin evaluación */
const ESTADO_MEZCLA_LABELS = {
  CUMPLE:          'Cumple banda IRAM 1627',
  CUMPLE_OBS:      'Cumple con observaciones',
  REQUIERE_AJUSTE: 'Requiere ajuste menor',
  CON_DESVIOS:     'Con desvíos respecto del criterio normativo',
  NO_CUMPLE:       'Bloqueante a resolver',
  INCOMPLETA:      'Incompleta — datos insuficientes',
};
const ESTADO_MEZCLA_COLORS = {
  CUMPLE:          [21, 128, 61],
  CUMPLE_OBS:      [180, 120, 20],
  REQUIERE_AJUSTE: [200, 100, 10],
  CON_DESVIOS:     [180, 120, 20],
  NO_CUMPLE:       [192, 57, 43],
  INCOMPLETA:      [100, 100, 140],
};

// Etiquetas adicionales para los ejes prestacionales (no rompen ningún
// renderer existente; los consume opcionalmente la portada).
const VIAB_MEZCLA_LABELS = {
  FAVORABLE:               'Favorable',
  POTENCIALMENTE_VIABLE:   'Potencialmente viable',
  CONDICIONADA:            'Condicionada a validación',
  RIESGO_ALTO:             'Riesgo técnico alto',
};
const VIAB_MEZCLA_COLORS = {
  FAVORABLE:             [21, 128, 61],
  POTENCIALMENTE_VIABLE: [180, 120, 20],
  CONDICIONADA:          [200, 100, 10],
  RIESGO_ALTO:           [192, 57, 43],
};

/**
 * Consolida el estado técnico de una mezcla bajo la filosofía prestacional.
 * Retorna { estado, motivos, conclusion, estadoCatalogo, viabilidadTecnica,
 *           conformidadNormativa, fortalezas }.
 */
function consolidarEstadoMezcla({ evalBanda, evalTeorica, resumen, optimizacion, curvaMix, tipoMezcla, isDraft, zonaLabel, fdg, fdt, mf, estado }) {
  const motivos = [];
  const fortalezas = [];
  let hayDesvio = false;       // desvío gestionable (antes "bloqueante" leve)
  let hayDesvioRelevante = false; // desvío fuerte pero NO inviable
  let hayObservacion = false;
  let hayIncompleto = false;

  // 1) Banda granulométrica — soporta dual A-B / A-C del backend
  const cumpleBanda = evalBanda?.cumple ?? resumen?.bandaCumple;
  const estadoBanda = evalBanda?.estado;
  const tamicesFuera = evalBanda?.fueraDeBanda || resumen?.tamicesFuera || [];
  const bandaRef = evalBanda?.bandaEvaluada || '';

  if (estadoBanda === 'CUMPLE_AC') {
    hayObservacion = true;
    const nFueraAB = evalBanda?.stats?.nFueraAB || tamicesFuera.length;
    const maxDesvAB = evalBanda?.stats?.maxDesvioAB || tamicesFuera.reduce((m, t) => Math.max(m, Math.abs(t.desvio || 0)), 0);
    const dec = maxDesvAB < 1 ? 2 : 1;
    motivos.push(`Cumple banda A-C pero no A-B (${nFueraAB} tamiz(es) fuera de A-B, desvío máx. ${maxDesvAB.toFixed(dec).replace('.', ',')} pp).`);
  } else if (cumpleBanda === false) {
    const nFuera = tamicesFuera.length;
    const maxDesvio = tamicesFuera.reduce((m, t) => Math.max(m, Math.abs(t.desvio || 0)), 0);
    if (nFuera <= 2 && maxDesvio <= 3) {
      hayObservacion = true;
      const decDesvio = maxDesvio < 1 ? 2 : 1;
      motivos.push(`${nFuera} tamiz(es) fuera de banda (desvío máx. ${maxDesvio.toFixed(decDesvio).replace('.', ',')} pp) — ajuste menor recomendado.`);
    } else {
      hayDesvio = true;
      // Solo elevamos a "desvío relevante" cuando los apartamientos son grandes
      // O numerosos, no por el simple hecho de salirse de banda.
      if (nFuera > 5 || maxDesvio > 8) hayDesvioRelevante = true;
      const decDesvioMax = maxDesvio < 1 ? 2 : 1;
      motivos.push(`${nFuera} tamiz(es) fuera de banda ${bandaRef || 'IRAM 1627'} (desvío máx. ${maxDesvio.toFixed(decDesvioMax).replace('.', ',')} pp). El desvío es respecto del criterio normativo de referencia, no implica inviabilidad técnica.`);
      for (const t of tamicesFuera.slice(0, 3)) {
        const ab = t.tamiz || `${t.aberturaMm} mm`;
        const dec = (t.desvio != null && Math.abs(t.desvio) < 1) ? 2 : 1;
        const dev = t.desvio != null ? ` (desvío ${t.desvio > 0 ? '+' : ''}${t.desvio.toFixed(dec).replace('.', ',')} pp)` : '';
        motivos.push(`  Tamiz ${ab}${dev}.`);
      }
    }
  } else if (cumpleBanda === true) {
    fortalezas.push('Mezcla dentro de la banda IRAM 1627.');
  } else if (cumpleBanda == null && tipoMezcla === 'TOTAL') {
    hayIncompleto = true;
    motivos.push('Sin evaluación contra banda granulométrica.');
  }

  // 2) Zona Shilstone (orientativo — solo refuerza el diagnóstico)
  if (zonaLabel && tipoMezcla === 'TOTAL') {
    if (zonaLabel.includes('V')) { hayObservacion = true; motivos.push('Indicador Shilstone: tendencia a exceso de fracción gruesa (Zona V, orientativo).'); }
    else if (zonaLabel.includes('I') && !zonaLabel.includes('II') && !zonaLabel.includes('III')) { hayObservacion = true; motivos.push('Indicador Shilstone: mezcla con graduación desfavorable (Zona I, orientativo).'); }
    else if (zonaLabel.includes('IV')) { hayObservacion = true; motivos.push('Indicador Shilstone: tendencia a exceso de finos (Zona IV, orientativo).'); }
  }

  // 3) Completitud de datos granulométricos
  if (!curvaMix || curvaMix.length < 5) {
    hayIncompleto = true;
    motivos.push('Datos granulométricos insuficientes.');
  }

  // 4) Estado consolidado — la jerarquía privilegia la gestionabilidad.
  //    NO_CUMPLE solo si hay incompatibilidad real (sin curva + datos insuficientes
  //    O desvíos extremos en muchos tamices). Todo lo demás es gestionable.
  let estadoGlobal;
  if (hayIncompleto && !curvaMix) estadoGlobal = 'NO_CUMPLE';
  else if (hayIncompleto) estadoGlobal = 'INCOMPLETA';
  else if (hayDesvioRelevante) estadoGlobal = 'CON_DESVIOS';
  else if (hayDesvio) estadoGlobal = 'REQUIERE_AJUSTE';
  else if (hayObservacion) estadoGlobal = 'CUMPLE_OBS';
  else estadoGlobal = 'CUMPLE';

  // 5) Estado de catálogo / liberación
  let estadoCatalogo;
  if (isDraft) estadoCatalogo = 'Diseño no guardado (borrador de trabajo)';
  else {
    const st = (estado || 'BORRADOR').toUpperCase();
    const map = {
      BORRADOR: 'Guardada como borrador — no liberada',
      A_PRUEBA: 'En período de prueba — no liberada',
      PENDIENTE_REVISION: 'Pendiente de revisión — no liberada',
      APROBADO: 'Aprobada y liberada para uso',
      SUSPENDIDO: 'Suspendida — no disponible',
      ARCHIVADO: 'Archivada',
    };
    estadoCatalogo = map[st] || `Estado: ${st}`;
  }

  // 6) Conclusión técnica con lenguaje no terminal
  let conclusion = '';
  if (estadoGlobal === 'CUMPLE') {
    conclusion = 'Mezcla dentro de los requisitos granulométricos. Favorable como esqueleto árido base para dosificación.';
  } else if (estadoGlobal === 'CUMPLE_OBS') {
    conclusion = 'Mezcla utilizable con observaciones menores. Verificar en pastón de prueba antes de liberar.';
  } else if (estadoGlobal === 'REQUIERE_AJUSTE') {
    const tieneExcesoGrueso = zonaLabel?.includes('V') || tamicesFuera.some(t => (t.desvio || 0) < 0);
    const tieneExcesoFino = zonaLabel?.includes('IV') || tamicesFuera.some(t => (t.desvio || 0) > 0);
    if (tieneExcesoGrueso) {
      conclusion = 'Mezcla con exceso de fracción gruesa respecto de la banda. Gestionable incrementando el aporte de fracción fina o intermedia y verificando nuevamente.';
    } else if (tieneExcesoFino) {
      conclusion = 'Mezcla con exceso de fracción fina respecto de la banda. Gestionable incrementando el aporte de fracción gruesa y verificando nuevamente.';
    } else {
      conclusion = 'Mezcla con desvíos puntuales respecto de la banda. Gestionable con ajuste de proporciones y verificación nueva contra el criterio normativo.';
    }
  } else if (estadoGlobal === 'CON_DESVIOS') {
    conclusion = 'Mezcla con desvíos relevantes respecto del criterio normativo de referencia. Su uso queda condicionado a aceptación técnica del desvío y validación experimental. La condición no implica inviabilidad técnica per se: el desempeño debe respaldarse con pastón de prueba antes de cualquier liberación.';
  } else if (estadoGlobal === 'NO_CUMPLE') {
    conclusion = 'Bloqueante a resolver: los datos disponibles no permiten validar la mezcla en su estado actual. Completar ensayos granulométricos o revisar la composición antes de avanzar.';
  } else {
    conclusion = 'Datos insuficientes para evaluar la mezcla. Completar ensayos granulométricos antes de cualquier liberación.';
  }

  // 7) Ejes prestacionales adicionales (consumibles por la portada)
  let conformidadNormativa;
  if (estadoGlobal === 'CUMPLE') conformidadNormativa = 'CONFORME';
  else if (estadoGlobal === 'CUMPLE_OBS') conformidadNormativa = 'CONFORME';
  else if (estadoGlobal === 'REQUIERE_AJUSTE') conformidadNormativa = 'CON_DESVIOS';
  else if (estadoGlobal === 'CON_DESVIOS') conformidadNormativa = 'NO_CONFORME';
  else if (estadoGlobal === 'INCOMPLETA') conformidadNormativa = 'NO_CONCLUYENTE';
  else conformidadNormativa = 'NO_CONFORME';

  let viabilidadTecnica;
  if (estadoGlobal === 'CUMPLE') viabilidadTecnica = 'FAVORABLE';
  else if (estadoGlobal === 'CUMPLE_OBS') viabilidadTecnica = 'FAVORABLE';
  else if (estadoGlobal === 'REQUIERE_AJUSTE') viabilidadTecnica = 'POTENCIALMENTE_VIABLE';
  else if (estadoGlobal === 'CON_DESVIOS') viabilidadTecnica = 'CONDICIONADA';
  else if (estadoGlobal === 'NO_CUMPLE') viabilidadTecnica = 'RIESGO_ALTO';
  else viabilidadTecnica = 'CONDICIONADA';

  return {
    estado: estadoGlobal,
    motivos: motivos.slice(0, 6),
    conclusion,
    estadoCatalogo,
    conformidadNormativa,
    viabilidadTecnica,
    fortalezas,
  };
}

/**
 * ASTM-alternative → IRAM principal series mapping.
 * Keys are ASTM/alt values, values are IRAM standard values.
 */
const ALT_TO_STD = { 50: 53, 25: 26.5, 12.5: 13.2, 4.8: 4.75, 2.4: 2.36, 1.2: 1.18, 13: 13.2 };

/**
 * M10 (auditoría 01-calidad): cálculo de Shilstone (FdG/FdT/zona) extraído a
 * helper para no duplicarlo entre el pre-compute de consolidación y la sección
 * de indicadores del informe. Antes vivía en dos bloques (líneas ~760 y ~1430)
 * con micro-divergencias en el redondeo.
 *
 * @param {Array} curvaMix    — [{ aberturaMm, pasaPct }] curva combinada
 * @returns {{ fdg:number|null, fdt:number|null, zonaLabel:string|null }}
 */
function calcularShilstoneDesdeCurva(curvaMix) {
  if (!Array.isArray(curvaMix) || curvaMix.length === 0) {
    return { fdg: null, fdt: null, zonaLabel: null };
  }
  const granMap = {};
  for (const p of curvaMix) {
    const ab = p.aberturaMm ?? p.abertura;
    const pasa = p.pasaPct ?? p.pasa;
    if (ab != null && pasa != null) granMap[ALT_TO_STD[ab] ?? ab] = Number(pasa);
  }
  const pas9_5  = granMap[9.5];
  const pas2_36 = granMap[2.36];
  const retAcum9_5  = pas9_5  != null ? 100 - pas9_5  : null;
  const retAcum2_36 = pas2_36 != null ? 100 - pas2_36 : null;
  const fdg = (retAcum9_5 != null && retAcum2_36 != null && retAcum2_36 > 0)
    ? Math.round((retAcum9_5 / retAcum2_36) * 1000) / 10
    : null;
  const fdt = pas2_36 != null ? Math.round(pas2_36 * 10) / 10 : null;
  let zonaLabel = null;
  if (fdg != null && fdt != null) {
    const limInf = 0.125 * fdg + 27.25;
    const limSup = 0.125 * fdg + 35.25;
    if (fdg > 75) zonaLabel = 'I — Mal graduado';
    else if (fdg < 25 && fdt < limInf) zonaLabel = 'III — Óptima (Dmax <= 12,5 mm)';
    else if (fdt > limSup && fdg <= 75) zonaLabel = 'IV — Exceso de finos';
    else if (fdt < limInf && fdg >= 25 && fdg <= 75) zonaLabel = 'V — Exceso de gruesos';
    else if (fdt >= limInf && fdt <= limSup) zonaLabel = 'II — Deseable';
  }
  return { fdg, fdt, zonaLabel };
}

/**
 * Normalize a tamiz label to IRAM standard series with comma decimal separator.
 * E.g. "4.8 mm" → "4,75 mm", "0.15 mm" → "0,15 mm"
 */
/**
 * Format abertura value per IRAM convention:
 * Sub-mm: 3 decimals (0,150 / 0,300 / 0,600)
 * 1-9.99 mm: 2 decimals if needed (1,18 / 2,36 / 4,75 / 9,5)
 * >=10 mm: 1 decimal if fractional, 0 if integer (13,2 / 19 / 26,5 / 37,5)
 */
function fmtAbertura(val) {
  if (val < 1) return fmtDec(val, 3);
  if (val < 10) {
    // Use minimum decimals needed: 4.75→2, 9.5→1
    const s = String(val);
    const decPart = s.includes('.') ? s.split('.')[1].length : 0;
    return fmtDec(val, Math.max(decPart, 1));
  }
  // >=10: 1 decimal if fractional, 0 if integer
  return val % 1 === 0 ? fmtDec(val, 0) : fmtDec(val, 1);
}

function normTamiz(label, aberturaMm) {
  const ab = aberturaMm != null ? Number(aberturaMm) : null;
  if (ab != null && Number.isFinite(ab)) {
    const std = ALT_TO_STD[ab] ?? ab;
    return `${fmtAbertura(std)} mm`;
  }
  if (typeof label === 'string') {
    const m = label.match(/^([\d.]+)\s*mm$/);
    if (m) {
      const raw = Number(m[1]);
      const std = ALT_TO_STD[raw] ?? raw;
      return `${fmtAbertura(std)} mm`;
    }
  }
  return label || '—';
}

function normAbertura(ab) {
  if (ab == null) return '—';
  const num = Number(ab);
  if (!Number.isFinite(num)) return String(ab);
  const std = ALT_TO_STD[num] ?? num;
  return fmtAbertura(std);
}

/**
 * Build F1/F2/G1/G2 aliases for componentes.
 * F = Fino, G = Grueso. Numbered per-group in order of appearance.
 * Returns { aliases: ['F1','F2','G1','G2'], legend: [{ alias, nombre }] }
 */
function buildAliases(componentes) {
  const counters = { F: 0, G: 0, X: 0 };
  const aliases = componentes.map(c => {
    const prefix = c.tipo === 'Fino' ? 'F' : c.tipo === 'Grueso' ? 'G' : 'X';
    counters[prefix] += 1;
    return `${prefix}${counters[prefix]}`;
  });
  const legend = componentes.map((c, i) => ({
    alias: aliases[i],
    nombre: c.nombre || `ID ${c.id}`,
    origen: c.origen || '',
  }));
  return { aliases, legend };
}

/**
 * Render alias legend block in the PDF.
 */
function renderAliasLegend(doc, legend, margin, y, checkPage) {
  checkPage(6 + legend.length * 3.5);
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...C.secondary);
  doc.text('Referencias de componentes:', margin + 4, y);
  y += 3.5;
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.text);
  for (const item of legend) {
    const line = item.origen
      ? `${item.alias} = ${item.nombre} (${item.origen})`
      : `${item.alias} = ${item.nombre}`;
    doc.text(line, margin + 6, y);
    y += 3.5;
    checkPage(4);
  }
  y += 2;
  return y;
}

/**
 * Compute margin alerts from banda evaluation data.
 * Shared between page 3 summary and Anexo A.5 detail.
 * @param {Object} evalBanda - banda evaluation result
 * @param {Array}  curvaMix  - mix curve points
 * @param {Object} trz       - trazabilidad object (optional, for A.5 rows)
 * @returns {Array} margin alerts with { tamiz, lado, margin, level }
 */
function computeMarginAlerts(evalBanda, curvaMix, trz) {
  const rawAlerts = [];

  // Helper: skip trivial points (both limits at 100%, or pasa at 0/100 exactly)
  const isTrivia = (limInf, limSup, pasa) => (limInf >= 99 && limSup >= 99) || pasa >= 99.5 || pasa <= 0.5;

  // Use trazabilidad rows if available (most complete), fallback to evalBanda series
  const rows = trz?.banda?.rows;
  if (rows?.length) {
    for (const r of rows) {
      if (r.estado !== 'DENTRO') continue;
      if (isTrivia(r.limInf, r.limSup, r.pasaMix)) continue;
      if (r.limInf != null && r.pasaMix != null) {
        const m = Number((r.pasaMix - r.limInf).toFixed(1));
        if (m > 0 && m < 3) rawAlerts.push({ tamiz: normTamiz(r.tamiz, r.aberturaMm), lado: 'inferior', margin: m, level: m < 1 ? 'PREVENTIVO' : 'PREVENTIVO', ab: r.aberturaMm });
      }
      if (r.limSup != null && r.pasaMix != null) {
        const m = Number((r.limSup - r.pasaMix).toFixed(1));
        if (m > 0 && m < 3) rawAlerts.push({ tamiz: normTamiz(r.tamiz, r.aberturaMm), lado: 'superior', margin: m, level: m < 1 ? 'PREVENTIVO' : 'PREVENTIVO', ab: r.aberturaMm });
      }
    }
  } else if (evalBanda) {
    // Fallback: compute from evalBanda series
    const bandaPuntos = evalBanda.series?.bandaMin || [];
    const bandaMax = evalBanda.series?.bandaMax || [];
    const mixDesc = (curvaMix || []).filter(p => p.pasaPct !== null).sort((a, b) => b.aberturaMm - a.aberturaMm);
    for (const bp of bandaPuntos) {
      const ab = bp.aberturaMm;
      const limInf = bp.pasaPct;
      const maxPt = bandaMax.find(m => Math.abs(m.aberturaMm - ab) < 0.01);
      const limSup = maxPt?.pasaPct;
      const mixPt = mixDesc.find(p => Math.abs(p.aberturaMm - ab) < 0.01);
      if (!mixPt || mixPt.pasaPct == null) continue;
      if (isTrivia(limInf, limSup, mixPt.pasaPct)) continue;
      const val = mixPt.pasaPct;
      if (limInf != null && val >= limInf && val - limInf < 3 && val - limInf > 0) {
        const m = Number((val - limInf).toFixed(1));
        rawAlerts.push({ tamiz: normTamiz(null, ab), lado: 'inferior', margin: m, level: 'PREVENTIVO', ab });
      }
      if (limSup != null && val <= limSup && limSup - val < 3 && limSup - val > 0) {
        const m = Number((limSup - val).toFixed(1));
        rawAlerts.push({ tamiz: normTamiz(null, ab), lado: 'superior', margin: m, level: 'PREVENTIVO', ab });
      }
    }
  }

  // Sort by severity (CRÍTICO first), then by margin ascending. Limit to top 5.
  rawAlerts.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'CRÍTICO' ? -1 : 1;
    return a.margin - b.margin;
  });
  return rawAlerts.slice(0, 5);
}

// Optimization method label map
const OPTIM_METHOD_LABELS = {
  combined_banda_first: 'Combinado (banda prioritaria)',
  combined_curva_first: 'Combinado (curva teórica prioritaria)',
  banda_only:           'Banda normativa',
  curva_only:           'Curva teórica',
  manual:               'Manual (proporciones fijas)',
  brute_force:          'Búsqueda exhaustiva',
  linear:               'Optimización lineal',
  band_min_violation:   'Minimización de violación de banda',
  band_feasible:        'Banda factible',
  curve_fit:            'Ajuste a curva teórica',
  grid_search:          'Búsqueda en grilla',
  combined_fixed:       'Combinado (pesos fijos)',
  lp_theoretical_fit:   'Ajuste teórico (programación lineal)',
  fixed:                'Pesos fijos',
  sugerencia_automatica: 'Optimización granulométrica automática',
  AUTOMATICA:           'Optimización automática HormiQual',
};
function translateOptMethod(m) {
  if (!m) return 'No especificado';
  return OPTIM_METHOD_LABELS[m] || m.replace(/_/g, ' ');
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
  } catch {
    return null;
  }
}

/* ════════════════════════════════════════════════════════
   Canvas capture helper — grabs the PrimeReact Chart canvas.
   Used as fallback for charts that don't have a vector SVG equivalent.
   For PDF charts, prefer the SVG approach (iram1627Svg.js / shilstoneSvg.js).
   ════════════════════════════════════════════════════════ */
function chartToBase64(chartRef) {
  try {
    const canvas = chartRef?.current?.getCanvas?.();
    if (canvas) return canvas.toDataURL('image/png');
  } catch { /* ignore */ }
  return null;
}

/* ════════════════════════════════════════════════════════
   Public: generate the PDF
   ════════════════════════════════════════════════════════ */

/**
 * @param {Object} opts
 * @param {boolean}  opts.isDraft
 * @param {string}   opts.nombre          — mezcla name (if saved)
 * @param {string}   opts.empresa         — company name
 * @param {string}   opts.planta          — plant name
 * @param {string}   opts.usuario         — user's full name
 * @param {string}   opts.tipoMezcla      — FINO|GRUESO|TOTAL
 * @param {string}   opts.modo            — MANUAL|AUTO
 * @param {string}   opts.objetivoModo    — BANDA|CURVA|COMBINADO
 * @param {string}   opts.prioridad1
 * @param {string}   opts.prioridad2
 * @param {number}   opts.tmn
 * @param {number}   opts.mf
 * @param {Array}    opts.componentes     — [{ nombre, tipo, origen, porcentaje }]
 * @param {Array}    opts.curvaMix        — [{ tamiz, aberturaMm, pasaPct, metodos }]
 * @param {Object}   opts.evalBanda       — banda eval result or null
 * @param {Object}   opts.evalTeorica     — teorica eval result or null
 * @param {Object}   opts.optimizacion    — { metodo, feasible, rangos, warnings, ... }
 * @param {Object}   opts.resumen         — { bandaCumple, fueraDeBanda, errorTeorico }
 * @param {Object}   opts.trazabilidad    — full trace object or null
 * @param {string}   opts.logoUrl         — cfg.thumbnail
 * @param {Object}   opts.chartImages     — { mix, banda, teorica, combinada } base64 strings
 * @param {string}   opts.descripcion     — optional description
 * @param {boolean}      opts.includeAnexo    — include Anexo A trazabilidad (default false)
 * @param {boolean}      opts.includeGlosario — include glosario even without full anexo (default true)
 * @param {string}       opts.ordenAgregados  — 'actual' | 'auto' (default 'actual')
 * @param {string|null}  opts.bandaRef        — full display label of the selected banda normativa
 * @param {string|null}  opts.teoricaRef      — full display label of the selected curva teórica
 * @param {number|null}  opts.bandaTmn        — TMN (mm) of the selected banda normativa
 */
export async function generarInformeMezclaPdf(opts) {
  const {
    isDraft = true,
    nombre,
    empresa,
    planta,
    usuario,
    tipoMezcla,
    modo,
    objetivoModo,
    prioridad1,
    prioridad2,
    tmn,
    mf,
    componentes = [],
    curvaMix = [],
    evalBanda,
    evalTeorica,
    optimizacion,
    resumen,
    trazabilidad,
    logoUrl,
    chartImages = {},
    descripcion,
    includeAnexo = false,
    includeGlosario = true,
    ordenAgregados = 'actual',
    bandaRef,
    teoricaRef,
    bandaTmn,
    ajusteMetadata,
    propsCombinadas,
    evaluacionProps,
    bandaNormativa,  // { bandaAB: [{aberturaMm, limInf, limSup}], bandaAC: [...], tmnMm, tablaRef }
    // PR9.3 — Modo de evaluación dual (PRESTACIONAL | PRESCRIPTIVO).
    // Default PRESTACIONAL: catálogo del tenant soberano. PRESCRIPTIVO se
    // usa para auditorías externas con verificación normativa estricta.
    modoEvaluacion = 'PRESTACIONAL',
  } = opts;
  const _modoNorm = String(modoEvaluacion).toUpperCase() === 'PRESCRIPTIVO'
    ? 'PRESCRIPTIVO'
    : 'PRESTACIONAL';

  // Sort componentes if auto ordering requested
  let sortedComps;
  if (ordenAgregados === 'auto') {
    const tipoOrder = { 'Fino': 0, 'Grueso': 1 };
    sortedComps = [...componentes].sort((a, b) => {
      const ta = tipoOrder[a.tipo] ?? 2;
      const tb = tipoOrder[b.tipo] ?? 2;
      if (ta !== tb) return ta - tb;
      return (b.porcentaje || 0) - (a.porcentaje || 0);
    });
  } else {
    sortedComps = [...componentes];
  }

  // Build alias map (F1/G1/…)
  const { aliases: compAliases, legend: compLegend } = buildAliases(sortedComps);

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 0;

  const logoData = await fetchLogoBase64(logoUrl);

  /* ── Page-break helper ── */
  function checkPage(need) {
    if (y + need > pageH - 20) {
      doc.addPage();
      y = 15;
    }
  }

  /* ── Section title helper ── */
  function sectionTitle(text, parentBookmark = null) {
    const barH = isSubType ? 6.5 : 8;
    checkPage(isSubType ? 11 : 14);
    y += isSubType ? 2.5 : 4;
    doc.setFillColor(...C.primary);
    doc.roundedRect(margin, y, contentW, barH, 1.5, 1.5, 'F');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(isSubType ? 9 : 10);
    doc.setTextColor(...C.white);
    doc.text(text, margin + 3, y + (isSubType ? 4.6 : 5.6));
    // PDF outline bookmark
    try {
      doc.outline.add(parentBookmark || null, text, { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
    } catch (_) { /* jsPDF version may not support outline */ }
    y += barH + (isSubType ? 3 : 4);
    doc.setTextColor(...C.text);
    doc.setFont('Helvetica', 'normal');
  }

  // Compact layout for sub-type reports (Finos/Gruesos)
  const isSubType = tipoMezcla === 'FINO' || tipoMezcla === 'GRUESO';
  const kvSpacing = isSubType ? 4.2 : 5;

  /* ── Key-value row helper ── */
  function kvRow(label, value, indent = 0) {
    checkPage(6);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(isSubType ? 8.5 : 9);
    doc.setTextColor(...C.muted);
    doc.text(label, margin + 2 + indent, y);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...C.text);
    doc.text(String(value ?? '—'), margin + 50 + indent, y);
    y += kvSpacing;
  }

  /* ══════════════════════════════════════════
     1) Header
     ══════════════════════════════════════════ */
  doc.setFillColor(...C.headerBg);
  doc.rect(0, 0, pageW, 34, 'F');

  if (logoData) {
    try { doc.addImage(logoData, 'PNG', margin, 5, 24, 24); } catch { /* ignore */ }
  }

  const titleX = logoData ? margin + 28 : margin + 2;
  const titulo = isDraft ? 'Diseño de mezcla — Borrador' : (nombre || 'Informe de mezcla');

  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...C.white);
  doc.text(titulo, titleX, 14);

  // Right-side metadata
  doc.setFontSize(8);
  doc.setTextColor(180, 200, 220);
  const rightX = pageW - margin;
  doc.text(fmtDate(), rightX, 10, { align: 'right' });
  if (planta) doc.text(`Planta: ${planta}`, rightX, 15, { align: 'right' });
  if (usuario) doc.text(`Usuario: ${usuario}`, rightX, 20, { align: 'right' });
  if (empresa) doc.text(empresa, rightX, 25, { align: 'right' });

  // Tipo badge
  doc.setFontSize(9);
  doc.setFont('Helvetica', 'bold');
  const tipoLabel = tipoMezcla === 'FINO' ? 'Finos' : tipoMezcla === 'GRUESO' ? 'Gruesos' : 'Total';
  const badgeColor = tipoMezcla === 'FINO' ? [52, 152, 219] : tipoMezcla === 'GRUESO' ? [243, 156, 18] : [46, 204, 113];
  const badgeW = doc.getTextWidth(tipoLabel) + 6;
  doc.setFillColor(...badgeColor);
  doc.roundedRect(titleX, 23, badgeW, 6, 1.5, 1.5, 'F');
  doc.setTextColor(...C.white);
  doc.text(tipoLabel, titleX + 3, 27.3);

  y = 40;

  // PR9.3 — Banner del modo de evaluación (post-header).
  if (_modoNorm === 'PRESCRIPTIVO') {
    doc.setFillColor(255, 243, 205);
    doc.setDrawColor(220, 170, 50);
    doc.rect(margin, y, pageW - 2 * margin, 9, 'FD');
    doc.setFontSize(8);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(133, 100, 4);
    doc.text('VERIFICACIÓN NORMATIVA ESTRICTA', margin + 3, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('Aplica todas las exigencias de CIRSOC 200:2024 e IRAM. Puede señalar verificaciones más amplias que las del plan de control de calidad habitual de la planta.',
      margin + 3, y + 7.5);
    y += 12;
  } else {
    doc.setFillColor(232, 244, 250);
    doc.setDrawColor(180, 210, 230);
    doc.rect(margin, y, pageW - 2 * margin, 6, 'FD');
    doc.setFontSize(7);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(60, 90, 120);
    doc.text('Evaluación según el plan de control de calidad de la planta productora.',
      margin + 3, y + 4);
    y += 9;
  }
  doc.setTextColor(...C.text);

  /* ══════════════════════════════════════════
     1b) Estado global de la mezcla
     ══════════════════════════════════════════ */
  // Pre-compute Shilstone zone for consolidation (M10: vía helper único).
  let _zonaLabel = null;
  if (curvaMix.length && tipoMezcla === 'TOTAL') {
    _zonaLabel = calcularShilstoneDesdeCurva(curvaMix).zonaLabel;
  }

  const estadoMezcla = consolidarEstadoMezcla({
    evalBanda, evalTeorica, resumen, optimizacion, curvaMix, tipoMezcla, isDraft,
    zonaLabel: _zonaLabel, fdg: null, fdt: null, mf, estado: opts.estado,
  });

  // Render multi-axis state block (filosofía prestacional)
  {
    const egColor = ESTADO_MEZCLA_COLORS[estadoMezcla.estado] || [100, 100, 100];
    const egLabel = ESTADO_MEZCLA_LABELS[estadoMezcla.estado] || estadoMezcla.estado;
    const egMotivos = estadoMezcla.motivos;

    // (1) Header bar — estado del esqueleto árido (no terminal)
    const headerH = 9;
    doc.setFillColor(egColor[0], egColor[1], egColor[2]);
    doc.roundedRect(margin, y, contentW, headerH, 2, 2, 'F');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(sanitizePdf(`Estado del esqueleto árido: ${egLabel}`), margin + 4, y + 6);
    // Catálogo (esquina derecha)
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(sanitizePdf(estadoMezcla.estadoCatalogo), pageW - margin - 4, y + 6, { align: 'right' });
    y += headerH + 1;

    // (2) Tabla compacta de 2 ejes prestacionales
    const ejes = [
      {
        label: 'Conformidad normativa',
        value: estadoMezcla.conformidadNormativa === 'CONFORME' ? 'Conforme'
             : estadoMezcla.conformidadNormativa === 'CON_DESVIOS' ? 'Con desvíos respecto del criterio normativo'
             : estadoMezcla.conformidadNormativa === 'NO_CONFORME' ? 'No conforme al criterio normativo'
             : 'No concluyente',
        color: estadoMezcla.conformidadNormativa === 'CONFORME' ? [21, 128, 61]
             : estadoMezcla.conformidadNormativa === 'CON_DESVIOS' ? [180, 120, 20]
             : estadoMezcla.conformidadNormativa === 'NO_CONFORME' ? [192, 57, 43]
             : [100, 100, 140],
      },
      {
        label: 'Viabilidad técnica estimada',
        value: VIAB_MEZCLA_LABELS[estadoMezcla.viabilidadTecnica] || '—',
        color: VIAB_MEZCLA_COLORS[estadoMezcla.viabilidadTecnica] || [100, 100, 100],
      },
    ];
    const ejeColW = (contentW - 2) / 2;
    const ejeRowH = 8;
    for (let i = 0; i < ejes.length; i++) {
      const ex = margin + 1 + i * ejeColW;
      doc.setFillColor(248, 248, 250);
      doc.rect(ex, y, ejeColW - 1, ejeRowH, 'F');
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(110, 110, 110);
      doc.text(sanitizePdf(ejes[i].label), ex + 2, y + 3);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      const c = ejes[i].color;
      doc.setTextColor(c[0], c[1], c[2]);
      const valueWrapped = doc.splitTextToSize(sanitizePdf(ejes[i].value), ejeColW - 4);
      doc.text(valueWrapped[0] || '', ex + 2, y + 6.5);
    }
    y += ejeRowH + 2;
    doc.setTextColor(...C.text);

    // (3) Hallazgos — wrap por línea para no salirse del cuadro
    if (egMotivos.length > 0) {
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      const innerW = contentW - 14;
      const wrapped = egMotivos.map((m) => doc.splitTextToSize(`- ${sanitizePdf(m)}`, innerW));
      const totalLines = wrapped.reduce((a, l) => a + l.length, 0);
      const blkH = 5 + totalLines * 3 + 2;
      doc.setFillColor(248, 248, 250);
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.25);
      doc.roundedRect(margin, y, contentW, blkH, 1.5, 1.5, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(90, 90, 90);
      doc.text('Hallazgos', margin + 4, y + 4);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(70, 70, 70);
      let my = y + 7.5;
      for (const lines of wrapped) {
        for (const line of lines) {
          doc.text(line, margin + 6, my);
          my += 3;
        }
      }
      y += blkH + 2;
    }

    // (4) Fortalezas (verde discreto)
    if (estadoMezcla.fortalezas && estadoMezcla.fortalezas.length) {
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      const innerW = contentW - 14;
      const fwrap = estadoMezcla.fortalezas.map(m => doc.splitTextToSize(`+ ${sanitizePdf(m)}`, innerW));
      const fLines = fwrap.reduce((a, l) => a + l.length, 0);
      const fH = 5 + fLines * 3 + 2;
      doc.setFillColor(220, 252, 231);
      doc.setDrawColor(21, 128, 61);
      doc.setLineWidth(0.25);
      doc.roundedRect(margin, y, contentW, fH, 1.5, 1.5, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(21, 128, 61);
      doc.text('Fortalezas', margin + 4, y + 4);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(50, 90, 60);
      let fy = y + 7.5;
      for (const lines of fwrap) {
        for (const line of lines) {
          doc.text(line, margin + 6, fy);
          fy += 3;
        }
      }
      y += fH + 2;
    }

    // (5) Sostenibilidad — bloque preparado para futura integración
    {
      const susInnerW = contentW - 14;
      const susText = 'No evaluado — bloque preparado para integración futura de indicadores de cercanía, costo relativo, huella de carbono y disponibilidad logística.';
      const susLines = doc.splitTextToSize(sanitizePdf(susText), susInnerW);
      const susH = 5 + susLines.length * 3 + 2;
      doc.setFillColor(245, 247, 248);
      doc.setDrawColor(190, 195, 200);
      doc.setLineWidth(0.25);
      doc.roundedRect(margin, y, contentW, susH, 1.5, 1.5, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(90, 100, 110);
      doc.text('Sostenibilidad / logística / costo', margin + 4, y + 4);
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(110, 115, 125);
      let sy = y + 7.5;
      for (const line of susLines) {
        doc.text(line, margin + 6, sy);
        sy += 3;
      }
      y += susH + 3;
    }
    doc.setTextColor(...C.text);
  }

  // Conclusión técnica operativa
  if (estadoMezcla.conclusion) {
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...(ESTADO_MEZCLA_COLORS[estadoMezcla.estado] || C.text));
    const concLines = doc.splitTextToSize(estadoMezcla.conclusion, contentW - 8);
    for (const line of concLines) { doc.text(line, margin + 4, y); y += 3; }
    y += 2;
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...C.text);
  }

  /* ══════════════════════════════════════════
     2) Datos generales
     ══════════════════════════════════════════ */
  sectionTitle('Datos generales');
  if (!isDraft && nombre) kvRow('Nombre', nombre);
  if (descripcion) kvRow('Descripción', descripcion);
  kvRow('Modo', modo === 'AUTO' ? 'Automática' : 'Manual');
  kvRow('Objetivo', objetivoModo === 'BANDA' ? 'Banda normativa' : objetivoModo === 'CURVA' ? 'Curva teórica' : objetivoModo === 'COMBINADO' ? 'Combinado' : objetivoModo || '—');
  if (objetivoModo === 'COMBINADO' && prioridad1) {
    kvRow('Prioridad 1', prioridad1 === 'BANDA' ? 'Banda' : 'Curva teórica');
    kvRow('Prioridad 2', prioridad2 === 'BANDA' ? 'Banda' : 'Curva teórica');
  }
  kvRow('TMN', tmn != null ? `${normAbertura(tmn)} mm` : '—');
  kvRow('MF mezcla total', mf != null ? fmtNum(mf, 2) : '—');
  kvRow('Banda normativa', bandaRef || 'No seleccionada');
  kvRow('Curva teórica', teoricaRef || 'No seleccionada');
  if (bandaTmn != null && tmn != null) {
    const diff = Math.abs(Number(bandaTmn) - Number(tmn));
    if (diff < 0.5) {
      kvRow('TMN banda vs. mezcla', `Banda: ${normAbertura(bandaTmn)} mm — Mezcla: ${normAbertura(tmn)} mm (coinciden)`);
    } else {
      kvRow('TMN banda vs. mezcla', `Banda: ${normAbertura(bandaTmn)} mm — Mezcla: ${normAbertura(tmn)} mm (DIFIEREN)`);
      // Warning
      checkPage(12);
      doc.setFontSize(7.5);
      doc.setTextColor(239, 68, 68);
      const warnText = `El TMN calculado de la mezcla (${normAbertura(tmn)} mm) difiere del TMN de la banda seleccionada (${normAbertura(bandaTmn)} mm). Interpretar resultados con precaución.`;
      const warnLines = doc.splitTextToSize(warnText, contentW - 8);
      for (const line of warnLines) { doc.text(line, margin + 4, y); y += 3.5; }
      y += 2;
      doc.setTextColor(...C.text);
    }
  }

  /* ══════════════════════════════════════════
     3) Componentes
     ══════════════════════════════════════════ */
  sectionTitle('Componentes de la mezcla');
  if (sortedComps.length) {
    // Fix #3: Only show Optimo/Adoptado/Dif columns if ajusteMetadata has real data
    const optProps = ajusteMetadata?.proporciones_optimas || {};
    const hasRealAjuste = ajusteMetadata && Object.keys(optProps).length > 0
      && sortedComps.some(c => {
        let optPct = optProps[c.id] ?? optProps[String(c.id)];
        if (optPct == null && c.nombre) {
          optPct = optProps[c.nombre];
          if (optPct == null) { const s = c.nombre.replace(/['"]/g, ''); for (const [k, v] of Object.entries(optProps)) { if (k.replace(/['"]/g, '') === s) { optPct = v; break; } } }
        }
        return optPct != null && Math.abs((optPct || 0) - (c.porcentaje || 0)) > 0.05;
      });

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [hasRealAjuste
        ? ['Ref.', 'Material', 'Tipo', 'Origen', '% Optimo', '% Adoptado', 'Dif.']
        : ['Ref.', 'Material', 'Tipo', 'Origen', '% Mezcla']
      ],
      body: sortedComps.map((c, i) => {
        const base = [
          compAliases[i],
          c.nombre || `ID ${c.id}`,
          c.tipo || '—',
          c.origen || '—',
        ];
        if (hasRealAjuste) {
          let optPct = optProps[c.id] ?? optProps[String(c.id)];
          if (optPct == null && c.nombre) {
            optPct = optProps[c.nombre];
            if (optPct == null) { const s = c.nombre.replace(/['"]/g, ''); for (const [k, v] of Object.entries(optProps)) { if (k.replace(/['"]/g, '') === s || k.includes(c.nombre) || c.nombre.includes(k)) { optPct = v; break; } } }
          }
          const adoptPct = c.porcentaje;
          const diff = (adoptPct != null && optPct != null) ? adoptPct - optPct : null;
          base.push(
            optPct != null ? `${fmtNum(optPct, 1)} %` : '—',
            adoptPct != null ? `${fmtNum(adoptPct, 1)} %` : '—',
            diff != null ? `${diff >= 0 ? '+' : ''}${fmtNum(diff, 1)} %` : '—',
          );
        } else {
          base.push(c.porcentaje != null ? `${fmtNum(c.porcentaje, 1)} %` : '—');
        }
        return base;
      }),
      theme: 'grid',
      styles: { fontSize: isSubType ? 7.5 : 8.5, textColor: C.text, cellPadding: isSubType ? 1.5 : 2 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: isSubType ? 7.5 : 8.5 },
      alternateRowStyles: { fillColor: C.lightBg },
      columnStyles: hasRealAjuste
        ? { 0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' }, 4: { cellWidth: 20, halign: 'right' }, 5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }, 6: { cellWidth: 16, halign: 'right' } }
        : { 0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' }, 4: { cellWidth: 22, halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + (isSubType ? 4 : 6);
  }

  /* ══════════════════════════════════════════
     4) Gráficos
     ══════════════════════════════════════════ */
  // Compact chart height for sub-type (Finos/Gruesos) reports to fit more on one page
  const chartH = isSubType ? 48 : 60;

  function addChart(label, base64, subtitle) {
    if (!base64) return;
    checkPage(subtitle ? (chartH + 22) : (chartH + 15));
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.secondary);
    doc.text(label, margin + 2, y);
    y += 3;
    if (subtitle) {
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      const subLines = doc.splitTextToSize(subtitle, contentW - 4);
      doc.text(subLines, margin + 2, y);
      y += subLines.length * 3.5 + 1;
    }
    try {
      doc.addImage(base64, 'PNG', margin, y, contentW, chartH);
    } catch { /* ignore */ }
    y += chartH + 4;
  }

  if (chartImages.mix || chartImages.banda || chartImages.teorica || chartImages.combinada || evalBanda?.series) {
    // BUG-6 fix v3: Atomic page guarantee for sectionTitle + first chart.
    // The title bar must NEVER appear orphaned at the bottom of a page while the chart
    // is moved to the next page. We calculate the worst-case height using the BIGGER of
    // the two possible chart renderers (SVG ~99mm vs raster fallback ~60mm), pre-add the
    // page if needed, and then draw everything inline without any internal checkPage
    // that could trigger another page break mid-section.
    const svgChartW = contentW - 4;
    const svgChartH = svgChartW * 400 / 720; // ~99mm — bigger than raster fallback (60mm)
    const sectionTitleH = isSubType ? 12 : 16; // y += 4 + barH + 4
    const subtitleH = 3 + (bandaRef ? 4 : 0); // "Comparación con banda" + optional ref
    const estTotal = sectionTitleH + subtitleH + svgChartH + 10 /* trailing margin */;
    if (y + estTotal > pageH - 20) {
      doc.addPage();
      y = 15;
    }
    sectionTitle('Curvas granulométricas');

    // ── Banda chart: vector SVG (same approach as Shilstone in dosificación) ──
    let bandaRenderedSVG = false;
    let bandaRendered = false;
    if (evalBanda?.series?.medida?.length > 1) {
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...C.secondary);
      doc.text('Comparación con banda', margin + 2, y);
      y += 3;
      if (bandaRef) {
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...C.muted);
        doc.text(`Banda: ${bandaRef}`, margin + 2, y);
        y += 4;
      }
      try {
        // Build curvas A, B, C from bandaNormativa (preferred) or evalBanda.series (fallback)
        let curvaA = null, curvaB = null, curvaC = null;
        const fueraAB = new Set();
        const fueraAC = new Set();

        if (bandaNormativa?.bandaAB?.length) {
          // Prefer explicit curvas A/B/C from endpoint (available for FINO and TOTAL)
          if (bandaNormativa.curvaA?.length) {
            curvaA = bandaNormativa.curvaA;
            curvaB = bandaNormativa.curvaB || bandaNormativa.bandaAB.map(p => ({ aberturaMm: p.aberturaMm, target: p.limSup }));
            curvaC = bandaNormativa.curvaC || (bandaNormativa.bandaAC?.length ? bandaNormativa.bandaAC.map(p => ({ aberturaMm: p.aberturaMm, target: p.limSup })) : null);
          } else {
            curvaA = bandaNormativa.bandaAB.map(p => ({ aberturaMm: p.aberturaMm, target: p.limInf }));
            curvaB = bandaNormativa.bandaAB.map(p => ({ aberturaMm: p.aberturaMm, target: p.limSup }));
            if (bandaNormativa.bandaAC?.length) {
              curvaC = bandaNormativa.bandaAC.map(p => ({ aberturaMm: p.aberturaMm, target: p.limSup }));
            }
          }
          // Compute fueraAB and fueraAC from mix vs band limits
          const sortedMix = [...(evalBanda?.series?.medida || curvaMix.filter(p => p.pasaPct != null))];
          for (const bp of bandaNormativa.bandaAB) {
            const mixPt = sortedMix.find(m => Math.abs(m.aberturaMm - bp.aberturaMm) < bp.aberturaMm * 0.05 + 0.01);
            const pasa = mixPt?.pasaPct;
            if (pasa == null) continue;
            if (pasa < bp.limInf || pasa > bp.limSup) fueraAB.add(bp.aberturaMm);
          }
          if (bandaNormativa.bandaAC) {
            for (const bp of bandaNormativa.bandaAC) {
              const mixPt = sortedMix.find(m => Math.abs(m.aberturaMm - bp.aberturaMm) < bp.aberturaMm * 0.05 + 0.01);
              const pasa = mixPt?.pasaPct;
              if (pasa == null) continue;
              if (pasa < bp.limInf || pasa > bp.limSup) fueraAC.add(bp.aberturaMm);
            }
          }
        } else if (evalBanda?.series) {
          // Fallback: legacy format (only one band pair)
          curvaA = (evalBanda.series.bandaMin || []).map(p => ({ aberturaMm: p.aberturaMm, target: p.pasaPct }));
          curvaB = (evalBanda.series.bandaMax || []).map(p => ({ aberturaMm: p.aberturaMm, target: p.pasaPct }));
          for (const f of (evalBanda.fueraDeBanda || [])) fueraAB.add(f.aberturaMm);
        }

        const medidaSVG = evalBanda?.series?.medida || curvaMix.filter(p => p.pasaPct != null).map(p => ({ aberturaMm: p.aberturaMm, pasaPct: p.pasaPct }));
        const svgStr = generarIRAM1627SVG({ curvaA, curvaB, curvaC, medida: medidaSVG }, { tmnMm: tmn || bandaTmn, fueraAB, fueraAC, tablaRef: bandaNormativa?.tablaRef });

        // Try svg2pdf.js for vector output (same as Shilstone)
        let usedVector = false;
        try {
          const { svg2pdf } = require('svg2pdf.js');
          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(svgStr, 'image/svg+xml');
          const svgEl = svgDoc.documentElement;
          await svg2pdf(svgEl, doc, { x: margin + 2, y, width: svgChartW, height: svgChartH });
          usedVector = true;
        } catch (vecErr) {
          console.warn('[mezcla-banda-svg] svg2pdf.js failed, falling back to Canvas:', vecErr.message);
        }

        // Fallback: Canvas rasterization at 4x DPI (same as Shilstone)
        if (!usedVector) {
          const svgB64 = btoa(unescape(encodeURIComponent(svgStr)));
          const svgDataUrl = 'data:image/svg+xml;base64,' + svgB64;
          const img = new Image();
          img.width = 720; img.height = 400;
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = svgDataUrl; });
          const DPR = 4;
          const cvs = document.createElement('canvas');
          cvs.width = 720 * DPR; cvs.height = 400 * DPR;
          const ctx2 = cvs.getContext('2d');
          ctx2.scale(DPR, DPR);
          ctx2.drawImage(img, 0, 0, 720, 380);
          doc.addImage(cvs.toDataURL('image/png'), 'PNG', margin + 2, y, svgChartW, svgChartH);
        }

        y += svgChartH + 8;
        bandaRenderedSVG = true;
        bandaRendered = true;
      } catch (svgErr) {
        console.warn('[mezcla-banda-svg] Error:', svgErr);
      }
    }

    // Raster fallback for banda chart (if SVG didn't render).
    // Inline render to avoid the internal checkPage of addChart() that could split
    // the section title from the chart (the root cause of BUG-6).
    if (!bandaRenderedSVG && chartImages.banda) {
      try {
        // Title and bandaRef were not drawn yet because we only drew them inside the SVG branch.
        // Re-draw them here for the raster path.
        if (!bandaRendered) {
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(...C.secondary);
          doc.text('Comparación con banda', margin + 2, y);
          y += 3;
          if (bandaRef) {
            doc.setFont('Helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(...C.muted);
            doc.text(`Banda: ${bandaRef}`, margin + 2, y);
            y += 4;
          }
        }
        doc.addImage(chartImages.banda, 'PNG', margin, y, contentW, chartH);
        y += chartH + 4;
        bandaRendered = true;
      } catch { /* ignore */ }
    }

    // Curva teórica (raster — no SVG equivalent yet). Uses addChart which has its own
    // checkPage; this is OK because by now the banda title+chart are already on a single page.
    addChart('Comparación con curva teórica', chartImages.teorica, teoricaRef ? `Curva teórica: ${teoricaRef}` : null);
  }

  /* ══════════════════════════════════════════
     5) Resultados
     ══════════════════════════════════════════ */
  const hasResults = evalBanda || evalTeorica || resumen || optimizacion;
  if (hasResults) {
    sectionTitle('Resultados');

    // Banda — use consolidated state to avoid contradiction with header badge
    if (evalBanda || resumen?.bandaCumple !== undefined) {
      const estadoB = evalBanda?.estado;
      const cumpleRaw = evalBanda?.cumple ?? resumen?.bandaCumple;
      const tamicesFuera = evalBanda?.fueraDeBanda || resumen?.tamicesFuera || [];
      const nFuera = tamicesFuera.length;
      const maxDesv = tamicesFuera.reduce((m, t) => Math.max(m, Math.abs(t.desvio || 0)), 0);
      const bandaEval = evalBanda?.bandaEvaluada || '';

      // Use dual evaluation estado if available, otherwise infer
      let bandaLabel, bandaColor;
      if (estadoB === 'CUMPLE' || (cumpleRaw && estadoB !== 'CUMPLE_AC')) {
        bandaLabel = `CUMPLE BANDA${bandaEval ? ' ' + bandaEval : ''}`;
        bandaColor = C.accent;
      } else if (estadoB === 'CUMPLE_AC') {
        bandaLabel = 'CUMPLE BANDA A-C (no cumple A-B)';
        bandaColor = [180, 130, 30]; // amber
      } else if (!cumpleRaw && nFuera <= 2 && maxDesv <= 3) {
        bandaLabel = 'CUMPLE BANDA CON OBSERVACIONES';
        bandaColor = [180, 130, 30]; // amber
      } else {
        bandaLabel = `NO CUMPLE BANDA${bandaEval ? ' ' + bandaEval : ''}`;
        bandaColor = C.danger;
      }

      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...bandaColor);
      doc.text(bandaLabel, margin + 2, y);
      y += 5;
      doc.setTextColor(...C.text);
      doc.setFont('Helvetica', 'normal');

      if (nFuera > 0) {
        doc.setFontSize(8);
        doc.text(`Tamices fuera de banda: ${nFuera}`, margin + 2, y);
        y += 4;
        for (const t of tamicesFuera.slice(0, 10)) {
          const ab = normTamiz(t.tamiz, t.aberturaMm);
          // Fix #2: show 2 decimals when desvio is small (< 1 pp) to avoid misleading "0,0 pp"
          const decimals = (t.desvio != null && Math.abs(t.desvio) < 1) ? 2 : 1;
          const desvio = t.desvio != null ? ` — desvio: ${fmtNum(t.desvio, decimals)} pp` : '';
          doc.text(`  - ${ab}${desvio}`, margin + 4, y);
          y += 3.5;
          checkPage(5);
        }
        y += 2;

        // M3: Suggest corrective actions based on which sieves are out and which side.
        // A negative desvio (below lower limit) on a fine sieve (<4.75mm) means "too little
        // fines" → add sand. A positive desvio on a coarse sieve means "too much gruesos"
        // → reduce that coarse fraction. Pattern-match and emit specific suggestions.
        try {
          const sugerencias = [];
          for (const t of tamicesFuera) {
            const ab = Number(t.aberturaMm);
            const desv = Number(t.desvio);
            if (!Number.isFinite(ab) || !Number.isFinite(desv)) continue;
            const absDesv = Math.abs(desv);
            const magnitud = absDesv < 3 ? 'ligero' : absDesv < 6 ? 'moderado' : 'importante';
            if (ab <= 4.75 && desv < 0) {
              // Below lower limit on a fine sieve → need more fines
              sugerencias.push(`Tamiz ${normTamiz(t.tamiz, ab)}: déficit ${magnitud} (${fmtNum(desv, 1)} pp). Aumentar arena en ${absDesv < 3 ? '2-3' : absDesv < 6 ? '3-5' : '5-8'}% o incorporar arena más fina.`);
            } else if (ab <= 4.75 && desv > 0) {
              sugerencias.push(`Tamiz ${normTamiz(t.tamiz, ab)}: exceso ${magnitud} (+${fmtNum(desv, 1)} pp). Reducir arena en ${absDesv < 3 ? '2-3' : '3-5'}% o usar arena más gruesa.`);
            } else if (ab > 4.75 && desv > 0) {
              sugerencias.push(`Tamiz ${normTamiz(t.tamiz, ab)}: exceso ${magnitud} (+${fmtNum(desv, 1)} pp). Reducir el ripio que aporta en ese rango.`);
            } else if (ab > 4.75 && desv < 0) {
              sugerencias.push(`Tamiz ${normTamiz(t.tamiz, ab)}: déficit ${magnitud} (${fmtNum(desv, 1)} pp). Aumentar el ripio intermedio o ajustar la proporción de gruesos.`);
            }
          }
          if (sugerencias.length > 0) {
            checkPage(8 + sugerencias.length * 4);
            const boxH = 6 + sugerencias.slice(0, 4).length * 3.5 + 2;
            doc.setFillColor(255, 248, 225);
            doc.setDrawColor(245, 158, 11);
            doc.setLineWidth(0.3);
            doc.roundedRect(margin, y, contentW, boxH, 1.5, 1.5, 'FD');
            doc.setFont('Helvetica', 'bold');
            doc.setFontSize(7);
            doc.setTextColor(180, 120, 30);
            doc.text('Sugerencias correctivas:', margin + 3, y + 4);
            doc.setFont('Helvetica', 'normal');
            doc.setFontSize(6.5);
            doc.setTextColor(80, 80, 80);
            for (let i = 0; i < Math.min(sugerencias.length, 4); i++) {
              doc.text(`- ${sugerencias[i]}`, margin + 3, y + 7 + i * 3);
            }
            y += boxH + 3;
            doc.setFont('Helvetica', 'normal');
            doc.setTextColor(...C.text);
          }
        } catch { /* non-blocking */ }
      }
    }

    // Band margin alerts — uses shared function so page 3 and A.5 show same data
    if (evalBanda || trazabilidad?.banda?.rows?.length) {
      const marginAlerts = computeMarginAlerts(evalBanda, curvaMix, trazabilidad);

      if (marginAlerts.length > 0) {
        checkPage(8 + marginAlerts.length * 4);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...C.danger);
        doc.text('Alertas de margen:', margin + 2, y);
        y += 4;
        doc.setFontSize(7.5);
        for (const a of marginAlerts) {
          // Amber background for PREVENTIVO alerts (margin > 0% but < 3%)
          checkPage(8);
          doc.setFillColor(255, 248, 225);
          doc.roundedRect(margin + 2, y - 2.5, contentW - 4, 7, 1, 1, 'F');
          doc.setFont('Helvetica', 'normal');
          doc.setTextColor(180, 120, 30);
          doc.text(`  Preventivo - ${a.tamiz}: margen ${a.lado} = ${fmtNum(a.margin, 1)}%`, margin + 4, y + 1);
          y += 7;
          checkPage(5);
        }
        doc.setTextColor(...C.text);
        y += 3;
      }
    }

    // TEC-04: Explicit theoretical curve result indicator (matches CUMPLE BANDA treatment)
    const metrics = evalTeorica?.metrics || evalTeorica || resumen?.errorTeorico || resumen;
    if (metrics?.mae != null) {
      const maeVal = Number(metrics.mae);
      const classifyMAE = (v) => v < 3 ? 'Excelente' : v < 5 ? 'Bueno' : v < 8 ? 'Aceptable' : 'Deficiente';
      const calif = classifyMAE(maeVal);
      const isGood = maeVal < 8;
      checkPage(8);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...(isGood ? C.accent : C.danger));
      doc.text(`${isGood ? 'OK -' : 'NO OK -'} Ajuste a curva teórica: MAE ${fmtNum(maeVal, 2)}% — ${calif}`, margin + 2, y);
      y += 5;
      doc.setTextColor(...C.text);
      doc.setFont('Helvetica', 'normal');
    }

    // Teórica metrics with interpretive scale
    if (metrics?.mae != null || metrics?.rmse != null) {
      // Interpretive scales for each metric
      const classifyMAE = (v) => v < 3 ? 'Excelente' : v < 5 ? 'Bueno' : v < 8 ? 'Aceptable' : 'Deficiente';
      const classifyR2 = (v) => v > 0.99 ? 'Excelente' : v > 0.97 ? 'Bueno' : v > 0.95 ? 'Aceptable' : 'Deficiente';
      const classifyRMSE = (v) => v < 4 ? 'Excelente' : v < 6 ? 'Bueno' : v < 10 ? 'Aceptable' : 'Deficiente';

      const metricPairs = [];
      if (metrics.rmse != null) {
        const q = classifyRMSE(Number(metrics.rmse));
        metricPairs.push(['RMSE', `${fmtNum(metrics.rmse, 2)} (${q})`]);
      }
      if (metrics.mae != null) {
        const q = classifyMAE(Number(metrics.mae));
        metricPairs.push(['MAE', `${fmtNum(metrics.mae, 2)} (${q})`]);
      }
      if (metrics.r2 != null) {
        const q = classifyR2(Number(metrics.r2));
        metricPairs.push(['R2', `${fmtNum(metrics.r2, 4)} (${q})`]);
      }
      if (metrics.maxDesvio != null) metricPairs.push(['Max desvio', `${fmtNum(metrics.maxDesvio, 2)}%`]);

      checkPage(10);
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [metricPairs.map(p => p[0])],
        body: [metricPairs.map(p => p[1])],
        theme: 'grid',
        styles: { fontSize: 9, halign: 'center', cellPadding: 2, textColor: C.text },
        headStyles: { fillColor: C.secondary, textColor: C.white, fontStyle: 'bold' },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // Optimización summary
    if (optimizacion) {
      checkPage(12);
      kvRow('Método', translateOptMethod(optimizacion.metodo));
      const feasLabel = optimizacion.feasible === false ? 'No factible' : optimizacion.factibilidad || (optimizacion.feasible ? 'Factible' : null);
      if (feasLabel) kvRow('Factibilidad', feasLabel);
      if (optimizacion.mensaje) kvRow('Mensaje', optimizacion.mensaje);
    }

    // Warnings
    const warnings = resumen?.warnings || optimizacion?.warnings || [];
    if (warnings.length) {
      checkPage(8 + warnings.length * 4);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.danger);
      doc.text('Advertencias:', margin + 2, y);
      y += 4;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
      for (const w of warnings) {
        doc.text(`  • ${w}`, margin + 4, y);
        y += 3.5;
        checkPage(5);
      }
      y += 3;
    }
  }

  /* ══════════════════════════════════════════
     5b) Indicadores granulométricos orientativos de trabajabilidad
     ══════════════════════════════════════════ */
  if (curvaMix.length && tipoMezcla === 'TOTAL') {
    // M10 (auditoría 01-calidad): cálculo Shilstone vía helper único.
    // Nota: FdT acá se reporta SIN corrección por cementante (Workability
    // Factor sin ajuste); ver INC 4 más abajo.
    const { fdg, fdt, zonaLabel } = calcularShilstoneDesdeCurva(curvaMix);

    if (fdg != null || fdt != null) {
      checkPage(25);
      sectionTitle('Indicadores granulométricos orientativos de trabajabilidad');
      const indRows = [];
      if (fdg != null) indRows.push(['Factor de Grosor (FdG)', `${fmtNum(fdg, 1)}%`]);
      // INC 4: Clarify that FdT is computed WITHOUT cement correction in the mezcla report
      if (fdt != null) indRows.push([`Factor de Trabajabilidad (FdT) — sin cementante`, `${fmtNum(fdt, 1)}%`]);
      if (mf != null) indRows.push([`Módulo de Finura (MF)`, fmtNum(mf, 2)]);
      if (zonaLabel) indRows.push(['Zona Shilstone (sin cementante)', zonaLabel]);

      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        body: indRows,
        theme: 'plain',
        styles: { fontSize: 8, cellPadding: 1.5, textColor: C.text },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
        alternateRowStyles: { fillColor: C.lightBg },
      });
      y = doc.lastAutoTable.finalY + 4;

      // ── Shilstone zone chart (vector SVG — same as dosificación) ──
      if (fdg != null && fdt != null) {
        const zonaCode = zonaLabel ? zonaLabel.split(' ')[0] : '';
        const shilstoneChartW = Math.min(contentW - 4, 120); // limit width for compactness
        const shilstoneChartH = shilstoneChartW * 440 / 720;
        checkPage(shilstoneChartH + 10);

        try {
          const { generarShilstoneSVG } = require('../dosificacion-diseno/shilstoneSvg');
          const svgStr = generarShilstoneSVG(fdg, fdt, zonaCode);

          let usedVector = false;
          try {
            const { svg2pdf } = require('svg2pdf.js');
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgStr, 'image/svg+xml');
            const svgEl = svgDoc.documentElement;
            // Center the chart
            const chartX = margin + (contentW - shilstoneChartW) / 2;
            await svg2pdf(svgEl, doc, { x: chartX, y, width: shilstoneChartW, height: shilstoneChartH });
            usedVector = true;
          } catch (vecErr) {
            console.warn('[mezcla-shilstone] svg2pdf.js failed, falling back to Canvas:', vecErr.message);
          }

          if (!usedVector) {
            const svgB64 = btoa(unescape(encodeURIComponent(svgStr)));
            const svgDataUrl = 'data:image/svg+xml;base64,' + svgB64;
            const img = new Image();
            img.width = 720; img.height = 440;
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = svgDataUrl; });
            const DPR = 4;
            const cvs = document.createElement('canvas');
            cvs.width = 720 * DPR; cvs.height = 440 * DPR;
            const ctx2 = cvs.getContext('2d');
            ctx2.scale(DPR, DPR);
            ctx2.drawImage(img, 0, 0, 720, 440);
            const chartX = margin + (contentW - shilstoneChartW) / 2;
            doc.addImage(cvs.toDataURL('image/png'), 'PNG', chartX, y, shilstoneChartW, shilstoneChartH);
          }

          y += shilstoneChartH + 3;
        } catch (svgErr) {
          console.warn('[mezcla-shilstone] Error:', svgErr);
        }
      }

      // INC 4: Visible amber note box to clarify that the FdT shown here does NOT include
      // the cementant correction. When the mezcla is used inside a dosificación, the FdT
      // will be higher (typically +4 to +8 pts) and the Shilstone zone may change.
      checkPage(18);
      const noteH = 14;
      doc.setFillColor(255, 248, 225);
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentW, noteH, 1.5, 1.5, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(180, 120, 30);
      doc.text('Nota importante sobre el FdT y la Zona Shilstone', margin + 3, y + 4);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(80, 80, 80);
      const noteLines = [
        'Estos indicadores son orientativos del esqueleto árido SIN cementante. El FdT real del hormigón',
        'incluirá la corrección por cementante (Cc = cemento/42,6 - Day 2006) y será mayor. Al incorporar',
        'cemento en la dosificación, la Zona Shilstone puede cambiar. Verificar en el informe de dosificación.',
      ];
      for (let i = 0; i < noteLines.length; i++) {
        doc.text(noteLines[i], margin + 3, y + 7.5 + i * 2.5);
      }
      y += noteH + 4;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
    }
  }

  /* ══════════════════════════════════════════
     6) Datos por tamiz
     ══════════════════════════════════════════ */
  if (curvaMix.length) {
    sectionTitle('Datos por tamiz');

    const METODO_LABELS = {
      REAL: 'Real', INTERPOLADO: 'Interp.', DEDUCIDO: 'Deduc.',
      EQUIV: 'Equiv.', EXTRAPOLADO: 'Extrap.',
    };

    const sortedMix = [...curvaMix].sort((a, b) => a.aberturaMm - b.aberturaMm);
    // Fix #4: hide Metodos column if no sieve has method data
    const hasMetodos = sortedMix.some(p => p.metodos?.length > 0);
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [hasMetodos ? ['Tamiz', 'Abertura (mm)', '% Pasa', 'Metodos'] : ['Tamiz', 'Abertura (mm)', '% Pasa']],
      body: sortedMix.map(p => {
        const row = [
          normTamiz(p.tamiz, p.aberturaMm),
          normAbertura(p.aberturaMm),
          p.pasaPct != null ? fmtNum(p.pasaPct, 1) : '—',
        ];
        if (hasMetodos) row.push((p.metodos || []).map(m => METODO_LABELS[m] || m).join(', ') || '—');
        return row;
      }),
      theme: 'grid',
      styles: { fontSize: isSubType ? 7 : 8, textColor: C.text, cellPadding: isSubType ? 1.2 : 1.8 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: isSubType ? 7 : 8 },
      alternateRowStyles: { fillColor: C.lightBg },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 28, halign: 'right' },
        2: { cellWidth: 22, halign: 'right' },
      },
    });
    y = doc.lastAutoTable.finalY + (isSubType ? 4 : 6);
  }

  /* ══════════════════════════════════════════
     7) Rangos de optimización
     ══════════════════════════════════════════ */
  const rangos = optimizacion?.rangos || trazabilidad?.optimizacion?.rangos;
  if (rangos?.length) {
    sectionTitle('Rangos de optimización por agregado');
    // Build robust lookup maps for ID matching (handles id, idAgregado, legacyAgregadoId, string/number)
    const compByNumId = new Map();
    const compByName = new Map();
    for (let i = 0; i < sortedComps.length; i++) {
      const c = sortedComps[i];
      if (c.id != null) compByNumId.set(Number(c.id), i);
      if (c.idAgregado != null) compByNumId.set(Number(c.idAgregado), i);
      if (c.legacyAgregadoId != null) compByNumId.set(Number(c.legacyAgregadoId), i);
      if (c.nombre) compByName.set(c.nombre.toLowerCase().trim(), i);
    }
    // Build name fallback from trazabilidad mixBreakdown (covers virtual aggregates with negative IDs)
    const traceNameById = new Map();
    const firstRow = trazabilidad?.mixBreakdown?.[0];
    if (firstRow?.componentes) {
      for (const c of firstRow.componentes) {
        if (c.agregadoId != null && c.nombre) traceNameById.set(Number(c.agregadoId), c.nombre);
      }
    }
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Ref.', 'Agregado', '% Óptimo', '% Mínimo', '% Máximo', 'Estado']],
      body: rangos.map(r => {
        let compIdx = compByNumId.get(Number(r.id)) ?? -1;
        // Fallback: match by name if ID didn't match
        if (compIdx < 0 && r.nombre) compIdx = compByName.get(r.nombre.toLowerCase().trim()) ?? -1;
        const comp = compIdx >= 0 ? sortedComps[compIdx] : null;
        // Alias: use component alias if matched, "Σ" for group rows, "SF"/"SG" for
        // virtual aggregates (sub-mezcla), fallback to "—"
        let alias;
        if (compIdx >= 0) {
          alias = compAliases[compIdx];
        } else if (r.isGroup) {
          alias = '\u03A3';
        } else if (Number(r.id) < 0) {
          // Virtual aggregate (saved sub-mezcla) — use S+tipo prefix
          alias = r.tipo === 'Fino' ? 'SF' : r.tipo === 'Grueso' ? 'SG' : 'S';
        } else {
          alias = '—';
        }
        // optimalPct: 1) from optimizer result, 2) from ajusteMetadata (pre-adjustment), 3) from component (adopted)
        const ajusteOptProps = ajusteMetadata?.proporciones_optimas || {};
        let optFromAjuste = ajusteOptProps[r.id] ?? ajusteOptProps[String(r.id)];
        if (optFromAjuste == null && comp?.nombre) {
          optFromAjuste = ajusteOptProps[comp.nombre];
          if (optFromAjuste == null) {
            const stripped = comp.nombre.replace(/['"]/g, '');
            for (const [key, val] of Object.entries(ajusteOptProps)) {
              if (key.replace(/['"]/g, '') === stripped) { optFromAjuste = val; break; }
            }
          }
        }
        let optPct = r.optimalPct ?? optFromAjuste ?? comp?.porcentaje;
        // Sanity check: if optPct is outside the range [min, max], it's probably wrong
        if (optPct != null && r.min != null && r.max != null) {
          if (optPct < r.min - 1 || optPct > r.max + 1) {
            // Likely a bug — use midpoint of range or component percentage
            optPct = comp?.porcentaje ?? ((r.min + r.max) / 2);
          }
        }
        if (optPct == null && (r.isGroup || Number(r.id) < 0)) {
          // Sum % of all finos or all gruesos to get the group optimal
          // Determine tipo from: r.tipo, r.nombre heuristic, or fallback
          let tipoFilter = r.tipo;
          if (!tipoFilter && r.nombre) {
            const nl = r.nombre.toLowerCase();
            if (nl.includes('grueso') || nl.includes('ripio') || nl.includes('grava') || nl.includes('piedra')) tipoFilter = 'Grueso';
            else if (nl.includes('fino') || nl.includes('arena')) tipoFilter = 'Fino';
          }
          // Last resort: if we already computed a fino group, this one must be grueso
          if (!tipoFilter) tipoFilter = 'Fino';

          const summed = sortedComps
            .filter(c => c.tipo === tipoFilter)
            .reduce((sum, c) => sum + (c.porcentaje || 0), 0);
          optPct = summed > 0 ? summed : null;

          // Fallback: if rangos has minPct/maxPct, optPct should be within that range
          if (optPct != null && r.minPct != null && r.maxPct != null) {
            if (optPct < r.minPct || optPct > r.maxPct) {
              // optPct is out of range — try complementing (100 - sum of other groups)
              const otherOpt = rangos
                .filter(o => o !== r && !o.isGroup && (o.optimalPct != null || compByNumId.has(Number(o.id))))
                .reduce((s, o) => s + (o.optimalPct ?? sortedComps[compByNumId.get(Number(o.id)) ?? -1]?.porcentaje ?? 0), 0);
              if (otherOpt > 0 && otherOpt < 100) {
                optPct = Math.round((100 - otherOpt) * 10) / 10;
              }
            }
          }
        }
        // Estado: prioridad a los flags del motor (`fixed`, `feasible`, `bestMae`).
        // Fallback PR6.a: si la mezcla viene sin esos flags persistidos (caso de
        // mezclas guardadas hace tiempo o cuyo motor no los emitió), derivamos
        // el estado del % óptimo vs el rango [min, max] para que la columna no
        // quede en "—" en todas las filas. Tolerancia 0,05 % para no marcar
        // como fuera por redondeos.
        const estado = (() => {
          if (r.fixed) return 'Fijo';
          if (r.feasible === true) return 'Factible';
          if (r.feasible === false) return 'Aprox.';
          if (r.bestMae != null) return `MAE ${fmtNum(r.bestMae, 1)}`;
          if (optPct != null && r.minPct != null && r.maxPct != null) {
            const dentro = optPct >= (r.minPct - 0.05) && optPct <= (r.maxPct + 0.05);
            return dentro ? 'En rango' : 'Fuera';
          }
          if (optPct != null) return 'Adoptado';
          return '—';
        })();
        // For combined group rows (e.g. "finos"), fallback to label/tipo description
        // Also fall back to trazabilidad names for virtual aggregates (saved mixes with negative IDs)
        let traceName = traceNameById.get(Number(r.id));
        // Clean up "Agregado -N" fallback names from old trazabilidad data
        if (traceName && /^Agregado -\d+$/.test(traceName)) traceName = 'Mezcla de finos (guardada)';
        // Build descriptive label for group rows (e.g. "Subtotal Finos (F1+F2)")
        let groupLabel = null;
        if (r.isGroup) {
          const tipoLabel = r.tipo === 'Fino' ? 'Finos' : r.tipo === 'Grueso' ? 'Gruesos' : (r.tipo || 'Grupo');
          // Find which individual aliases belong to this group
          const groupAliases = sortedComps
            .map((c, i) => ({ tipo: c.tipo, alias: compAliases[i] }))
            .filter(c => c.tipo === r.tipo)
            .map(c => c.alias);
          groupLabel = groupAliases.length > 0
            ? `Subtotal ${tipoLabel} (${groupAliases.join('+')})`
            : `Subtotal ${tipoLabel}`;
        }
        const nombre = r.nombre || r.label || comp?.nombre || traceName || groupLabel || alias;
        return [
          alias,
          nombre,
          optPct != null ? `${fmtNum(optPct, 1)} %` : '—',
          r.minPct != null ? `${fmtNum(r.minPct, 1)} %` : '—',
          r.maxPct != null ? `${fmtNum(r.maxPct, 1)} %` : '—',
          estado,
        ];
      }),
      theme: 'grid',
      styles: { fontSize: isSubType ? 7.5 : 8.5, textColor: C.text, cellPadding: isSubType ? 1.5 : 2 },
      headStyles: { fillColor: C.secondary, textColor: C.white, fontStyle: 'bold', fontSize: isSubType ? 7.5 : 8.5 },
      alternateRowStyles: { fillColor: C.lightBg },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'center' },
      },
    });
    y = doc.lastAutoTable.finalY + (isSubType ? 4 : 6);
  }

  /* ══════════════════════════════════════════
     7b) Ajuste post-optimización (Óptimo vs Adoptado)
     ══════════════════════════════════════════ */
  // Fix #6: Only show ajuste manual section if there were real changes
  const _ajusteOptProps = ajusteMetadata?.proporciones_optimas || {};
  const _hasRealAjusteChanges = ajusteMetadata && Object.keys(_ajusteOptProps).length > 0
    && sortedComps.some(c => {
      let op = _ajusteOptProps[c.id] ?? _ajusteOptProps[String(c.id)];
      if (op == null && c.nombre) { op = _ajusteOptProps[c.nombre]; if (op == null) { const s = c.nombre.replace(/['"]/g, ''); for (const [k, v] of Object.entries(_ajusteOptProps)) { if (k.replace(/['"]/g, '') === s) { op = v; break; } } } }
      return op != null && Math.abs((op || 0) - (c.porcentaje || 0)) > 0.05;
    });

  if (_hasRealAjusteChanges) {
    checkPage(40);
    sectionTitle('Ajuste manual de proporciones');

    // Proportions comparison table
    const optProps = _ajusteOptProps;
    const adoptedComps = sortedComps;
    const propRows = adoptedComps.map((c, i) => {
      // Try by id, then by name, then by stripped name (handles quote differences)
      let optPct = optProps[c.id] ?? optProps[String(c.id)];
      if (optPct == null && c.nombre) {
        optPct = optProps[c.nombre];
        if (optPct == null) {
          // Try partial/stripped match
          const stripped = c.nombre.replace(/['"]/g, '');
          for (const [key, val] of Object.entries(optProps)) {
            if (key.replace(/['"]/g, '') === stripped || key.includes(c.nombre) || c.nombre.includes(key)) {
              optPct = val;
              break;
            }
          }
        }
      }
      const adoptPct = c.porcentaje;
      const diff = (adoptPct != null && optPct != null) ? adoptPct - optPct : null;
      return [
        compAliases[i],
        c.nombre || `ID ${c.id}`,
        optPct != null ? `${fmtNum(optPct, 1)} %` : '—',
        adoptPct != null ? `${fmtNum(adoptPct, 1)} %` : '—',
        diff != null ? `${diff >= 0 ? '+' : ''}${fmtNum(diff, 1)} %` : '—',
      ];
    });
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Ref.', 'Agregado', '% Óptimo', '% Adoptado', 'Diferencia']],
      body: propRows,
      theme: 'grid',
      styles: { fontSize: isSubType ? 7.5 : 8.5, textColor: C.text, cellPadding: isSubType ? 1.5 : 2 },
      headStyles: { fillColor: C.secondary, textColor: C.white, fontStyle: 'bold', fontSize: isSubType ? 7.5 : 8.5 },
      alternateRowStyles: { fillColor: C.lightBg },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
    });
    y = doc.lastAutoTable.finalY + 4;

    // Metrics comparison table (Óptimo vs Adoptado)
    const mOpt = ajusteMetadata.metricas?.optimo;
    const mAdopt = ajusteMetadata.metricas?.adoptado;
    if (mOpt || mAdopt) {
      checkPage(25);
      const metricRows = [
        ['MAE (%)', mOpt?.mae != null ? fmtNum(mOpt.mae, 2) : '—', mAdopt?.mae != null ? fmtNum(mAdopt.mae, 2) : '—'],
        ['RMSE (%)', mOpt?.rmse != null ? fmtNum(mOpt.rmse, 2) : '—', mAdopt?.rmse != null ? fmtNum(mAdopt.rmse, 2) : '—'],
        ['R²', mOpt?.r2 != null ? fmtNum(mOpt.r2, 4) : '—', mAdopt?.r2 != null ? fmtNum(mAdopt.r2, 4) : '—'],
        ['Máx desvío (%)', mOpt?.maxDesvio != null ? fmtNum(mOpt.maxDesvio, 2) : '—', mAdopt?.maxDesvio != null ? fmtNum(mAdopt.maxDesvio, 2) : '—'],
      ];
      // Add MF row if available
      if (mOpt?.mf != null || mAdopt?.mf != null) {
        metricRows.push(['Módulo de finura', mOpt?.mf != null ? fmtNum(mOpt.mf, 2) : '—', mAdopt?.mf != null ? fmtNum(mAdopt.mf, 2) : '—']);
      }
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Métrica', 'Óptimo', 'Adoptado']],
        body: metricRows,
        theme: 'grid',
        styles: { fontSize: isSubType ? 7.5 : 8.5, textColor: C.text, cellPadding: isSubType ? 1.5 : 2 },
        headStyles: { fillColor: C.secondary, textColor: C.white, fontStyle: 'bold', fontSize: isSubType ? 7.5 : 8.5 },
        alternateRowStyles: { fillColor: C.lightBg },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { halign: 'right' },
          2: { halign: 'right' },
        },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    // Quality rating + motivo
    const calidad = ajusteMetadata.calidad_ajuste;
    const motivo = ajusteMetadata.motivo_ajuste;
    if (calidad || motivo) {
      checkPage(12);
      doc.setFontSize(8.5);
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
      if (calidad) {
        doc.text(`Calidad del ajuste: ${calidad}`, margin + 2, y);
        y += 4;
      }
      if (motivo) {
        doc.text(`Motivo: ${motivo}`, margin + 2, y);
        y += 4;
      }
    }
    y += 2;
  }

  /* ══════════════════════════════════════════
     8) Observaciones
     ══════════════════════════════════════════ */
  checkPage(20);
  sectionTitle('Observaciones');
  doc.setFontSize(8);
  doc.setFont('Helvetica', 'italic');
  doc.setTextColor(...C.muted);
  if (isDraft) {
    doc.text('Este informe corresponde a un diseño no guardado en catálogo.', margin + 2, y);
    y += 4;
  }
  if (resumen?.warnings?.length) {
    for (const w of resumen.warnings) {
      checkPage(5);
      doc.text(`• ${w}`, margin + 2, y);
      y += 3.5;
    }
  }
  if (optimizacion?.mensaje) {
    doc.text(`Observación del optimizador: ${optimizacion.mensaje}`, margin + 2, y);
    y += 4;
  }
  if (!isDraft && !resumen?.warnings?.length && !optimizacion?.mensaje) {
    doc.text('Sin observaciones.', margin + 2, y);
    y += 4;
  }

  /* ── Technical disclaimer ── */
  checkPage(14);
  y += 3;
  doc.setDrawColor(...C.muted);
  doc.setLineWidth(0.15);
  doc.line(margin + 2, y, margin + contentW - 2, y);
  y += 4;
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  const disclaimerText = 'Advertencia técnica: Este informe constituye una herramienta de apoyo al diseño granulométrico ' +
    'de mezclas y no reemplaza los ensayos de laboratorio, la validación experimental ni el criterio ' +
    'profesional de un especialista competente.';
  const disclaimerLines = doc.splitTextToSize(disclaimerText, contentW - 4);
  doc.text(disclaimerLines, margin + 2, y);
  y += disclaimerLines.length * 3 + 2;

  /* ══════════════════════════════════════════
     9) Caracterización combinada + Cumplimiento normativo
     ══════════════════════════════════════════ */
  if (propsCombinadas?.combinadas) {
    checkPage(50);
    y += 5;
    // ROUND-X Priority 9: Downgrade visual hierarchy — this section is orientativa
    // and must NOT compete with the normative compliance section (CIRSOC). Use a
    // neutral gray bar, smaller title and an explicit "[informativo]" tag.
    doc.setFillColor(200, 200, 200);
    doc.rect(margin, y, contentW, 5.5, 'F');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);
    doc.text('Caracterización combinada [informativo, no normativo]', margin + 3, y + 4);
    y += 8;
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(6);
    doc.setTextColor(...C.muted);
    doc.text('Valores promediados por peso. NO reemplaza ni sustituye la verificación normativa por fracción individual (Tabla 3.4 / 3.6 CIRSOC 200-2024). Uso orientativo únicamente.', margin + 2, y);
    y += 4;
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...C.text);

    const comb = propsCombinadas.combinadas;
    const caracRows = [];
    if (comb.densidadRelativaAparenteSSS != null) caracRows.push(['Densidad SSS', 'g/cm³', fmtDec(comb.densidadRelativaAparenteSSS, 3)]);
    if (comb.densidadRelativaAparenteSeca != null) caracRows.push(['Densidad seca', 'g/cm³', fmtDec(comb.densidadRelativaAparenteSeca, 3)]);
    if (comb.densidadRelativaReal != null) caracRows.push(['Densidad real', 'g/cm³', fmtDec(comb.densidadRelativaReal, 3)]);
    // Prompt 3 C12 Fix F: 2 decimales (alineado al cert + INF + cards de
    // Caracterización del agregado individual). Valores típicos 0,5-5,0%.
    if (comb.absorcionPct != null) caracRows.push(['Absorción', '%', fmtDec(comb.absorcionPct, 2)]);
    if (comb.pasa200Pct != null) caracRows.push(['Pasante tamiz #200 (prom. ponderado)', '%', fmtDec(comb.pasa200Pct, 1)]);
    if (comb.puc != null) caracRows.push(['PUC', 'kg/m³', String(Math.round(comb.puc))]);
    if (comb.pus != null) caracRows.push(['PUS', 'kg/m³', String(Math.round(comb.pus))]);
    if (tipoMezcla === 'FINO') {
      if (comb.equivalenteArenaPct != null) caracRows.push(['Equivalente de arena', '%', fmtDec(comb.equivalenteArenaPct, 0)]);
    } else {
      if (comb.lajosidadPct != null) caracRows.push(['Lajosidad', '%', fmtDec(comb.lajosidadPct, 0)]);
      if (comb.elongacionPct != null) caracRows.push(['Elongación', '%', fmtDec(comb.elongacionPct, 0)]);
      if (comb.desgasteLAPct != null) caracRows.push(['Desgaste Los Ángeles', '%', fmtDec(comb.desgasteLAPct, 1)]);
    }
    if (comb.terronesPct != null) caracRows.push(['Terrones de arcilla', '%', fmtDec(comb.terronesPct, 1)]);
    if (comb.sulfatosPct != null) caracRows.push(['Sulfatos (SO3)', '%', fmtDec(comb.sulfatosPct, 2)]);
    if (comb.salesSolublesPct != null) caracRows.push(['Sales solubles', '%', fmtDec(comb.salesSolublesPct, 2)]);
    if (comb.clorurosPct != null) caracRows.push(['Cloruros solubles', '%', fmtDec(comb.clorurosPct, 2)]);
    if (comb.materiasCarbonosaPct != null) caracRows.push(['Materias carbonosas', '%', fmtDec(comb.materiasCarbonosaPct, 2)]);
    if (comb.durabilidadPct != null) caracRows.push(['Durabilidad Na2SO4', '%', fmtDec(comb.durabilidadPct, 1)]);

    if (caracRows.length > 0) {
      doc.autoTable({
        startY: y,
        head: [['Propiedad', 'Unidad', 'Valor combinado']],
        body: caracRows,
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 2, lineColor: [200, 200, 200], lineWidth: 0.2 },
        headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 25, halign: 'center' }, 2: { cellWidth: 40, halign: 'center', fontStyle: 'bold' } },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 5;
    }

    // Component breakdown
    if (propsCombinadas.componentes?.length > 1) {
      checkPage(30);
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(7);
      doc.text('Desglose por componente:', margin + 2, y);
      y += 4;
      const compBody = propsCombinadas.componentes.map(c => {
        const item = componentes?.find(it => (it.idAgregado || it.id) === c.idAgregado);
        const name = item?.nombre || item?.agregado?.nombre || ('ID ' + c.idAgregado);
        const p = c.propiedades;
        return [
          name,
          fmtDec(c.porcentaje, 1) + '%',
          p.pasa200Pct != null ? fmtDec(p.pasa200Pct, 1) + '%' : '-',
          p.terronesPct != null ? fmtDec(p.terronesPct, 1) + '%' : '-',
          p.densidadRelativaAparenteSSS != null ? fmtDec(p.densidadRelativaAparenteSSS, 3) : '-',
          p.absorcionPct != null ? fmtDec(p.absorcionPct, 2) + '%' : '-',
        ];
      });
      doc.autoTable({
        startY: y,
        head: [['Agregado', '%', 'Pasa #200', 'Terrones', 'd3 SSS', 'Absorción']],
        body: compBody,
        theme: 'grid',
        styles: { fontSize: 6.5, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: 0.2 },
        headStyles: { fillColor: [100, 100, 100], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.5 },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 5;
    }
  }

  // ── Cumplimiento normativo ──
  const _evalIsGrouped = evaluacionProps && !Array.isArray(evaluacionProps) && (evaluacionProps.fino || evaluacionProps.grueso);
  const _evalHasData = _evalIsGrouped || (evaluacionProps?.length > 0);

  if (_evalHasData) {
    checkPage(50);
    y += 3;
    doc.setFillColor(...C.primary);
    doc.rect(margin, y, contentW, 7, 'F');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.text('Cumplimiento normativo - CIRSOC 200-2024', margin + 3, y + 5);
    y += 12;
    doc.setTextColor(...C.text);

    // Helper to render a cumplimiento table from an array of evaluation rows
    const _renderCumplTable = (rows, subtitle) => {
      if (!rows || rows.length === 0) return;
      if (subtitle) {
        checkPage(25);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...C.text);
        doc.text(subtitle, margin + 2, y);
        y += 5;
      }
      const cumplBody = rows.map(r => {
        const estado = r.cumple === 'CUMPLE' ? (r.informativo ? 'Info.' : (r.operador === 'menor_que' ? 'Cumple (LD)' : r.operador === 'mayor_que' ? 'Cumple (>)' : 'Cumple'))
          : r.cumple === 'NO_CUMPLE' ? 'No cumple'
          : r.estado === 'NO_EVAL' && r.alerta ? 'No concluyente'
          : r.estado === 'NO_CONCLUYENTE' ? 'No concluyente'
          : 'Sin dato';
        // Use valorDisplay (includes < operator) if available, fallback to numeric
        const valStr = r.valorDisplay
          ? sanitizePdf(r.valorDisplay).replace(/(\d)\.(\d)/g, '$1,$2')
          : r.valor != null ? (typeof r.valor === 'number' ? fmtDec(r.valor, r.valor < 1 ? 3 : 1) : String(r.valor)) : '-';
        let msg = sanitizePdf(r.mensaje || '').replace(/(\d)\.(\d)/g, '$1,$2');
        // M2: Append component breakdown for "Suma sustancias nocivas" (full transparency)
        if (r.desglose && /suma.*sustancias.*nocivas/i.test(r.propiedad || '')) {
          const d = r.desglose;
          const parts = [];
          if (d.terrones != null) parts.push(`terrones ${fmtDec(d.terrones, 2)}%`);
          if (d.pasante200 != null) parts.push(`pasa #200 ${fmtDec(d.pasante200, 2)}%`);
          if (d.carbonosas != null) parts.push(`carbonosas ${fmtDec(d.carbonosas, 2)}%`);
          if (d.sulfatos != null) parts.push(`sulfatos ${fmtDec(d.sulfatos, 2)}%`);
          if (d.sales != null) parts.push(`sales ${fmtDec(d.sales, 2)}%`);
          if (d.cloruros != null) parts.push(`cloruros ${fmtDec(d.cloruros, 3)}%`);
          if (parts.length > 0) {
            msg = `${msg}${msg ? ' ' : ''}Desglose: ${parts.join(' + ')}.`;
          }
        }
        return [sanitizePdf(r.propiedad || '') + (r.porComponente ? ' *' : ''), r.unidad || '', sanitizePdf(r.especificacion || ''), valStr, estado, msg];
      });
      doc.autoTable({
        startY: y,
        head: [['Requisito', 'Unidad', 'Espec.', 'Resultado', 'Estado', 'Observaciones']],
        body: cumplBody,
        theme: 'grid',
        styles: { fontSize: 6.5, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 35 }, 1: { cellWidth: 12, halign: 'center' },
          2: { cellWidth: 22, halign: 'center' }, 3: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
          4: { cellWidth: 22, halign: 'center' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 4) {
            // Prompt 3 C9.4 — color canónico via pdfPresentation. El texto
            // técnico por celda ('Cumple' / 'Cumple (LD)' / 'Cumple (>)' /
            // 'No cumple' / 'No concluyente' / 'Info.' / 'Sin dato') queda
            // intacto. Sólo el color se alinea al esquema canónico web↔PDF.
            // El consolidador prestacional (6 estados) NO se toca — ver D26.
            const val = String(data.cell.raw || '');
            if (val === 'Cumple' || val.startsWith('Cumple ')) {
              data.cell.styles.textColor = getCategoriaPdfColor(VEREDICTO.APTO);
            } else if (val === 'No cumple') {
              data.cell.styles.textColor = getCategoriaPdfColor(VEREDICTO.NO_APTO);
            } else if (val === 'No evaluable' || val === 'No concluyente') {
              data.cell.styles.textColor = getCategoriaPdfColor(VEREDICTO.EVALUACION_INCOMPLETA);
            } else if (val === 'Info.') {
              data.cell.styles.textColor = getCategoriaPdfColor(VEREDICTO.INFORMATIVO);
            }
          }
        },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 5;
    };

    if (_evalIsGrouped) {
      // TOTAL mix: render fino, grueso, general tables separately
      _renderCumplTable(evaluacionProps.fino, 'Fracción fina (IRAM 1512 / CIRSOC 200 Tablas 3.3-3.4)');
      _renderCumplTable(evaluacionProps.grueso, 'Fracción gruesa (IRAM 1531 / CIRSOC 200 Tablas 3.5-3.7)');
      _renderCumplTable(evaluacionProps.general, null);
    } else {
      // FINO / GRUESO: single table
      _renderCumplTable(evaluacionProps, null);
    }

    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    const normaRefText = tipoMezcla === 'FINO'
      ? 'Normas de referencia: CIRSOC 200-2024 (Tablas 3.3, 3.4) - IRAM 1512 - IRAM 1627'
      : tipoMezcla === 'GRUESO'
        ? 'Normas de referencia: CIRSOC 200-2024 (Tablas 3.5, 3.6, 3.7) - IRAM 1531 - IRAM 1627'
        : 'Normas de referencia: CIRSOC 200-2024 (Tablas 3.3, 3.4, 3.5, 3.6, 3.7) - IRAM 1512 - IRAM 1531 - IRAM 1627';
    doc.text(normaRefText, margin + 2, y);
    y += 6;
    doc.setTextColor(...C.text);
  }

  /* ══════════════════════════════════════════
     10) Anexo A — Trazabilidad del cálculo
     ══════════════════════════════════════════ */
  if (trazabilidad && includeAnexo) {
    renderAnexoTrazabilidad(doc, {
      trazabilidad, margin, contentW, componentes: sortedComps, evalBanda, evalTeorica,
      optimizacion, objetivoModo, prioridad1, prioridad2, includeGlosario,
      compAliases, compLegend, bandaRef, teoricaRef,
    });
  } else if (trazabilidad && includeGlosario) {
    // Only render glosario on a new page
    renderGlosarioOnly(doc, { margin, contentW, objetivoModo });
  }

  /* ══════════════════════════════════════════
     Headers (pages 2+) and footers
     ══════════════════════════════════════════ */
  const reportId = generateReportId('MZC');
  const reportDate = fmtDate();
  const shortTitle = isDraft ? 'Mezcla — Borrador' : (nombre || 'Informe de mezcla');
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // ── Header on pages 2+ ──
    if (i > 1) {
      doc.setFontSize(6.5);
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.muted);
      doc.text(shortTitle, margin, 8);
      doc.text(`${reportId}  |  ${reportDate}`, pageW - margin, 8, { align: 'right' });
      doc.setDrawColor(...C.muted);
      doc.setLineWidth(0.15);
      doc.line(margin, 10, pageW - margin, 10);
    }

    // ── Footer ──
    doc.setFontSize(7);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...C.muted);
    doc.setDrawColor(...C.muted);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 16, pageW - margin, pageH - 16);
    doc.setFontSize(5.5);
    doc.text('Este documento no reemplaza ensayos de laboratorio ni la evaluación de un profesional competente.', pageW / 2, pageH - 13, { align: 'center' });
    doc.setFontSize(7);
    doc.text(`Página ${i} de ${totalPages}`, pageW / 2, pageH - 8, { align: 'center' });
    doc.text(reportId, margin, pageH - 8);
    doc.text(`Generado: ${reportDate}`, pageW - margin, pageH - 8, { align: 'right' });
  }

  /* ══════════════════════════════════════════
     Save
     ══════════════════════════════════════════ */
  const fileName = isDraft
    ? `diseno_mezcla_borrador_${fmtDateFile()}.pdf`
    : `mezcla_${slug(nombre)}_${fmtDateFile()}.pdf`;

  doc.save(fileName);
}

/* ════════════════════════════════════════════════════════
   Anexo A — Trazabilidad del cálculo
   ════════════════════════════════════════════════════════ */

const ANEXO_MUTED = [140, 150, 160];
const ANEXO_HEAD = [70, 90, 110];
const ANEXO_HEAD_FG = [255, 255, 255];
const ANEXO_ALT = [248, 250, 252];

function renderAnexoTrazabilidad(doc, ctx) {
  const { trazabilidad: trz, margin, contentW, componentes,
          evalBanda, evalTeorica, optimizacion, objetivoModo,
          prioridad1, prioridad2, includeGlosario = true,
          compAliases: aliasesIn, compLegend: legendIn,
          bandaRef, teoricaRef } = ctx;

  // Build aliases if not passed (fallback)
  const { aliases: compAliases, legend: compLegend } = aliasesIn
    ? { aliases: aliasesIn, legend: legendIn }
    : buildAliases(componentes);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y;

  /* ── Start on a new page ── */
  doc.addPage();
  y = 15;

  function checkPage(need) {
    if (y + need > pageH - 20) { doc.addPage(); y = 15; }
  }

  /* ── Anexo header ── */
  doc.setFillColor(70, 90, 110);
  doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('Anexo A — Trazabilidad del cálculo', margin + 4, y + 7);
  let anexoBookmark = null;
  try {
    anexoBookmark = doc.outline.add(null, 'Anexo A — Trazabilidad del cálculo', { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
  } catch (_) { /* outline not supported */ }
  y += 16;
  doc.setFont('Helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...ANEXO_MUTED);
  doc.text('Detalle técnico del proceso de cálculo. Para uso en auditoría y verificación.', margin + 2, y);
  y += 6;

  /* ── Sub-section title helper ── */
  function subTitle(code, text) {
    checkPage(12);
    y += 3;
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...ANEXO_HEAD);
    doc.text(`${code}  ${text}`, margin + 2, y);
    try {
      doc.outline.add(anexoBookmark, `${code} ${text}`, { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
    } catch (_) { /* outline not supported */ }
    y += 2;
    doc.setDrawColor(...ANEXO_MUTED);
    doc.setLineWidth(0.15);
    doc.line(margin + 2, y, margin + contentW - 2, y);
    y += 4;
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...C.text);
  }

  /* ── Small key-value ── */
  function kv(label, value) {
    checkPage(5);
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...ANEXO_MUTED);
    doc.text(label, margin + 4, y);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...C.text);
    doc.text(String(value ?? '—'), margin + 44, y);
    y += 4;
  }

  /* ── Small table helper ── */
  function smallTable(head, body, colStyles) {
    checkPage(12);
    doc.autoTable({
      startY: y,
      margin: { left: margin + 2, right: margin + 2 },
      head: [head],
      body,
      theme: 'grid',
      styles: { fontSize: 7, textColor: C.text, cellPadding: 1.4 },
      headStyles: { fillColor: ANEXO_HEAD, textColor: ANEXO_HEAD_FG, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: ANEXO_ALT },
      columnStyles: colStyles || {},
    });
    y = doc.lastAutoTable.finalY + 5;
  }

  const METODO_LABELS = {
    REAL: 'Real', INTERPOLADO: 'Interp.', DEDUCIDO: 'Deducido',
    EQUIV: 'Equiv.', EXTRAPOLADO: 'Extrap.',
  };

  /* ════ A.1 — Tamices usados ════ */
  if (trz.tamices?.length) {
    subTitle('A.1', 'Tamices usados');
    if (trz.tamicesResumen) {
      const r = trz.tamicesResumen;
      doc.setFontSize(7);
      doc.setTextColor(...ANEXO_MUTED);
      const parts = [];
      if (r.total) parts.push(`Total: ${r.total}`);
      if (r.REAL) parts.push(`Real: ${r.REAL}`);
      if (r.INTERPOLADO) parts.push(`Interp.: ${r.INTERPOLADO}`);
      if (r.DEDUCIDO) parts.push(`Deduc.: ${r.DEDUCIDO}`);
      if (r.EQUIV) parts.push(`Equiv.: ${r.EQUIV}`);
      if (r.EXTRAPOLADO) parts.push(`Extrap.: ${r.EXTRAPOLADO}`);
      doc.text(parts.join('  |  '), margin + 4, y);
      y += 4;
    }
    smallTable(
      ['Tamiz', 'Abertura (mm)', '% Pasa mezcla', 'Fuente', 'Observación'],
      trz.tamices.map(t => [
        normTamiz(t.tamiz, t.aberturaMm),
        normAbertura(t.aberturaMm),
        t.pasaMix != null ? fmtNum(t.pasaMix, 2) : '—',
        METODO_LABELS[t.fuenteMix] || t.fuenteMix || '—',
        t.observacion || '',
      ]),
      { 1: { halign: 'right', cellWidth: 22 }, 2: { halign: 'right', cellWidth: 22 } },
    );
  }

  /* ════ A.2 — Cálculo de curva de mezcla ════ */
  if (trz.mixBreakdown?.length) {
    subTitle('A.2', 'Cálculo de curva de mezcla');

    // Determine actual component list for table columns.
    // When a sub-mezcla (virtual aggregate with negative ID) was used in the
    // calculation, mixBreakdown has fewer componentes than the expanded
    // componentes array (e.g. 3 vs 4).  In that case, use the breakdown's own
    // component list so every column has data.
    const breakdownComps = trz.mixBreakdown[0]?.componentes || [];
    const breakdownIds = new Set(breakdownComps.map(c => String(c.agregadoId)));

    // Check if all componentes match the breakdown — if not, fall back to breakdown's list
    const allMatch = componentes.every(c =>
      breakdownIds.has(String(c.id)) ||
      breakdownComps.some(bc => bc.nombre && bc.nombre === c.nombre)
    );

    let a2Comps;    // components used for columns
    let a2Aliases;  // aliases for those components
    let a2Legend;   // legend entries
    if (allMatch) {
      // Perfect match — use the PDF's component list (preserves user-visible order)
      a2Comps = componentes;
      a2Aliases = compAliases;
      a2Legend = compLegend;
    } else {
      // Mismatch (sub-mezcla scenario) — use breakdown's component list
      a2Comps = breakdownComps.map(bc => ({
        id: bc.agregadoId,
        nombre: bc.nombre || `ID ${bc.agregadoId}`,
        tipo: Number(bc.agregadoId) < 0 ? 'Fino' : (componentes.find(c => c.id == bc.agregadoId)?.tipo || 'Grueso'), // eslint-disable-line eqeqeq
      }));
      const built = buildAliases(a2Comps);
      a2Aliases = built.aliases;
      a2Legend = built.legend;
    }

    // Alias legend before table
    y = renderAliasLegend(doc, a2Legend, margin, y, checkPage);

    const head = ['Tamiz', 'Abertura'];
    for (const alias of a2Aliases) {
      head.push(alias);
    }
    head.push('% Final');

    const body = trz.mixBreakdown.map(row => {
      const r = [normTamiz(row.tamiz, row.aberturaMm), normAbertura(row.aberturaMm)];
      for (const comp of a2Comps) {
        // Primary match: by ID (loose equality handles string/number)
        let c = row.componentes?.find(x => x.agregadoId == comp.id); // eslint-disable-line eqeqeq
        // Fallback: match by nombre when IDs don't match (e.g. virtual aggregates)
        if (!c && comp.nombre) {
          c = row.componentes?.find(x => x.nombre && x.nombre === comp.nombre);
        }
        if (c && c.aportePonderado != null) {
          r.push(fmtNum(c.aportePonderado, 2));
        } else if (c && c.pasaAgregado != null) {
          // Aggregate has data at this sieve but 0% weight contribution
          r.push(`(${Math.round(c.pasaAgregado)})`);
        } else {
          r.push('—');
        }
      }
      r.push(row.pasaFinal != null ? fmtNum(row.pasaFinal, 2) : '—');
      return r;
    });

    const colStyles = { 1: { halign: 'right', cellWidth: 16 } };
    const lastIdx = head.length - 1;
    colStyles[lastIdx] = { halign: 'right', fontStyle: 'bold' };
    for (let i = 2; i < lastIdx; i++) colStyles[i] = { halign: 'right', cellWidth: 18 };

    smallTable(head, body, colStyles);

    // Legend for values — only show parentheses note when there are parenthesized values
    const hasParenValues = body.some(row => row.some(cell => typeof cell === 'string' && /^\(/.test(cell)));
    doc.setFontSize(6.5);
    doc.setTextColor(...ANEXO_MUTED);
    const legendNote = hasParenValues
      ? 'Valores = aporte ponderado (peso x % pasa). Valores entre parentesis = % pasa sin ponderacion (dato medido o inferido).'
      : 'Valores = aporte ponderado (peso x % pasa).';
    doc.text(legendNote, margin + 4, y);
    y += 4;
  }

  /* ════ A.3 — Cálculo de TMN ════ */
  if (trz.tmn) {
    subTitle('A.3', 'Cálculo de TMN');
    kv('Criterio', (trz.tmn.criterio || 'TMN = menor tamiz por el que pasa >= 95%').replace(/≥/g, '>='));
    kv('Resultado', trz.tmn.resultadoMm != null ? `${normAbertura(trz.tmn.resultadoMm)} mm` : '—');
    if (trz.tmn.candidatos?.length) {
      smallTable(
        ['Tamiz', 'Abertura (mm)', '% Pasa', '>= 95%'],
        trz.tmn.candidatos.slice(0, 20).map(c => [
          normTamiz(c.tamiz, c.aberturaMm),
          normAbertura(c.aberturaMm),
          c.pasaPct != null ? Math.round(c.pasaPct) : '—',
          c.cumple95 ? 'Sí' : 'No',
        ]),
        { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'center' } },
      );
    }
  }

  /* ════ A.4 — Cálculo de MF ════ */
  if (trz.mf) {
    subTitle('A.4', 'Cálculo de módulo de finura (serie normal, razón 2)');
    kv('Resultado', trz.mf.resultado != null ? fmtNum(trz.mf.resultado, 2) : '—');
    kv('Suma retenidos', trz.mf.suma != null ? fmtNum(trz.mf.suma, 2) : '—');
    doc.setFontSize(6.5);
    doc.setTextColor(...ANEXO_MUTED);
    doc.text('Serie de tamices: #100, #50, #30, #16, #8, #4, 3/8", 3/4", 1 1/2", 3" (0,15 a 75 mm, 10 tamices)', margin + 4, y);
    y += 4;
    if (trz.mf.tamicesUsados?.length) {
      smallTable(
        ['Abertura (mm)', '% Pasa', 'Retenido acum.', 'Disponible'],
        trz.mf.tamicesUsados.map(t => {
          return [
            normAbertura(t.aberturaMm),
            t.pasaPct != null ? Math.round(t.pasaPct) : '—',
            t.retenidoAcum != null ? fmtNum(t.retenidoAcum, 2) : '—',
            t.disponible ? 'Sí' : 'No',
          ];
        }),
        { 0: { halign: 'right' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'center' } },
      );
    }
  }

  /* ════ A.5 — Comparación con banda ════ */
  if (trz.banda?.evaluada && trz.banda.rows?.length) {
    subTitle('A.5', 'Comparación con banda');
    if (bandaRef) {
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...ANEXO_MUTED);
      doc.text(`Banda: ${bandaRef}`, margin + 4, y);
      y += 4;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
    }
    smallTable(
      ['Tamiz', 'Lím. inferior', 'Lím. superior', 'Valor mezcla', 'Estado', 'Desvío'],
      trz.banda.rows.map(r => [
        normTamiz(r.tamiz, r.aberturaMm),
        r.limInf != null ? fmtNum(r.limInf, 2) : '—',
        r.limSup != null ? fmtNum(r.limSup, 2) : '—',
        r.pasaMix != null ? fmtNum(r.pasaMix, 2) : '—',
        r.estado || '—',
        r.desvio != null && r.desvio !== 0 ? fmtNum(r.desvio, 2) : '—',
      ]),
      {
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'center' }, 5: { halign: 'right' },
      },
    );

    // Margin alerts — uses shared function (same source as page 3 summary)
    const marginRows = computeMarginAlerts(evalBanda, null, trz);
    if (marginRows.length > 0) {
      checkPage(8 + marginRows.length * 3.5);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...C.danger);
      doc.text('Observaciones de margen sobre banda:', margin + 4, y);
      y += 3.5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      for (const a of marginRows) {
        doc.setTextColor(180, 120, 30);
        doc.text(`  Preventivo - ${a.tamiz}: margen ${a.lado} = ${fmtNum(a.margin, 1)}%`, margin + 6, y);
        y += 3.5;
        checkPage(5);
      }
      doc.setTextColor(...C.text);
      y += 2;
    }

    // Add equivalence note when band sieves differ from mix sieves
    const equivRows = trz.banda.rows.filter(r => r.aberturaBandaMm && r.aberturaMm &&
      Math.abs(r.aberturaBandaMm - r.aberturaMm) > 0.01);
    if (equivRows.length) {
      doc.setFontSize(6.5);
      doc.setTextColor(...ANEXO_MUTED);
      const equivParts = equivRows.map(r => `${normAbertura(r.aberturaMm)} mm ~ ${normAbertura(r.aberturaBandaMm)} mm`);
      doc.text(`Equivalencias de tamices: ${equivParts.join(', ')}`, margin + 4, y);
      y += 4;
    }
  }

  /* ════ A.6 — Comparación con curva teórica ════ */
  if (trz.curvaTeorica?.evaluada && trz.curvaTeorica.rows?.length) {
    subTitle('A.6', 'Comparación con curva teórica');
    if (teoricaRef) {
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...ANEXO_MUTED);
      doc.text(`Curva teórica: ${teoricaRef}`, margin + 4, y);
      y += 4;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
    }
    smallTable(
      ['Abertura (mm)', 'Valor mezcla', 'Valor objetivo', 'Error abs.', 'Error^2'],
      trz.curvaTeorica.rows.map(r => [
        normAbertura(r.aberturaMm),
        r.pasaMix != null ? fmtNum(r.pasaMix, 2) : '—',
        r.pasaObjetivo != null ? fmtNum(r.pasaObjetivo, 2) : '—',
        r.errorAbsoluto != null ? fmtNum(r.errorAbsoluto, 2) : '—',
        r.errorCuadratico != null ? fmtNum(r.errorCuadratico, 2) : '—',
      ]),
      { 0: { halign: 'right' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    );
  }

  /* ════ A.7 — Optimización ════ */
  const optTrz = trz.optimizacion;
  if (optTrz?.disponible) {
    subTitle('A.7', 'Optimización');
    if (bandaRef) kv('Banda utilizada', bandaRef);
    if (teoricaRef) kv('Curva teórica utilizada', teoricaRef);
    kv('Método', translateOptMethod(optTrz.metodo || optimizacion?.metodo));
    kv('Factibilidad', optTrz.factibilidad || '—');
    kv('Exitosa', optTrz.exitosa === true ? 'Sí' : optTrz.exitosa === false ? 'No' : '—');
    if (optTrz.mensaje) kv('Mensaje', optTrz.mensaje);
    if (objetivoModo) {
      const modoLabel = objetivoModo === 'BANDA' ? 'Banda'
        : objetivoModo === 'TEORICA' ? 'Curva teórica'
        : objetivoModo === 'COMBINADO' ? 'Combinado (Banda + Curva)'
        : objetivoModo;
      kv('Modo objetivo', modoLabel);
    }
    if (prioridad1) kv('Prioridad 1', prioridad1 === 'BANDA' ? 'Banda' : 'Curva teórica');
    if (prioridad2) kv('Prioridad 2', prioridad2 === 'BANDA' ? 'Banda' : 'Curva teórica');
    if (optTrz.comparableSievesCount != null) kv('Tamices comparables', optTrz.comparableSievesCount);

    // Debug / slacks
    const dbg = optTrz._debug;
    if (dbg) {
      if (dbg.slacks) kv('Slacks', JSON.stringify(dbg.slacks));
      if (dbg.relaxations) kv('Relajaciones', JSON.stringify(dbg.relaxations));
    }

    // Warnings
    const warnings = optimizacion?.warnings || [];
    if (warnings.length) {
      checkPage(6 + warnings.length * 3.5);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...C.danger);
      doc.text('Advertencias del optimizador:', margin + 4, y);
      y += 3.5;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
      doc.setFontSize(7);
      for (const w of warnings) {
        const txt = typeof w === 'string' ? w : (w.message || JSON.stringify(w));
        doc.text(`  • ${txt}`, margin + 6, y);
        y += 3.5;
        checkPage(5);
      }
      y += 2;
    }
  }

  /* ════ A.8 — Glosario ════ */
  if (includeGlosario) {
    renderGlosarioSection(doc, { margin, contentW, subTitle, smallTable, objetivoModo });
  }
}

/* ════════════════════════════════════════════════════════
   Shared glosario table
   ════════════════════════════════════════════════════════ */
/** Build glossary entries filtered by evaluation mode. */
function buildGlosarioData(objetivoModo) {
  const base = [
    ['TMN', 'Tamaño Máximo Nominal. Menor tamiz por el que pasa >= 95% del material.'],
    ['MF', 'Módulo de Finura. Suma de %ret.acum. en serie de tamices (razón 2 desde #100) / 100. Serie: #100-#50-#30-#16-#8-#4-3/8"-3/4"-1 1/2"-3" (10 tamices, máx. 75 mm).'],
    ['Factible', 'Existe una combinación de porcentajes que cumple todas las restricciones.'],
  ];
  const bandaTerms = [
    ['Banda', 'Especificación normativa con límites inferior y superior por tamiz.'],
  ];
  const curvaTerms = [
    ['MAE', 'Error Absoluto Medio (Mean Absolute Error). Promedio de |mezcla - objetivo| por tamiz.'],
    ['RMSE', 'Raíz del Error Cuadrático Medio. Penaliza desvíos grandes más que MAE.'],
    ['R²', 'Coeficiente de determinación. 1,0 = ajuste perfecto.'],
    ['Curva teórica', 'Curva ideal de referencia (Fuller, MAA, Andreasen, etc.) contra la que se minimiza el error.'],
  ];

  if (objetivoModo === 'BANDA') return [...base, ...bandaTerms];
  if (objetivoModo === 'CURVA' || objetivoModo === 'TEORICA') return [...base, ...curvaTerms];
  // COMBINADO or unknown: include all
  return [...base, ...bandaTerms, ...curvaTerms];
}

function renderGlosarioSection(doc, { margin, contentW, subTitle, smallTable, objetivoModo }) {
  subTitle('A.8', 'Glosario');
  smallTable(
    ['Término', 'Definición'],
    buildGlosarioData(objetivoModo),
    { 0: { cellWidth: 24, fontStyle: 'bold' } },
  );
}

function renderGlosarioOnly(doc, { margin, contentW, objetivoModo }) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.addPage();
  let y = 15;

  doc.setFillColor(...ANEXO_HEAD);
  doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('Glosario', margin + 4, y + 7);
  y += 16;

  doc.autoTable({
    startY: y,
    margin: { left: margin + 2, right: margin + 2 },
    head: [['Término', 'Definición']],
    body: buildGlosarioData(objetivoModo),
    theme: 'grid',
    styles: { fontSize: 7, textColor: C.text, cellPadding: 1.4 },
    headStyles: { fillColor: ANEXO_HEAD, textColor: ANEXO_HEAD_FG, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: ANEXO_ALT },
    columnStyles: { 0: { cellWidth: 24, fontStyle: 'bold' } },
  });
}

export { chartToBase64 };
