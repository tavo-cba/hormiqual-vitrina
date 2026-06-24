import jsPDF from "jspdf";
import "jspdf-autotable";
import * as fmtFormatter from "../../../lib/format";
// Precisión canónica por parámetro de agregado (SSoT, CLAUDE.md). Los
// formatNumber locales NO fuerzan decimales → absorción entera salía "1"
// en vez de "1,0". formatParamValue('absorcion', x) = 1 decimal forzado.
import { formatParamValue } from "../../../lib/format/agregado";
import { registerDejavuOnDoc, hasDejavuLoaded } from "../../../lib/format/dejavuFont";
import {
  getCategoriaPdfColor,
  getCategoriaPdfLabel,
} from "../../../lib/compliance/pdfPresentation";
import { VEREDICTO } from "../../../lib/compliance";

/* ───────── Categorización de hits cumple/CUMPLE en este archivo (Prompt 3 C9.5) ─────────
 *
 * Archivo grande (6390 líneas, 19 secciones). Aplica el patrón establecido en C9.1-C9.4:
 *
 * (A) DISPLAY del veredicto al usuario — migrados al helper canónico:
 *     - Sección H "Verificaciones CIRSOC 200:2024" — Tag CUMPLE/NO CUMPLE
 *       de aire / pulverulento / HP + didParseCell color (5 sites)
 *     - Sección I "Verificación granulométrica" — estadoStr + COLOR_MAP/
 *       LABEL_MAP locales con CUMPLE/CUMPLE_AC/CUMPLE_CON_DESVIOS/NO_CUMPLE
 *       (2 sites de display, vocabulario interno preservado)
 *     - Sección L "Aptitud de materiales" — ESTADO_LABEL/ESTADO_COLOR
 *       (cumple/atencion/no_cumple/no_concluyente/sin_dato/informativo/
 *       excepcion/pendiente) + counters globales (4 sites)
 *     - Sub-bloque cloruros dentro de L — clEstadoLabel/clEstadoColor
 *       (CUMPLE_WORST_CASE / CUMPLE_CON_DATOS / NO_CUMPLE) (3 sites)
 *
 * (B) VOCABULARIO INTERNO preservado por D26:
 *     - Sección Q "Verificación experimental" — veredicto del pastón con
 *       vocabulario propio del flow experimental: APROBADO / RECHAZADO /
 *       OBSERVADO. Acto formal del responsable técnico, NO migra
 *       (ver D26 caso B en DEFERRED.md).
 *     - Estados internos del motor evaluador granulométrico (CUMPLE,
 *       CUMPLE_AC, CUMPLE_CON_DESVIOS, NO_CUMPLE) — son los strings que
 *       emite el backend y que esta capa traduce a categoría visual en
 *       los display sites; el string crudo no se renderiza.
 *
 * (C) COMENTARIOS + REGLAS NORMATIVAS preservadas:
 *     - "El veredicto monolítico APTO/NO_APTO vive ahora como
 *       resultado.assessment" (~L777) — comentario explicativo
 *     - Notas legales sobre cloruros worst-case, sustancias nocivas, etc.
 *     - "Importante: la verificación global del hormigón resulta CUMPLE,
 *       pero..." (~L3918) — texto normativo preservado
 */
import {
  EXPOSICION_LABELS,
  EXPOSICION_LABELS_SHORT,
  EXPOSICION_LABELS_MED,
  FORMA_LABELS,
  METODO_LABELS,
  MODO_EFECTO_LABELS,
  EFECTOS_CON_CALCULO,
  MODO_EFECTO_DESCRIPCION,
  MODO_EFECTO_REF_NORMATIVA,
  UNIDAD_DOSIS_LABELS,
  buildDosificacionTraceSections,
  buildMetodoHeaderLabel,
  ORIGEN_TIPO_LABELS,
  polishTraceText,
} from "./dosificacionTraceSections";
import { generarIRAM1627SVG } from "./iram1627Svg";

const CURVA_FAMILIA_PDF = {
  FULLER_TALBOT: "Fuller-Talbot",
  ANDREASEN: "Andreasen",
  ANDREASEN_MOD: "Andreasen Mod.",
  ROSIN_RAMMLER: "Rosin-Rammler",
};

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  primary:   [18, 52, 86],
  secondary: [66, 81, 99],
  light:     [245, 247, 250],
  green:     [21, 128, 61],
  greenBg:   [220, 252, 231],
  amber:     [146, 64, 14],
  amberBg:   [254, 243, 199],
  blue:      [29, 78, 216],
  blueBg:    [219, 234, 254],
  infoBg:    [239, 246, 255],
  text:      [31, 41, 55],
  muted:     [107, 114, 128],
  white:     [255, 255, 255],
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

// Helpers locales: wrappers del formatter centralizado (src/lib/format)
// Mantenemos la firma vieja para no tocar los ~46 call sites.
const fmtDate = () => fmtFormatter.formatDate(new Date(), { withTime: true });
const fmtDateFile = () => fmtFormatter.formatDateFile();
const slug = (str) => fmtFormatter.slug(str || 'dosificacion', 48);
function generateReportId(prefix = 'DOS') {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rnd = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}
function formatNumber(value, digits = 2, forceDecimals = false) {
  // Preservar el comportamiento anterior: si value no es número finito y no
  // es null/empty, devolver String(value). El formatter centralizado devuelve
  // fallback en ese caso, así que detectamos primero.
  if (value == null || value === '') return '-';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return fmtFormatter.formatNumber(value, { precision: digits, forceDecimals, fallback: '-' });
}
const tx = (str) => fmtFormatter.sanitizePdfText(str);

// Consistent rendering of material names across the report:
// strips inner double quotes/guillemets and collapses whitespace so that a name
// like `Arena Común "Las Quebradas"` renders cleanly no matter where it appears.
function fmtNombreMaterial(nombre) {
  if (nombre == null) return "";
  return String(nombre).replace(/["«»]/g, "").replace(/\s+/g, " ").trim();
}

// Mapping de código de tipología (snake_case interno del modelo) a etiqueta
// legible para el lector del PDF. Si una tipología nueva no aparece acá,
// el helper hace fallback a Title Case sobre el código.
const TIPOLOGIA_LABELS = Object.freeze({
  pavimento_rigido:  "Pavimento rígido",
  pavimento:         "Pavimento",
  estructural:       "Estructural",
  rcc:               "Hormigón compactado con rodillo (RCC)",
  hac:               "Hormigón autocompactante (HAC)",
  arquitectonico:    "Hormigón arquitectónico",
  hrdc:              "Hormigón de resistencia y densidad controladas (HRDC)",
  liviano_celular:   "Hormigón liviano celular",
  alivianado:        "Hormigón alivianado con agregado liviano",
});
function fmtTipologiaLabel(codigoOrLabel) {
  if (codigoOrLabel == null || codigoOrLabel === "") return null;
  const raw = String(codigoOrLabel).trim();
  // Si ya viene con espacio o en mayúsculas, asumimos que es nombre legible.
  if (/\s/.test(raw) || /[A-Z]/.test(raw)) return raw;
  const lc = raw.toLowerCase();
  if (TIPOLOGIA_LABELS[lc]) return TIPOLOGIA_LABELS[lc];
  // Fallback genérico: snake_case → "Snake Case"
  return lc.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================================
// MULTI-AXIS ASSESSMENT MODEL — Filosofía prestacional (PRESTACIONAL por defecto)
// ============================================================================
// La construcción del assessment vive ahora en el backend:
//   hormiqual-backend/src/domain/dosificacion/estadoGlobalConsolidator.js
//     - buildAssessment(input) → { estadoGeneral, conformidadNormativa,
//       viabilidadTecnica, necesidadValidacion, liberacion, sostenibilidad,
//       bloqueantes, riesgos, desvios, condicionantes, observaciones,
//       fortalezas, findings, reportMode, estado, motivos }
//
// El frontend sólo lee `resultado.assessment` y lo renderiza. Las constantes
// de labels (CONF_NORM_LABEL, VIAB_LABEL, etc.) y AXIS_COLOR siguen vivas
// acá porque son presentación, no lógica.
//
// Caso especial: el usuario puede elegir `NORMATIVO_ESTRICTO` en el diálogo
// de exportar PDF, pero el backend cachea el assessment con el modo vigente
// al calcular (default PRESTACIONAL). Para honrar la elección del diálogo
// sin re-llamar a la API, aplicamos localmente la única diferencia entre
// modos: en ESTRICTO, 2+ desvíos elevan el estadoGeneral a REQUIERE_AJUSTE.

const ESTADO_GENERAL_LABEL = {
  EN_EVALUACION:    'En evaluación',
  EN_VALIDACION:    'En validación',
  CONDICIONADO:     'Condicionado',
  VALIDADO:         'Validado',
  REQUIERE_AJUSTE:  'Requiere ajuste',
  BLOQUEADO:        'Bloqueado',
};
const CONF_NORM_LABEL = {
  CONFORME:        'Conforme',
  CON_DESVIOS:     'Con desvíos respecto del criterio normativo',
  NO_CONFORME:     'No conforme al criterio normativo de referencia',
  NO_CONCLUYENTE:  'No concluyente',
};
const VIAB_LABEL = {
  FAVORABLE:               'Favorable',
  POTENCIALMENTE_VIABLE:   'Potencialmente viable',
  CONDICIONADA:            'Condicionada a validación',
  RIESGO_ALTO:             'Riesgo técnico alto',
  NO_RECOMENDADA:          'No recomendada sin rediseño',
};
const NECESIDAD_VAL_LABEL = {
  TEORICO:                 'Teórico',
  REQUIERE_PASTON:         'Requiere pastón de prueba',
  VERIFICACION_REFORZADA:  'Requiere verificación reforzada',
  VALIDADO_EXP:            'Validado experimentalmente',
  VALIDADO_PROD:           'Validado en producción',
};
const LIBERACION_LABEL = {
  LIBERABLE:           'Liberable',
  CONDICIONAL:         'Liberable con condiciones',
  PENDIENTE_EVIDENCIA: 'Pendiente de evidencia',
  NO_LIBERABLE_AUN:    'No liberable aún',
};

// Color tokens (RGB tuples) — semánticos por nivel, no por eje.
const AXIS_COLOR = {
  // verde (favorable)
  CONFORME: [21, 128, 61], FAVORABLE: [21, 128, 61], VALIDADO: [21, 128, 61],
  VALIDADO_EXP: [21, 128, 61], VALIDADO_PROD: [21, 128, 61], LIBERABLE: [21, 128, 61],
  // ámbar (gestionable)
  CON_DESVIOS: [180, 120, 20], POTENCIALMENTE_VIABLE: [180, 120, 20],
  CONDICIONADA: [180, 120, 20], CONDICIONADO: [180, 120, 20],
  CONDICIONAL: [180, 120, 20], REQUIERE_PASTON: [180, 120, 20],
  EN_VALIDACION: [180, 120, 20], PENDIENTE_EVIDENCIA: [180, 120, 20],
  // gris-violeta (informativo / pendiente)
  EN_EVALUACION: [100, 100, 140], NO_CONCLUYENTE: [100, 100, 140], TEORICO: [100, 100, 140],
  // naranja (atención fuerte)
  REQUIERE_AJUSTE: [200, 100, 10], RIESGO_ALTO: [200, 100, 10],
  VERIFICACION_REFORZADA: [200, 100, 10], NO_LIBERABLE_AUN: [200, 100, 10],
  // rojo (verdaderamente bloqueante)
  NO_CONFORME: [192, 57, 43], NO_RECOMENDADA: [192, 57, 43], BLOQUEADO: [192, 57, 43],
};

/**
 * Aplica la diferencia de modo ESTRICTO sobre un assessment ya clasificado
 * por el backend. Evita duplicar la lógica heurística del motor en el
 * frontend: sólo escala `estadoGeneral` a REQUIERE_AJUSTE cuando el modo
 * elegido es NORMATIVO_ESTRICTO y hay 2+ desvíos normativos.
 *
 * Si el assessment ya está en BLOQUEADO o REQUIERE_AJUSTE, no se toca.
 * Si el modo es PRESTACIONAL, tampoco.
 */
function aplicarReportMode(assessment, reportMode) {
  if (!assessment) return null;
  if (reportMode !== 'NORMATIVO_ESTRICTO') {
    return assessment.reportMode === reportMode ? assessment : { ...assessment, reportMode };
  }
  const desvios = Array.isArray(assessment.desvios) ? assessment.desvios.length : 0;
  const yaEscalado = ['REQUIERE_AJUSTE', 'BLOQUEADO'].includes(assessment.estadoGeneral);
  if (desvios >= 2 && !yaEscalado) {
    return { ...assessment, estadoGeneral: 'REQUIERE_AJUSTE', reportMode };
  }
  return { ...assessment, reportMode };
}

/**
 * Deriva el sello de "verificación estricta" del modo PRESCRIPTIVO a partir
 * del assessment ya consolidado por el backend
 * (estadoGlobalConsolidator.buildAssessment). NO recalcula criterios ni
 * introduce reglas normativas nuevas: sólo reexpresa la clasificación que el
 * motor ya produjo como un veredicto binario APTA / NO APTA con los
 * incumplimientos enumerados. Es presentación, no evaluación — por eso vive
 * en el módulo del PDF y no en `domain/`.
 *
 * Criterio (validado con revisor-civil; ninguna regla nueva, sólo lectura de
 * lo que la matriz/engines ya clasificaron): bajo la lupa prescriptiva
 * (CIRSOC 200:2024 / IRAM) una dosificación es APTA únicamente si su
 * conformidad normativa es CONFORME y no hay bloqueantes, riesgos ni desvíos.
 * Cualquier otra situación —incluida la verificación no concluyente por falta
 * de ensayos/datos exigidos— NO permite declararla apta: ausencia de
 * evidencia no equivale a cumplimiento. El sello es informativo y no bloquea
 * la emisión del informe (modelo dual PR9: el catálogo del tenant sigue
 * siendo soberano para el veredicto prestacional).
 *
 * Lee únicamente `conformidadNormativa` y los arrays de hallazgos; NO usa
 * `estadoGeneral` (por eso no requiere pasar por `aplicarReportMode`).
 *
 * @param {object|null} assessment  `resultado.assessment` del backend.
 * @returns {{apta:boolean, titulo:string, motivo:string,
 *            incumplimientos:string[]}|null}
 *          null si no hay assessment (diseño legacy) → el caller no fabrica
 *          un veredicto desde el frontend.
 */
export function derivarSelloEstricto(assessment) {
  if (!assessment) return null;
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const bloqueantes    = arr(assessment.bloqueantes);
  const riesgos        = arr(assessment.riesgos);
  const desvios        = arr(assessment.desvios);
  const condicionantes = arr(assessment.condicionantes);
  const observaciones  = arr(assessment.observaciones);
  const conf = assessment.conformidadNormativa;

  const incumplimientosDuros = [...bloqueantes, ...riesgos, ...desvios];

  if (conf === 'CONFORME' && incumplimientosDuros.length === 0) {
    // APTA. Si existen condicionantes de liberación (p. ej. pastón de prueba
    // obligatorio), se listan como contexto sin degradar el veredicto: no son
    // incumplimientos, son condiciones a cumplir antes de liberar.
    return {
      apta: true,
      titulo: 'VERIFICACIÓN ESTRICTA: APTA',
      motivo: condicionantes.length > 0
        ? 'Sin incumplimientos bajo la lupa normativa CIRSOC 200:2024 / IRAM. Condiciones de liberación a cumplir:'
        : 'No se detectaron incumplimientos bajo la lupa normativa CIRSOC 200:2024 / IRAM.',
      incumplimientos: condicionantes,
    };
  }

  if (incumplimientosDuros.length > 0) {
    return {
      apta: false,
      titulo: 'VERIFICACIÓN ESTRICTA: NO APTA',
      motivo: 'Incumple exigencias de CIRSOC 200:2024 / IRAM bajo verificación normativa estricta:',
      incumplimientos: incumplimientosDuros,
    };
  }

  // Sin incumplimientos duros pero conformidad no CONFORME → no concluyente:
  // faltan ensayos/datos exigidos. La lupa estricta no puede declarar apta.
  const faltantes = [...condicionantes, ...observaciones];
  return {
    apta: false,
    titulo: 'VERIFICACIÓN ESTRICTA: NO APTA',
    motivo: 'Verificación normativa no concluyente: faltan ensayos o datos exigidos por CIRSOC 200:2024 / IRAM para certificar aptitud.',
    incumplimientos: faltantes.length
      ? faltantes
      : ['No se cuenta con la evidencia normativa completa requerida.'],
  };
}

async function fetchLogoBase64(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  try {
    const response = await fetch(thumbnailUrl, { mode: "cors" });
    const blob = await response.blob();
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

function addFooter(doc, margin, { reportId, reportTitle, reportDate, estado } = {}) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const dateStr = reportDate || fmtDate();

  // Short footer qualifier based on estado
  const isApproved = estado === "APROBADO" || estado === "EN_PRODUCCION";
  const footerQualifier = !isApproved && estado
    ? " \u2014 documento sin validez"
    : "";

  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);

    // ── Header on pages 2+ ──
    if (i > 1 && reportTitle) {
      doc.setFontSize(6.5);
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(...C.muted);
      doc.text(tx(reportTitle), margin, 8);
      const headerRight = [reportId, dateStr].filter(Boolean).join("  |  ");
      doc.text(headerRight, pageW - margin, 8, { align: "right" });
      doc.setDrawColor(...C.muted);
      doc.setLineWidth(0.15);
      doc.line(margin, 10, pageW - margin, 10);
    }

    // ── Footer ──
    doc.setDrawColor(...C.muted);
    doc.setLineWidth(0.15);
    doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    // Left: report ID + qualifier (truncate if too long for available space)
    if (reportId) {
      const footerText = reportId + footerQualifier;
      const maxFooterW = pageW / 2 - margin - 10; // leave room for center text
      let displayFooter = footerText;
      if (doc.getTextWidth(footerText) > maxFooterW) {
        // Truncate reportId but keep qualifier
        const qualW = doc.getTextWidth(footerQualifier);
        const availW = maxFooterW - qualW;
        let truncId = reportId;
        while (doc.getTextWidth(truncId) > availW && truncId.length > 10) truncId = truncId.slice(0, -1);
        displayFooter = truncId + '...' + footerQualifier;
      }
      doc.text(displayFooter, margin, pageH - 7);
    }
    // Center: page number
    doc.text(tx(`Página ${i} de ${pageCount}`), pageW / 2, pageH - 7, { align: "center" });
    // Right: date
    doc.text(dateStr, pageW - margin, pageH - 7, { align: "right" });
  }
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function sectionHeader(doc, title, x, y, width, parentBookmark = null) {
  doc.setFillColor(...C.primary);
  doc.roundedRect(x, y, width, 7.5, 1.2, 1.2, "F");
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...C.white);
  doc.text(tx(title), x + 3, y + 5.2);
  // PDF outline bookmark
  try {
    doc.outline.add(parentBookmark || null, tx(title), { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
  } catch (_) { /* jsPDF version may not support outline */ }
  return y + 10.5;
}

function subHeader(doc, title, x, y) {
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...C.primary);
  doc.text(tx(title), x, y);
  return y + 5;
}

/**
 * Colored callout box. bg and fg are RGB arrays.
 * Returns new y after the box.
 */
function callout(doc, text, x, y, width, bg, fg) {
  const padding = 3.5;
  const textWidth = width - padding * 2;
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(8.5);
  const lines = doc.splitTextToSize(tx(text), textWidth);
  const lineH = 4.8;
  const boxH = lines.length * lineH + padding * 1.5;
  doc.setFillColor(...bg);
  doc.roundedRect(x, y, width, boxH, 1.5, 1.5, "F");
  doc.setTextColor(...fg);
  // Alineado a la izquierda. NO usar align:'justify' acá: jsPDF, al recibir
  // un array de líneas ya wrappeadas, calcula el word-spacing como
  // (maxWidth-anchoLinea)/(palabras-1); con líneas de 1 palabra o vacías
  // divide por cero → Tw=Infinity → texto fragmentado/kerning explotado
  // (regresión detectada por smoke en el Aviso legal). Izquierda es legible
  // y es el estándar para texto legal/disclaimer.
  doc.text(lines, x + padding, y + padding + 1.5);
  doc.setTextColor(...C.text);
  return y + boxH + 2;
}

/** Adds a page if needed. Returns updated y.
 *  Footer occupies ~20mm at the bottom, so content must stay above pageH - 20. */
const FOOTER_RESERVE = 20;
function checkBreak(doc, y, pageH, margin, needed = 35) {
  if (y + needed > pageH - FOOTER_RESERVE) {
    doc.addPage();
    return 18;
  }
  return y;
}

/** Render a two-column key-value section. Returns new y. */
function twoColParams(doc, leftRows, rightRows, margin, y, contentW, rowH = 5.2) {
  const colW = (contentW - 6) / 2;
  const midX = margin + colW + 6;
  const lx = margin + 2;
  const vxL = margin + 38;
  const vxR = midX + 38;
  const startY = y;
  doc.setFontSize(8);
  leftRows.forEach(([label, value], i) => {
    const ly = startY + i * rowH;
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(...C.secondary);
    doc.text(tx(label), lx, ly);
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(...C.text);
    const lines = doc.splitTextToSize(tx(value), colW - 40);
    doc.text(lines, vxL, ly);
  });
  rightRows.forEach(([label, value], i) => {
    const ry = startY + i * rowH;
    doc.setFont("Helvetica", "bold");
    doc.setTextColor(...C.secondary);
    doc.text(tx(label), midX, ry);
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(...C.text);
    const lines = doc.splitTextToSize(tx(value), colW - 40);
    doc.text(lines, vxR, ry);
  });
  return startY + Math.max(leftRows.length, rightRows.length) * rowH + 4;
}

// ─── Label maps ───────────────────────────────────────────────────────────────
// M7 — `AC_GOBERNANTE_LABELS` y `CEMENTO_GOBERNANTE_LABELS` se importan desde
// la SSoT compartida `dosificacionLabels.js` (antes estaban duplicados con
// pequeñas variaciones de redacción).
const { AC_GOBERNANTE_LABELS } = require('./dosificacionLabels');

const CEMENTO_GOB_LABELS = {
  CALCULO:    "Cálculo (agua / a/c)",
  PLIEGO:     "Mínimo contractual de pliego",
  AMC_PLIEGO: "Mínimo por relación a/mc de pliego",
};

// Translation map for internal regla codes in fuentesCalculo
const REGLA_LABELS = {
  PORC_SOBRE_CEMENTO:           "% sobre peso de cemento",
  AHORRO_AGUA:                  "Reducción porcentual de agua",
  AUMENTO_ASENTAMIENTO:         "Efecto reológico (asentamiento)",
  ICPA_BASE_DIRECTO:            "Lectura directa Ábaco 1",
  ICPA_BASE_INTERPOLACION_MF:   "Interpolación Ábaco 1 por MF",
  ICPA_BASE_INTERPOLACION_ASENTAMIENTO: "Interpolación Ábaco 1 por asentamiento",
  ICPA_BASE_INTERPOLACION_BILINEAL: "Interpolación bilineal Ábaco 1",
  TABLA_INTERPOLACION:          "Interpolación de tabla",
  TABLA_DIRECTA:                "Lectura directa de tabla",
  CURVA_CEMENTO:                "Curva específica del cemento",
  TABLA_ACI:                    "Tabla de agua por TMN (ref. ACI Committee 211)",
  DURABILIDAD_CIRSOC:           "CIRSOC 200:2024",
  ML_POR_100KG_CEMENTO:         "mL por cada 100 kg de cemento",
  KG_M3:                        "kg/m³",
  MIN_GOBERNANTE:               "Mínimo gobernante",
  FIJO:                         "Valor fijo",
  LIMITE_MAXIMO:                "Límite máximo",
};
function translateRegla(regla) {
  if (!regla) return "-";
  if (REGLA_LABELS[regla]) return REGLA_LABELS[regla];
  // SOLO humanizar códigos ENUM (todo mayúsculas/dígitos/guión bajo). Una
  // regla que ya es una frase legible (tiene minúsculas/espacios/acentos) se
  // pasa tal cual: el .toLowerCase() incondicional anterior destrozaba los
  // acrónimos del motor (HRDC→hrdc, RDC→rdc, PUV→puv, Segerer→segerer,
  // L/m³→l/m³, Σ→s). El formateo fino lo hace polishTraceText.
  if (/^[A-Z0-9_]+$/.test(regla)) return regla.replace(/_/g, " ").toLowerCase();
  return regla;
}

// Translation map for agua-base method codes → human-readable labels (section G)
// Los códigos describen el método de interpolación sobre la tabla, no la fuente
// de los valores (la tabla puede tener valores ICPA, ajustados o propios del usuario).
const AGUA_METODO_LABELS = {
  ICPA_BASE_DIRECTO:                    "Lectura directa de la tabla",
  ICPA_BASE_INTERPOLACION_MF:           "Interpolación por módulo de finura",
  ICPA_BASE_INTERPOLACION_ASENTAMIENTO: "Interpolación por asentamiento",
  ICPA_BASE_INTERPOLACION_BILINEAL:     "Interpolación bilineal (MF + asentamiento)",
  DIRECTO:                              "Lectura directa de tabla",
  INTERPOLACION_TMN:                    "Interpolación por TMN",
  INTERPOLACION_ASENTAMIENTO:           "Interpolación por asentamiento",
  TMN_CERCANO:                          "TMN más cercano",
};
function translateAguaMetodo(metodo) {
  if (!metodo) return "-";
  if (AGUA_METODO_LABELS[metodo]) return AGUA_METODO_LABELS[metodo];
  // RDC Fase 3: metodoAgua = `CONSISTENCIA:ASENTAMIENTO|EXTENDIDO_CONO`.
  // No filtrar la clave interna al cliente: rotular legible.
  if (String(metodo).startsWith("CONSISTENCIA:")) {
    const m = String(metodo).split(":")[1];
    if (m === "ASENTAMIENTO") return "Por consistencia (asentamiento objetivo)";
    if (m === "EXTENDIDO_CONO") return "Por consistencia (extendido de cono objetivo)";
    return "Por consistencia objetivo";
  }
  return metodo.replace(/[_:]/g, " ").toLowerCase();
}

// Absorption alert thresholds
const ABSORCION_UMBRAL_FINO  = 2.5;
const ABSORCION_UMBRAL_GRUESO = 2.0;

// ─── Main export ──────────────────────────────────────────────────────────────
export async function generarInformeDosificacionPdf({
  snapshot,
  empresa,
  planta,
  usuario,
  logoUrl,
  titulo,
  includeAnexo = false,
  includeGlosario = true,
  includeFullTrace = false,
  includeCostos = false,
  costosData = null,
  includeAnexoMateriales = false,
  materialesData = null,
  includeHistorial = false,
  historialData = null,
  includeVolDiagram = true,
  includeSensibilidad = false,
  secciones = null, // section visibility map { resumenEjecutivo: true, parametros: true, ... }
  // Prueba data (optional)
  analisisEficiencia = null,
  // Modo del documento (decisión 2026-05-28, supersedes PR9 2026-05-04):
  //   DESCRIPTIVO (default): muestra los parámetros calculados con la
  //     referencia normativa al lado, sin emitir veredicto. No declara
  //     CUMPLE / NO CUMPLE / APTO / NO APTO. Apto para documentación
  //     interna y entrega al cliente.
  //   NORMATIVO: evalúa contra CIRSOC 200:2024 + serie IRAM estricta,
  //     sin filtros del plan de control de calidad de la planta. Emite
  //     veredictos formales. Apto para auditorías externas.
  // Acepta aliases viejos PRESTACIONAL/PRESCRIPTIVO (back-compat).
  modoEvaluacion = 'DESCRIPTIVO',
  // outputMode controla la entrega del documento:
  //   'save' (default) → descarga el PDF (doc.save), comportamiento histórico.
  //   'doc'            → devuelve el objeto jsPDF sin guardar, para que el
  //                      caller obtenga un blob/bloburl (preview embebido, CU8).
  outputMode = 'save',
}) {
  // Señal efectiva del modo NORMATIVO. El diálogo viejo transmitía la
  // elección "Cumplimiento estricto" como `snapshot.reportMode =
  // 'NORMATIVO_ESTRICTO'` (lo que consume la portada multi-eje); el prop
  // `modoEvaluacion` es la vía nueva (toggle 2026-05-28). El banner y el
  // sello deben encenderse con CUALQUIERA de las dos para no quedar
  // desincronizados con la portada.
  const _modoUpper = String(modoEvaluacion).toUpperCase();
  const _esModoNormativo = (
    _modoUpper === 'NORMATIVO' || _modoUpper === 'PRESCRIPTIVO'
    || String(snapshot?.reportMode).toUpperCase() === 'NORMATIVO_ESTRICTO'
  );
  let _modoNorm = _esModoNormativo ? 'NORMATIVO' : 'DESCRIPTIVO';
  // Section visibility helper — if secciones is provided, use it; otherwise all sections are visible
  const showSection = (key) => secciones ? (secciones[key] !== false) : true;

  // Detección HRDC: las verificaciones CIRSOC 200 (Tablas 3.4/3.6, 4.3, 4.4, 9.3,
  // banda IRAM 1627, aptitud) NO aplican a hormigones livianos celulares.
  // En vez de pasar `secciones` con todas las flags apagadas desde el caller,
  // detectamos la tipología en el snapshot y suprimimos esas secciones aquí.
  // Misma detección de 3 señales que dosificacionTraceSections.buildMetodo
  // Descripcion: snapshots viejos pueden no tener tipologiaCodigo pero sí
  // trazabilidad.metodoCalculo/motorVersion. Si esto se desincroniza, el
  // body no detecta HRDC (muestra "naturalmente atrapado", habilita secciones
  // CIRSOC) mientras el Anexo sí lo detecta → informe inconsistente.
  const _trazHRDC = snapshot?.trazabilidad || {};
  const esHRDC = _trazHRDC?.metodoCalculo === 'HRDC'
    || String(_trazHRDC?.motorVersion || '').toUpperCase().startsWith('HRDC')
    || String(snapshot?.tipologiaCodigo || snapshot?.tipologia?.codigo || '').toLowerCase() === 'hrdc';

  // Sesión 2026-05-29: Hormigón Alivianado también está fuera de CIRSOC 200.
  // Mismo tratamiento que HRDC en términos normativos: NUNCA estricto, sin
  // verificaciones de Tablas 3.4/3.6/4.3/4.4, sin banda IRAM 1627.
  const esAlivianado = _trazHRDC?.metodoCalculo === 'ALIVIANADO'
    || String(snapshot?.tipologiaCodigo || snapshot?.tipologia?.codigo || '').toLowerCase() === 'alivianado';
  // Agrupamos como "fuera de CIRSOC" para suprimir verificaciones — pero los
  // KPIs y disclaimers son específicos del modelo.
  const fueraDeCirsoc = esHRDC || esAlivianado;

  // HRDC/Alivianado fuera de CIRSOC/IRAM: NUNCA en modo estricto/prescriptivo,
  // aunque el snapshot/preferencia traiga NORMATIVO_ESTRICTO (defensa en
  // profundidad). Neutraliza sello/banner/portada estrictos.
  if (fueraDeCirsoc) _modoNorm = 'DESCRIPTIVO';

  // Dynamic section numbering — letters A, B, C... assigned sequentially to visible sections
  let _sectionCounter = 0;
  let _currentLetter = 'A';
  const nextSectionLetter = () => { _currentLetter = String.fromCharCode(65 + _sectionCounter++); return _currentLetter; };
  const dynTitle = (title) => `${nextSectionLetter()}. ${title}`;
  const dynSub = (n, title) => `${_currentLetter}.${n}. ${title}`;
  const doc = new jsPDF("p", "mm", "a4");
  // P2.1 — DejaVu Sans embedded si está precargada (mismo pattern que el certificado)
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
  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 16;

  // Ensure autoTable respects footer space on all tables
  doc.autoTable.defaults = {
    ...doc.autoTable.defaults,
    margin: { bottom: FOOTER_RESERVE + 2 },
  };

  // ── Resolved data ────────────────────────────────────────────────────────────
  const resultado         = snapshot?.resultado       || {};
  const traz              = snapshot?.trazabilidad    || {};
  const resumenDec        = traz?.resumenDecisiones   || {};
  const relacionAC        = traz?.relacionAC          || {};
  const durabilidad       = traz?.durabilidad         || null;
  const pliego            = traz?.pliego              || null;
  const cementoCalculado  = traz?.cementoCalculado    || {};
  const aguaBase          = traz?.aguaBase            || {};
  const correccionAditivo = traz?.correccionAditivo   || [];
  const trazAditivos      = traz?.aditivos            || [];
  const absorcionMezcla   = traz?.absorcionMezcla     || null;
  const mezclaNombre      = traz?.mezclaBase?.nombre  || snapshot?.mezclaNombre || null;
  const mezclaCodigo      = traz?.mezclaBase?.codigo  || null;
  const snapAditivos      = snapshot?.aditivos        || [];
  const snapAdiciones     = snapshot?.adiciones       || [];
  const balanceVol        = traz?.balanceVolumenes    || resultado?.balanceVolumenes || null;
  const puvTeorico        = traz?.puvTeorico          || resultado?.puvTeorico || null;
  const tipoAire          = traz?.tipoAire            || resultado?.tipoAire  || null;
  const validacionCruzada = traz?.validacionCruzada   || [];

  // Effective design inputs from trazabilidad (engine-resolved values)
  const inpTmn    = traz?.inputs?.tmnMm       ?? snapshot?.tmnMm;
  const inpMf     = traz?.inputs?.moduloFinura ?? null;
  const inpForma  = traz?.inputs?.formaAgregado ?? snapshot?.formaAgregado;
  const inpEdad   = traz?.inputs?.edadDias    ?? 28;
  const inpAire   = traz?.inputs?.airePct     ?? snapshot?.airePct;

  // Source flags: read from engine context (nested inside traz.inputs.context)
  const hasMezcla = traz?.mezclaBase != null;
  const ctx       = traz?.inputs?.context || {};
  const tmnSrc    = ctx.tmnSource === "MEZCLA" ? "(de mezcla)" : ctx.tmnSource === "MANUAL" ? "(ingresado)" : hasMezcla ? "(de mezcla)" : "(ingresado)";
  const mfSrc     = ctx.mfSource === "MANUAL" ? "(ingresado)" : ctx.mfSource === "MEZCLA" ? "(de mezcla)" : hasMezcla ? "(de mezcla)" : "(ingresado)";
  const formaSrc  = ctx.formaSource === "MEZCLA" ? "(de mezcla)" : ctx.formaSource === "MANUAL" ? "(ingresada)" : (snapshot?.formaAgregado === "AUTO" || hasMezcla) ? "(de mezcla)" : "(ingresada)";

  // Exposure label — clean (avoid raw CIRSOC enum codes leaking)
  const exposicionLabel = (() => {
    const code = snapshot?.exposicion || durabilidad?.codigo;
    if (!code) return "Sin clase de exposición";
    const full = EXPOSICION_LABELS[code];
    if (full) return full;
    return tx(code);
  })();

  const exposicionShort = (() => {
    const code = snapshot?.exposicion || durabilidad?.codigo;
    if (!code) return "Sin exposición";
    return EXPOSICION_LABELS_MED[code] || EXPOSICION_LABELS_SHORT[code] || tx(code);
  })();

  const warnings = (snapshot?.warnings || []).map((w) => {
    if (typeof w === "string") return tx(w);
    const campo = w.campo ? `[${w.campo}] ` : "";
    return tx(`${campo}${w.msg || w.message || "Advertencia técnica"}`);
  }).filter(Boolean);

  // Etiqueta corta del método para el encabezado (motor = HormiQual). La
  // descripción completa con base Segerer/AAHE + disclaimer "no normativo"
  // se renderiza en el cuerpo (sección Resumen vía buildDosificacionTrace
  // Sections + bloque disclaimer HRDC).
  const metodoHeaderLabel = buildMetodoHeaderLabel(snapshot);
  const metodoLabel = METODO_LABELS[snapshot?.metodo] || snapshot?.metodo || "\u2014";

  const logoData = await fetchLogoBase64(logoUrl);
  const reportTitle =
    titulo ||
    snapshot?.nombre ||
    (snapshot?.isDraft ? "Diseño de dosificación \u2014 Borrador" : "Diseño de dosificación");

  // ══════════════════════════════════════════════════════════════════════════════
  // HEADER BAR
  // ══════════════════════════════════════════════════════════════════════════════
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, pageW, 36, "F");

  if (logoData) {
    try { doc.addImage(logoData, "PNG", margin, 5, 24, 24); } catch { /* skip */ }
  }

  const titleX = logoData ? margin + 28 : margin + 2;
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...C.white);
  doc.text(tx(reportTitle), titleX, 14);
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(8);
  const estadoPdf = snapshot?.estado || "BORRADOR";
  if (estadoPdf === "APROBADO" || estadoPdf === "EN_PRODUCCION") {
    doc.text(tx("DOSIFICACIÓN APROBADA PARA PRODUCCIÓN"), titleX, 20);
  } else if (estadoPdf === "A_PRUEBA") {
    doc.text(tx("Dosificación en etapa de prueba"), titleX, 20);
  } else if (estadoPdf === "PENDIENTE_REVISION") {
    doc.text(tx("Pendiente de revisión"), titleX, 20);
  } else if (snapshot?.isDraft) {
    doc.text(tx("Borrador \u2014 aún no guardado en catálogo"), titleX, 20);
  } else {
    doc.text(tx("Diseño guardado en catálogo"), titleX, 20);
  }
  if (empresa) doc.text(tx(empresa), pageW - margin, 14, { align: "right" });
  const subtitleParts = [
    planta  ? `Planta: ${tx(planta)}`   : null,
    usuario ? `Usuario: ${tx(usuario)}` : null,
  ].filter(Boolean);
  if (subtitleParts.length > 0) {
    doc.setFontSize(7.5);
    doc.text(subtitleParts.join("  |  "), pageW - margin, 20, { align: "right" });
  }
  doc.setFontSize(7.5);
  // El método compuesto puede ser muy largo (curva + verificaciones +
  // durabilidad + restricciones de pliego). El header es de altura fija y la
  // fila comparte espacio con el bloque de aprobación alineado a la derecha,
  // así que se trunca a una sola línea con elipsis en lugar de desbordar y
  // cortarse abruptamente contra el borde. La descripción completa del método
  // sigue disponible en la sección de trazabilidad del informe.
  const _aprobHeader = (estadoPdf === "APROBADO" || estadoPdf === "EN_PRODUCCION") && snapshot?.aprobadoPor;
  const _metodoMaxW = (pageW - margin) - titleX - (_aprobHeader ? 78 : 6);
  const _metodoFull = `Método: ${metodoHeaderLabel}`;
  const _metodoLines = doc.splitTextToSize(tx(_metodoFull), _metodoMaxW);
  const _metodoTxt = _metodoLines.length > 1
    ? `${_metodoLines[0].replace(/\s+\S*$/, '')}…`
    : _metodoLines[0];
  doc.text(_metodoTxt, titleX, 26);
  doc.text(tx(`Fecha: ${fmtDate()}`), titleX, 31);
  // Right-aligned approval info for APROBADO
  if (_aprobHeader) {
    const aprobFecha = snapshot.fechaAprobacion
      ? new Date(snapshot.fechaAprobacion).toLocaleDateString("es-AR") : "";
    doc.text(tx(`Aprobado por: ${snapshot.aprobadoPor} \u2014 ${aprobFecha}`), pageW - margin, 26, { align: "right" });
    if (snapshot.hashIntegridad) {
      doc.text(tx(`Hash: ${snapshot.hashIntegridad.substring(0, 16)}`), pageW - margin, 31, { align: "right" });
    }
  }

  y = 42;

  // ══════════════════════════════════════════════════════════════════════════════
  // Banner del modo del documento (decisión 2026-05-28).
  // Solo se renderiza en modo NORMATIVO. En DESCRIPTIVO no hace falta
  // banner — el documento mismo no emite valoración normativa.
  // Patrón: `splitTextToSize` + altura dinámica para evitar el overflow
  // que afectaba al banner del PR1 (auditor visual 2026-05-28).
  // ══════════════════════════════════════════════════════════════════════════════
  if (_modoNorm === 'NORMATIVO') {
    const bannerInnerPad = 3;
    const bannerInnerW = (pageW - 2 * margin) - 2 * bannerInnerPad;
    const titleH = 4;
    const lineH = 3.4;
    const padBottom = 1.5;
    const titleText = 'VERIFICACIÓN NORMATIVA ESTRICTA';
    const descText = 'Evalúa contra la matriz CIRSOC 200:2024 + serie IRAM completa, sin filtros del plan de control de calidad de la planta productora. Apto para auditorías externas, licitaciones y contraste técnico.';
    doc.setFontSize(7);
    doc.setFont('Helvetica', 'normal');
    const descLines = doc.splitTextToSize(tx(descText), bannerInnerW);
    const bannerH = 1.5 + titleH + descLines.length * lineH + padBottom;
    y = checkBreak(doc, y, pageH, margin, bannerH + 2);
    doc.setFillColor(255, 243, 205);
    doc.setDrawColor(220, 170, 50);
    doc.rect(margin, y, pageW - 2 * margin, bannerH, 'FD');
    doc.setFontSize(8);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(133, 100, 4);
    doc.text(tx(titleText), margin + bannerInnerPad, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(descLines, margin + bannerInnerPad, y + 4 + titleH);
    y += bannerH + 2;

    // ── Sello de verificación estricta — APTA / NO APTA ──────────────────
    // Reexpresa el assessment ya consolidado por el backend (no recomputa).
    // Es informativo: no bloquea la emisión (modelo dual PR9). Su objetivo
    // es que no quede ambiguo, bajo la lupa prescriptiva, si la dosificación
    // se puede o no aprobar normativamente — el detalle por hallazgo sigue
    // en la portada multi-eje más abajo.
    // Se consume el assessment crudo: `derivarSelloEstricto` sólo lee
    // conformidadNormativa + arrays de hallazgos (invariantes al reportMode;
    // la escalación de `estadoGeneral` de aplicarReportMode no aplica acá).
    const sello = derivarSelloEstricto(resultado?.assessment);
    if (sello) {
      // Geometría del sello: la altura de la caja se deriva de los MISMOS
      // offsets que usa el cursor de render (no de una fórmula paralela), así
      // no pueden divergir y un ítem largo que wrapea a varias líneas nunca
      // desborda hacia la sección siguiente (bug detectado en test61).
      const PAD_X = 4;          // sangría del título/motivo desde el borde
      const PAD_X_ITEM = 6;     // sangría de cada ítem de incumplimiento
      const TITLE_BL = 5.5;     // baseline del título
      const MOTIVO_TOP = 9.5;   // baseline de la 1ª línea de motivo
      const STEP = 3.4;         // alto de línea (7pt) con aire suficiente
      const ITEM_GAP = 1.5;     // separación motivo → lista
      const BOT_PAD = 3;        // padding inferior interno de la caja

      // El texto se mide con la MISMA fuente/tamaño con que se dibuja (7pt
      // normal) para que el conteo de líneas medido == el renderizado.
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      const motivoW = contentW - PAD_X * 2;
      const itemW = contentW - PAD_X_ITEM - PAD_X;
      const motivoLines = doc.splitTextToSize(tx(sello.motivo), motivoW);
      // Guion ASCII (no bullet U+2022): el prefijo debe pasar por la fuente
      // Latin-1 sin DejaVu. Mismo patrón que la portada multi-eje.
      let renderLines = sello.incumplimientos
        .map((m) => doc.splitTextToSize(`- ${tx(m)}`, itemW))
        .reduce((acc, l) => acc.concat(l), []);

      // Tope de altura: si la lista no cabe ni en una página completa,
      // truncamos y remitimos a la portada multi-eje (que los lista todos).
      const motivoEnd0 = MOTIVO_TOP + motivoLines.length * STEP;
      const maxAvailH = pageH - FOOTER_RESERVE - 18 - 4;
      const maxItemLines = Math.max(
        1, Math.floor((maxAvailH - (motivoEnd0 + ITEM_GAP + BOT_PAD)) / STEP));
      if (renderLines.length > maxItemLines) {
        const ocultos = renderLines.length - (maxItemLines - 1);
        renderLines = renderLines.slice(0, maxItemLines - 1);
        renderLines.push(tx(`  (... y ${ocultos} línea(s) más — ver detalle completo en la portada de evaluación, sección A)`));
      }

      // Altura EXACTA = recorrido del cursor de render + padding inferior.
      const motivoEnd = MOTIVO_TOP + motivoLines.length * STEP;
      const itemsTop = renderLines.length ? motivoEnd + ITEM_GAP : motivoEnd;
      const contentEnd = itemsTop + renderLines.length * STEP;
      const selloH = contentEnd + BOT_PAD;

      y = checkBreak(doc, y, pageH, margin, selloH + 2);
      const fg = sello.apta ? [21, 128, 61] : [192, 57, 43];
      const bg = sello.apta ? [220, 252, 231] : [254, 226, 226];
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.setDrawColor(fg[0], fg[1], fg[2]);
      doc.setLineWidth(0.6);
      doc.roundedRect(margin, y, contentW, selloH, 2, 2, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(fg[0], fg[1], fg[2]);
      doc.text(tx(sello.titulo), margin + PAD_X, y + TITLE_BL);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(70, 70, 70);
      let sy = y + MOTIVO_TOP;
      for (const l of motivoLines) { doc.text(l, margin + PAD_X, sy); sy += STEP; }
      if (renderLines.length) {
        sy += ITEM_GAP;
        doc.setTextColor(fg[0], fg[1], fg[2]);
        for (const line of renderLines) { doc.text(line, margin + PAD_X_ITEM, sy); sy += STEP; }
      }
      y += selloH + 3;
      doc.setTextColor(...C.text);
    }
  } else {
    // Banner DESCRIPTIVO (decisión 2026-05-28): leyenda discreta que
    // explicita que el documento no emite valoración normativa. Mismo
    // patrón de wrap + altura dinámica que el banner NORMATIVO arriba.
    const bannerInnerPad = 3;
    const bannerInnerW = (pageW - 2 * margin) - 2 * bannerInnerPad;
    const titleH = 3.5;
    const lineH = 3.4;
    const padBottom = 1.5;
    const titleText = 'INFORME DESCRIPTIVO DE DOSIFICACIÓN';
    const descText = 'Documento descriptivo. Lista los parámetros calculados de la dosificación con la referencia CIRSOC al lado, sin emitir valoración normativa. Para verificación contra CIRSOC 200:2024 + IRAM (auditoría, licitación) generar el documento en modo Normativo.';
    doc.setFontSize(7);
    doc.setFont('Helvetica', 'normal');
    const descLines = doc.splitTextToSize(tx(descText), bannerInnerW);
    const bannerH = 1.5 + titleH + descLines.length * lineH + padBottom;
    y = checkBreak(doc, y, pageH, margin, bannerH + 2);
    doc.setFillColor(232, 244, 250);
    doc.setDrawColor(180, 210, 230);
    doc.rect(margin, y, pageW - 2 * margin, bannerH, 'FD');
    doc.setFontSize(7.5);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(60, 90, 120);
    doc.text(tx(titleText), margin + bannerInnerPad, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(descLines, margin + bannerInnerPad, y + 4 + titleH);
    y += bannerH + 2;
  }
  doc.setTextColor(...C.text);

  // ══════════════════════════════════════════════════════════════════════════════
  // K.4 — Banner de override CIRSOC §3.2.3.2 f)
  // ══════════════════════════════════════════════════════════════════════════════
  const overrideActivo = snapshot?.overrideActivo || null;
  if (overrideActivo) {
    const bannerH = 16;
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(217, 119, 6);
    doc.setLineWidth(0.4);
    doc.rect(margin, y, pageW - margin * 2, bannerH, 'FD');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14);
    doc.text(tx('Liberación bajo CIRSOC 200:2024 §3.2.3.2 f)'), margin + 3, y + 4.5);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(40, 40, 40);
    const ambitoLabel = overrideActivo.ambito === 'OBRA'
      ? 'Ámbito: obra · firma de Director Técnico matriculado'
      : 'Ámbito: autocontrol de planta · firma de Responsable de Calidad';
    doc.text(tx(ambitoLabel), margin + 3, y + 8.5);
    const firmanteTxt = `Firma: ${overrideActivo.resueltoPor || 'sin datos'}`
      + (overrideActivo.matriculaResolutor ? ` (Mat. ${overrideActivo.matriculaResolutor})` : '')
      + (overrideActivo.fechaResolucion ? ` · ${new Date(overrideActivo.fechaResolucion).toLocaleDateString('es-AR')}` : '');
    doc.text(tx(firmanteTxt), margin + 3, y + 12.5);
    y += bannerH + 3;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // FICHA RÁPIDA — compact KPI strip (always included)
  // ══════════════════════════════════════════════════════════════════════════════
  {
    const fichaY = y;
    // 5 KPI boxes in a row
    const kpiGap = 3;
    const kpiCount = 5;
    const kpiW = (contentW - kpiGap * (kpiCount - 1)) / kpiCount;
    const kpiH = 18;

    const consistLabel = snapshot?.consistenciaClaseNombre || snapshot?.consistenciaClase || null;
    const consistVal = snapshot?.consistenciaValor != null
      ? `${formatNumber(snapshot.consistenciaValor, 0)} ${snapshot?.consistenciaRange?.unit || "mm"}`
      : (consistLabel || "-");

    // HRDC: f'c es OPCIONAL (relleno) y la a/c es consecuencia informativa.
    // Etiquetar acorde para no dar la impresión de que f'c "falló".
    const _fcEstHRDC = resultado?.resistenciaEstimada?.resistenciaMpa;
    // Alivianado: KPIs principales son densidad fresca, cemento (input),
    // agua, dosis de perlas y banda orientativa. f'c NO es la autoridad
    // (orientativo por banda densidad×CUC).
    const _bandaAli = resultado?.resistenciaEsperadaBanda;
    const kpis = esAlivianado
      ? [
          { label: "Densidad fresca", value: resultado.densidadFrescaKgM3 != null ? `${formatNumber(resultado.densidadFrescaKgM3, 0)} kg/m³` : "-", color: C.primary },
          { label: "Cemento", value: resultado.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³` : "-", color: C.secondary },
          { label: "Agua", value: resultado.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m³` : "-", color: [30, 144, 255] },
          { label: "Dosis perlas", value: resultado.dosisPerlasLM3 != null ? `${formatNumber(resultado.dosisPerlasLM3, 0)} L/m³` : "-", color: C.green },
          { label: "f'c esperado (orient.)", value: _bandaAli ? `${formatNumber(_bandaAli.rMinMpa, 1)}–${formatNumber(_bandaAli.rMaxMpa, 1)} MPa` : (snapshot?.fce != null ? `${formatNumber(snapshot.fce, 0)} MPa (declarado)` : "No aplica"), color: C.blue },
        ]
      : esHRDC
      ? [
          { label: `f'c est. ${resultado?.resistenciaEstimada?.edadDias || 28} d`, value: _fcEstHRDC != null ? `${formatNumber(_fcEstHRDC, 1)} MPa` : (snapshot?.fce != null ? `${formatNumber(snapshot.fce, 0)} MPa` : "No aplica"), color: C.primary },
          { label: "a/c (inform.)", value: resultado.ac != null ? formatNumber(resultado.ac, 2) : "-", color: C.blue },
          { label: "Agua", value: resultado.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m³` : "-", color: [30, 144, 255] },
          { label: "Cemento", value: resultado.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³` : "-", color: C.secondary },
          { label: "Aire incorp.", value: resultado.airePct != null ? `${formatNumber(resultado.airePct, 1, true)} %` : "-", color: C.green },
        ]
      : [
          { label: "f'c", value: snapshot?.fce != null ? `${formatNumber(snapshot.fce, 0)} MPa` : "-", color: C.primary },
          { label: "a/c", value: resultado.ac != null ? formatNumber(resultado.ac, 2) : "-", color: C.blue },
          { label: "Agua", value: resultado.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m³` : "-", color: [30, 144, 255] },
          { label: "Cemento", value: resultado.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³` : "-", color: C.secondary },
          { label: "Aire", value: resultado.airePct != null ? `${formatNumber(resultado.airePct, 1, true)} %` : "-", color: C.green },
        ];

    kpis.forEach((kpi, i) => {
      const bx = margin + i * (kpiW + kpiGap);
      // Box background
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(bx, fichaY, kpiW, kpiH, 1.5, 1.5, "F");
      // Left color accent bar
      doc.setFillColor(...kpi.color);
      doc.rect(bx, fichaY + 2, 1.5, kpiH - 4, "F");
      // Label
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...C.muted);
      doc.text(kpi.label, bx + 5, fichaY + 6);
      // Value
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...kpi.color);
      doc.text(tx(kpi.value), bx + 5, fichaY + 14);
    });

    y = fichaY + kpiH + 2;

    // Second row: consistency, cement, exposure, aggregates summary
    const detailY = y;
    const detColW = contentW / 2;
    doc.setFontSize(7);

    // Left column details
    const leftDetails = [];
    if (consistLabel) {
      leftDetails.push(`Consistencia: ${tx(consistLabel)}${snapshot?.consistenciaValor != null ? ` (${consistVal})` : ""}`);
    }
    const cementoName = snapshot?.cementoLabel || snapshot?.cementoFamilia || null;
    if (cementoName) {
      leftDetails.push(`Cemento: ${tx(cementoName)}${snapshot?.cementoFamilia && snapshot?.cementoLabel ? ` (${tx(snapshot.cementoFamilia)})` : ""}`);
    }
    if (exposicionShort && exposicionShort !== "Sin exposición") {
      leftDetails.push(`Exposición: ${tx(exposicionShort)}`);
    }

    // Right column details
    const rightDetails = [];
    const aggNames = (resultado.agregados || []).map(a => a.nombre).filter(Boolean);
    if (aggNames.length > 0) {
      rightDetails.push(`Agregados: ${tx(aggNames.join(", "))}`);
    }
    if (snapAditivos.length > 0) {
      const aditNames = snapAditivos.map(a => a.label || a.nombre).filter(Boolean);
      rightDetails.push(`Aditivos: ${tx(aditNames.join(", "))}`);
    }
    if (mezclaNombre) {
      rightDetails.push(`Mezcla: ${tx(mezclaCodigo ? `${mezclaNombre} (${mezclaCodigo})` : mezclaNombre)}`);
    }

    // HRDC/Alivianado: la portada solo muestra los KPI y NO el detalle de
    // abajo (esa info ya vive en las secciones del cuerpo). En HRDC la
    // línea de Aditivos además se truncaba con "...".
    if (esHRDC || esAlivianado) { leftDetails.length = 0; rightDetails.length = 0; }

    // Ambas columnas: wrap completo, sin truncado con elipsis. Cada fila se
    // expande verticalmente todo lo que necesite. Fix: antes la columna
    // izquierda escribía sin splitTextToSize y la "Exposición" larga
    // (EXPOSICION_LABELS_MED) desbordaba sobre "Aditivos:" de la derecha; la
    // columna derecha cortaba a 2 líneas con "..." perdiendo agregados/aditivos.
    if (leftDetails.length + rightDetails.length > 0) {
      const detRowH = 4;
      const MAX_DETAIL_LINES = 6; // tope defensivo por columna
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(...C.secondary);
      let leftRowsUsed = 0;
      leftDetails.forEach((line) => {
        const wrapped = doc.splitTextToSize(line, detColW - 4);
        const linesToShow = wrapped.slice(0, MAX_DETAIL_LINES);
        linesToShow.forEach((wl, k) => {
          doc.text(wl, margin + 2, detailY + (leftRowsUsed + k) * detRowH + 3.5);
        });
        leftRowsUsed += linesToShow.length;
      });
      let rightRowsUsed = 0;
      rightDetails.forEach((line) => {
        const wrapped = doc.splitTextToSize(line, detColW - 4);
        const linesToShow = wrapped.slice(0, MAX_DETAIL_LINES);
        linesToShow.forEach((wl, k) => {
          doc.text(wl, margin + detColW + 2, detailY + (rightRowsUsed + k) * detRowH + 3.5);
        });
        rightRowsUsed += linesToShow.length;
      });
      const maxDetailRows = Math.max(leftRowsUsed, rightRowsUsed);
      y = detailY + maxDetailRows * detRowH + 4;
    }

    // Thin separator
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 3;
  }

  // Hoisted: variables/helpers derivados que se usan en múltiples secciones
  // y no deben caer dentro del scope de `if (showSection(...))` (eslint no-undef).
  const acGob  = resumenDec.acGobernante;
  const cemGob = resumenDec.cementoGobernante;
  const aditivoShortName = (label) => {
    if (!label) return "-";
    const dashIdx = label.indexOf(" - ");
    return dashIdx > 0 ? label.substring(0, dashIdx).trim() : label;
  };
  // absorcionAlerts se puebla dentro de dosificacionFinal; si esa sección se
  // oculta queda vacío y advertencias no reporta nada — comportamiento OK.
  const absorcionAlerts = [];
  // trab se consume también en bloques fuera de la sección de trabajabilidad
  const trab = resultado?.trabajabilidad || traz?.trabajabilidad;

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION A — Resumen ejecutivo
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('resumenEjecutivo')) {
  y = sectionHeader(doc, dynTitle('Resumen ejecutivo'), margin, y, contentW);

  // Five metric boxes
  const boxGap = 3;
  const boxW = (contentW - boxGap * 4) / 5;
  // ROUND-X Priority 6: Single source of truth for "volumen de pasta".
  // Prefer the sum of real volume components from balanceVolumenes (vAgua + vCemento +
  // vAire + vAdiciones + vAditivos) instead of resultado.volumenPasta, which was pre-rounded
  // at the engine and caused 285 vs 286 discrepancies. Round ONLY at the final display step.
  let volPasta = null;
  if (balanceVol && balanceVol.vAgua != null && balanceVol.vCemento != null && balanceVol.vAire != null) {
    const sum = Number(balanceVol.vAgua) + Number(balanceVol.vCemento) + Number(balanceVol.vAire)
      + Number(balanceVol.vAdiciones || 0) + Number(balanceVol.vAditivos || 0);
    volPasta = Math.round(sum);
  } else {
    const volPastaRaw = resultado.volumenPasta;
    volPasta = volPastaRaw ? Math.round((volPastaRaw < 10 ? volPastaRaw * 1000 : volPastaRaw) + 1e-9) : null;
  }
  const boxDefs = esAlivianado ? [
    // Alivianado: KPIs principales son cemento (input directo), agua,
    // densidad fresca calculada, dosis de perlas y banda orientativa de
    // resistencia. f'c NO es la autoridad \u2014 el ensayo de probeta es el
    // que manda. La a/c queda como dato informativo en secciones.
    { label: "Cemento", value: resultado.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m\u00b3` : "-" },
    { label: "Agua", value: resultado.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m\u00b3` : "-" },
    { label: "Densidad fresca", value: resultado.densidadFrescaKgM3 != null ? `${formatNumber(resultado.densidadFrescaKgM3, 0)} kg/m\u00b3` : "-" },
    { label: "Dosis perlas", value: resultado.dosisPerlasLM3 != null ? `${formatNumber(resultado.dosisPerlasLM3, 0)} L/m\u00b3` : "-" },
    {
      label: "f'c esperado (orient.)",
      value: resultado.resistenciaEsperadaBanda
        ? `${formatNumber(resultado.resistenciaEsperadaBanda.rMinMpa, 1)}\u2013${formatNumber(resultado.resistenciaEsperadaBanda.rMaxMpa, 1)} MPa`
        : "-",
    },
  ] : esHRDC ? [
    // HRDC: KPIs relevantes son cemento (input), agua, aire (espum\u00edgeno),
    // densidad fresca y resistencia estimada. La a/c y vol. pasta son dato
    // secundario en hormig\u00f3n celular.
    { label: "Cemento", value: resultado.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m\u00b3` : "-" },
    { label: "Agua", value: resultado.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m\u00b3` : "-" },
    { label: "Aire incorporado", value: resultado.airePct != null ? `${formatNumber(resultado.airePct, 1, true)} %` : "-" },
    { label: "Densidad fresca", value: resultado.densidadFrescaCalc != null ? `${formatNumber(resultado.densidadFrescaCalc, 0)} kg/m\u00b3` : "-" },
    {
      label: `f'c est. ${resultado.resistenciaEstimada?.edadDias || 28} d`,
      value: resultado.resistenciaEstimada?.resistenciaMpa != null
        ? `${formatNumber(resultado.resistenciaEstimada.resistenciaMpa, 1)} MPa`
        : "-",
    },
  ] : [
    { label: "Agua", value: resultado.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m\u00b3` : "-" },
    { label: "a/c adoptada", value: resultado.ac != null ? formatNumber(resultado.ac, 2, true) : "-" },
    { label: "Cemento", value: resultado.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m\u00b3` : "-" },
    { label: "Aire total", value: resultado.airePct != null ? `${formatNumber(resultado.airePct, 1, true)} %` : "-" },
    { label: "Vol. pasta", value: volPasta != null ? `${volPasta} L/m\u00b3` : "-" },
  ];
  boxDefs.forEach((box, i) => {
    const bx = margin + i * (boxW + boxGap);
    doc.setFillColor(...C.light);
    doc.roundedRect(bx, y, boxW, 22, 2, 2, "F");
    doc.setDrawColor(...C.primary);
    doc.setLineWidth(0.4);
    doc.roundedRect(bx, y, boxW, 22, 2, 2, "S");
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...C.secondary);
    doc.text(box.label, bx + boxW / 2, y + 6, { align: "center" });
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...C.primary);
    doc.text(tx(box.value), bx + boxW / 2, y + 15, { align: "center" });
  });
  y += 25;

  // ── Disclaimer HRDC (no normativo) — reubicado desde el encabezado ──
  // El encabezado ahora solo dice "Motor HormiQual — RDC/HRDC". Acá, en el
  // cuerpo y bien visible, queda la atribución metodológica y el disclaimer
  // legal: el RDC/HRDC está FUERA de CIRSOC 200. Quitar esto del encabezado
  // sin dejarlo acá haría que el informe parezca cumplimiento normativo
  // (riesgo legal). No se reproduce texto de las fuentes (solo cita).
  if (esHRDC) {
    // El disclaimer wrappea a 4+ líneas con DejaVu en anchos chicos
    // (~24.5 mm). Reservar holgado para que no desborde sobre el footer.
    y = checkBreak(doc, y, pageH, margin, 32);
    y = callout(
      doc,
      "HRDC — Hormigón de Resistencia y Densidad Controlada (hormigón celular): modelo de "
      + "ingeniería NO NORMATIVO, fuera del alcance de CIRSOC 200. Motor de cálculo: HormiQual. "
      + "Las verificaciones de aptitud, durabilidad y granulometría de CIRSOC 200 no "
      + "aplican a esta tipología; el aire es intencionalmente incorporado por espumígeno.",
      margin, y, contentW, C.amberBg, C.amber
    );
  }
  if (esAlivianado) {
    y = checkBreak(doc, y, pageH, margin, 36);
    const livianoNombre = traz?.materialLiviano?.nombre || resultado?.nombreMaterialLiviano || "agregado liviano";
    y = callout(
      doc,
      "Hormigón alivianado con " + livianoNombre + ": modelo de ingeniería no normativo, fuera del "
      + "alcance de CIRSOC 200. Motor de cálculo: HormiQual. El objetivo no es resistencia mecánica "
      + "sino aislación térmica / aligeramiento. f'c es informativo (banda orientativa por densidad "
      + "y CUC, sin calibración con datos propios de la planta) — el ensayo de probeta es el que manda. "
      + "Las verificaciones de aptitud, durabilidad y granulometría de CIRSOC 200 no aplican a esta tipología.",
      margin, y, contentW, C.amberBg, C.amber
    );
  }

  // ── Resumen del diseño — modelo multi-eje (filosofía prestacional) ──
  // El veredicto monolítico APTO/NO_APTO vive ahora como `resultado.assessment`
  // en múltiples ejes (estadoGeneral / conformidad / viabilidad / validación /
  // liberación), calculado por el backend con aptitud real, cloruros globales,
  // mezcla base y señales Shilstone/FdA.

  // Construcción de la evaluación multi-eje.
  // Fuente única: `resultado.assessment` del backend. El service layer lo
  // enriquece con aptitud real, cloruros globales y estado de mezcla base
  // en `dosificacionDisenoService.calcular()`. Si el usuario eligió un modo
  // de reporte distinto del cacheado (típicamente NORMATIVO_ESTRICTO contra
  // un cache PRESTACIONAL), `aplicarReportMode` hace la diferencia mínima
  // sin re-ejecutar el motor heurístico.
  // El modo lo fija la elección explícita del diálogo de exportar
  // (`modoEvaluacion` → `_modoNorm`). Si el usuario eligió NORMATIVO, la
  // portada multi-eje debe alinearse con el sello de verificación estricta
  // (que siempre evalúa en NORMATIVO_ESTRICTO) para no mostrar dos veredictos
  // contradictorios en el mismo PDF. `snapshot.reportMode` se mantiene como
  // fallback para snapshots cacheados que ya traían el modo resuelto.
  const reportMode = (_modoNorm === 'NORMATIVO')
    ? 'NORMATIVO_ESTRICTO'
    : 'PRESTACIONAL';
  const assessment = aplicarReportMode(resultado?.assessment, reportMode);

  // ── Render de la portada multi-dimensional ─────────────────────────────
  // 1) Banda de estado general (header)
  // 2) Tabla de 4 ejes restantes (conformidad / viabilidad / validación / liberación)
  // 3) Listas de hallazgos por severidad
  // 4) Fortalezas (si existen)
  // 5) Bloque de sostenibilidad (placeholder estructural)
  // 6) Banner blando solo si estadoGeneral === BLOQUEADO
  //
  // Guard: si `resultado.assessment` no vino (diseño persistido antes de que
  // el backend produjera este campo), no renderizamos la portada multi-eje
  // para no fabricar datos desde el frontend. El resto del PDF (verificaciones,
  // aptitud, trabajabilidad, etc.) sigue generándose normal y el usuario puede
  // recalcular la dosificación para reconstruir el resumen ejecutivo.
  //
  // Decisión 2026-05-28: la portada multi-eje emite veredictos por ejes
  // (estadoGeneral / conformidadNormativa / viabilidadTecnica / etc.) que
  // son juicios formales sobre la dosificación. En modo DESCRIPTIVO el
  // documento no juzga → se omite la portada entera. El "Resumen ejecutivo"
  // de la sección A sigue presentándose (es descriptivo del diseño, no
  // emite veredicto).
  if (assessment && _modoNorm === 'NORMATIVO') {
    const egGeneralColor = AXIS_COLOR[assessment.estadoGeneral] || AXIS_COLOR.EN_EVALUACION;
    const egGeneralLabel = ESTADO_GENERAL_LABEL[assessment.estadoGeneral] || assessment.estadoGeneral;

    // (1) Header bar con el estado general
    const headerH = 9;
    doc.setFillColor(egGeneralColor[0], egGeneralColor[1], egGeneralColor[2]);
    doc.roundedRect(margin, y, contentW, headerH, 2, 2, 'F');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text(tx(`Estado general del diseño: ${egGeneralLabel.toUpperCase()}`), margin + 4, y + 6);
    // Etiqueta de modo de reporte (esquina derecha)
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(6.5);
    // Texto del modo en la esquina derecha de la portada (decisión 2026-05-28).
    // Solo aplica en modo NORMATIVO porque la portada solo se renderiza ahí.
    const modoLabel = 'Modo: verificación normativa';
    doc.text(tx(modoLabel), margin + contentW - 4, y + 6, { align: 'right' });
    y += headerH + 1;

    // (2) Tabla de 4 ejes — dos columnas, dos filas
    // Refinamiento del label de conformidad: si el estado es CONFORME pero
    // existen observaciones complementarias (ensayos no concluyentes, curva
    // fallback, etc.), se refleja como "Conforme con observaciones" para no
    // exagerar el cumplimiento. No cambia el estado interno del assessment,
    // solo el texto de display.
    const _confObservaciones = (assessment.observaciones?.length > 0)
      || (snapshot?.aptitudMateriales?.verificaciones || []).some(v =>
        (v.items || []).some(it => it.estado === 'no_concluyente' || it.estado === 'sin_dato')
      );
    const _confLabel = (assessment.conformidadNormativa === 'CONFORME' && _confObservaciones)
      ? 'Conforme con observaciones complementarias'
      : CONF_NORM_LABEL[assessment.conformidadNormativa];

    const ejes = [
      { label: 'Conformidad normativa',     value: _confLabel,                                          color: AXIS_COLOR[assessment.conformidadNormativa] },
      { label: 'Viabilidad técnica estimada', value: VIAB_LABEL[assessment.viabilidadTecnica],           color: AXIS_COLOR[assessment.viabilidadTecnica] },
      { label: 'Necesidad de validación',   value: NECESIDAD_VAL_LABEL[assessment.necesidadValidacion], color: AXIS_COLOR[assessment.necesidadValidacion] },
      { label: 'Condición de liberación',   value: LIBERACION_LABEL[assessment.liberacion],             color: AXIS_COLOR[assessment.liberacion] },
    ];
    const ejeColW = (contentW - 2) / 2;
    const ejeRowH = 8;
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    for (let i = 0; i < ejes.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ex = margin + 1 + col * ejeColW;
      const ey = y + row * ejeRowH;
      doc.setFillColor(248, 248, 250);
      doc.rect(ex, ey, ejeColW - 1, ejeRowH, 'F');
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(110, 110, 110);
      doc.text(tx(ejes[i].label), ex + 2, ey + 3);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      const c = ejes[i].color || [60, 60, 60];
      doc.setTextColor(c[0], c[1], c[2]);
      const valueWrapped = doc.splitTextToSize(tx(ejes[i].value), ejeColW - 4);
      doc.text(valueWrapped[0] || '', ex + 2, ey + 6.5);
    }
    y += ejeRowH * 2 + 2;
    doc.setTextColor(...C.text);

    // (3) Hallazgos clasificados por severidad
    // Cada bloque solo se renderiza si tiene contenido. La lista es exhaustiva:
    // todo lo detectado se sigue mostrando, solo cambia su agrupación visual.
    const hallazgosBlocks = [
      { titulo: 'Bloqueantes',                   items: assessment.bloqueantes,    color: [192, 57, 43],   bg: [254, 226, 226] },
      { titulo: 'Riesgos técnicos',              items: assessment.riesgos,        color: [200, 100, 10],  bg: [255, 237, 213] },
      { titulo: 'Desvíos respecto del criterio normativo', items: assessment.desvios,        color: [180, 120, 20],  bg: [254, 243, 199] },
      { titulo: 'Condicionantes de liberación',  items: assessment.condicionantes, color: [120, 100, 180], bg: [237, 233, 254] },
      { titulo: 'Observaciones',                 items: assessment.observaciones,  color: [80, 100, 140],  bg: [241, 245, 249] },
    ];
    const hallazgosInnerW = contentW - 14;
    for (const blk of hallazgosBlocks) {
      if (!blk.items.length) continue;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      const wrappedItems = blk.items.map(m => doc.splitTextToSize(`- ${tx(m)}`, hallazgosInnerW));
      const totalLines = wrappedItems.reduce((a, lines) => a + lines.length, 0);
      const blkH = 5 + totalLines * 3 + 2;
      doc.setFillColor(blk.bg[0], blk.bg[1], blk.bg[2]);
      doc.setDrawColor(blk.color[0], blk.color[1], blk.color[2]);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentW, blkH, 1.5, 1.5, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(blk.color[0], blk.color[1], blk.color[2]);
      doc.text(tx(blk.titulo), margin + 4, y + 4);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(70, 70, 70);
      let hy = y + 7.5;
      for (const lines of wrappedItems) {
        for (const line of lines) {
          doc.text(line, margin + 6, hy);
          hy += 3;
        }
      }
      y += blkH + 2;
    }

    // (4) Fortalezas — verde y discreto
    if (assessment.fortalezas.length) {
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      const fwrap = assessment.fortalezas.map(m => doc.splitTextToSize(`+ ${tx(m)}`, hallazgosInnerW));
      const fLines = fwrap.reduce((a, l) => a + l.length, 0);
      const fH = 5 + fLines * 3 + 2;
      doc.setFillColor(220, 252, 231);
      doc.setDrawColor(21, 128, 61);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin, y, contentW, fH, 1.5, 1.5, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(21, 128, 61);
      doc.text(tx('Fortalezas del diseño'), margin + 4, y + 4);
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

    // (5) Sostenibilidad — bloque preparado para futura integración.
    // Se imprime como recordatorio estructural; nunca inventa datos.
    {
      const susInnerW = contentW - 14;
      const susLines = doc.splitTextToSize(tx(assessment.sostenibilidad.nota), susInnerW);
      const susH = 5 + susLines.length * 3 + 2;
      doc.setFillColor(245, 247, 248);
      doc.setDrawColor(190, 195, 200);
      doc.setLineWidth(0.25);
      doc.roundedRect(margin, y, contentW, susH, 1.5, 1.5, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(90, 100, 110);
      doc.text(tx('Sostenibilidad / logística / costo'), margin + 4, y + 4);
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

    // (6) Banner blando — solo si el estado general es realmente terminal.
    // Lenguaje no-categórico: el banner explica la condición, no la sentencia.
    if (assessment.estadoGeneral === 'BLOQUEADO') {
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      const bannerText = 'Diseño con bloqueante real detectado: requiere resolución de las causas listadas antes de cualquier liberación. Las observaciones, desvíos y condicionantes detallados arriba siguen reflejando la trazabilidad completa de los datos.';
      const bannerLines = doc.splitTextToSize(tx(bannerText), contentW - 12);
      const bannerH = 6 + bannerLines.length * 3.2 + 2;
      doc.setFillColor(220, 38, 38);
      doc.setDrawColor(180, 20, 20);
      doc.setLineWidth(0.6);
      doc.roundedRect(margin, y, contentW, bannerH, 2, 2, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(tx('Bloqueante a resolver'), margin + 4, y + 5);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      let by = y + 9;
      for (const l of bannerLines) {
        doc.text(l, margin + 4, by);
        by += 3.2;
      }
      y += bannerH + 3;
      doc.setTextColor(...C.text);
    } else if (assessment.estadoGeneral === 'REQUIERE_AJUSTE') {
      // Aviso naranja, sin lenguaje terminal — el material puede ser viable.
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      const bannerText = 'Diseño con riesgos técnicos relevantes: se recomienda revisar las causas antes de avanzar. La viabilidad puede gestionarse con ajustes de proporciones, sustituciones parciales o validación experimental reforzada.';
      const bannerLines = doc.splitTextToSize(tx(bannerText), contentW - 12);
      const bannerH = 6 + bannerLines.length * 3.2 + 2;
      doc.setFillColor(254, 215, 170);
      doc.setDrawColor(200, 100, 10);
      doc.setLineWidth(0.5);
      doc.roundedRect(margin, y, contentW, bannerH, 2, 2, 'FD');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(150, 70, 0);
      doc.text(tx('Atención técnica'), margin + 4, y + 5);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(120, 60, 0);
      let by = y + 9;
      for (const l of bannerLines) {
        doc.text(l, margin + 4, by);
        by += 3.2;
      }
      y += bannerH + 3;
      doc.setTextColor(...C.text);
    }
  }

  // Governing restriction callouts (acGob/cemGob declarados arriba, hoisted)
  if (resumenDec.acGobernanteTexto) {
    let bg, fg;
    if (acGob === "RESISTENCIA")      { bg = C.greenBg; fg = C.green; }
    else if (acGob === "EXPOSICION")  { bg = C.amberBg; fg = C.amber; }
    else                              { bg = C.blueBg;  fg = C.blue;  }
    const gobLabel = AC_GOBERNANTE_LABELS[acGob] || acGob || "";
    y = callout(doc,
      `Restricción gobernante a/c \u2014 ${gobLabel}: ${tx(resumenDec.acGobernanteTexto)}`,
      margin, y, contentW, bg, fg);
  }
  if (cemGob && cemGob !== "CALCULO" && resumenDec.cementoGobernanteTexto) {
    y = callout(doc,
      `Cemento mínimo aplicado \u2014 ${CEMENTO_GOB_LABELS[cemGob] || cemGob}: ${tx(resumenDec.cementoGobernanteTexto)}`,
      margin, y, contentW, C.amberBg, C.amber);
  }
  y += 2;

  // Tipología info (from engine result, trazabilidad, or snapshot)
  const tipologiaInfo = snapshot?.tipologia || traz?._tipologia || null;
  const tipologiaLabel = tipologiaInfo
    ? tx(fmtTipologiaLabel(tipologiaInfo.nombre || tipologiaInfo.codigo || ''))
    : (snapshot?.tipologiaCodigo ? tx(fmtTipologiaLabel(snapshot.tipologiaCodigo)) : null);

  // Quick-reference summary row
  const summaryRows = [
    ["Cemento seleccionado",
      tx([snapshot?.cementoLabel, snapshot?.cementoFamilia ? `(${snapshot.cementoFamilia})` : null].filter(Boolean).join(" ") || "-")],
    ["Mezcla granular",     tx(mezclaNombre ? (mezclaCodigo ? `${mezclaNombre} (${mezclaCodigo})` : mezclaNombre) : "-")],
    ...(tipologiaLabel ? [["Tipología de hormigón", tipologiaLabel]] : []),
    ["Clase de exposición", tx(exposicionShort)],
    ["f'ce especificada",   snapshot?.fce != null ? `${formatNumber(snapshot.fce, 1)} MPa` : "-"],
    ["f'cm requerido",      snapshot?.fcm != null ? `${formatNumber(snapshot.fcm, 1)} MPa` : "-"],
  ];

  doc.autoTable({
    startY: y,
    body: summaryRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 2.2, overflow: "linebreak", textColor: C.text },
    columnStyles: {
      0: { cellWidth: 52, fontStyle: "bold", textColor: C.secondary },
      1: { cellWidth: "auto" },
    },
    theme: "plain",
    alternateRowStyles: { fillColor: C.light },
  });
  y = doc.lastAutoTable.finalY + 4;
  } // end showSection('resumenEjecutivo')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION A.bis — Ajuste manual de cemento (sesión 2026-06-11)
  // Solo se renderiza si el resultado tiene `ajusteCemento.aplicado === true`.
  // Documenta la decisión del tecnólogo de adoptar un valor distinto al
  // calculado por el motor, con toda la trazabilidad (delta, motivo, nuevo a/c,
  // cierre volumétrico) — clave para auditoría y revisión externa.
  // ══════════════════════════════════════════════════════════════════════════════
  const ajusteCem = resultado?.ajusteCemento;
  if (ajusteCem && ajusteCem.aplicado === true) {
    y = checkBreak(doc, y, pageH, margin, 75);
    y = sectionHeader(doc, dynTitle('Ajuste manual de cemento'), margin, y, contentW);

    // Bandera contextual: si Δ ≥ 3% el motor emitió warning. Lo replicamos en
    // el PDF como callout amber para que el lector externo lo vea sin ir al
    // historial de eventos. Si es < 3% mostramos un callout green (informativo).
    const deltaPctAbs = Math.abs(Number(ajusteCem.deltaPct) || 0);
    if (deltaPctAbs >= 3) {
      const msg = `Ajuste de ${ajusteCem.deltaPct >= 0 ? '+' : ''}${formatNumber(ajusteCem.deltaPct, 1)}% sobre el valor calculado. Verifique consistencia con el a/c efectivo y la dosis de aditivos por kg de cemento.`;
      y = callout(doc, msg, margin, y, contentW, C.amberBg, C.amber);
    } else if (deltaPctAbs > 0) {
      const msg = `Ajuste menor: ${ajusteCem.deltaPct >= 0 ? '+' : ''}${formatNumber(ajusteCem.deltaPct, 2)}% sobre el valor calculado. Dentro del rango operativo (< 3%) — no requiere modificación de aditivos.`;
      y = callout(doc, msg, margin, y, contentW, C.greenBg, C.green);
    }

    // Tabla 1: datos núcleos del ajuste.
    const motivoTexto = ajusteCem.motivo === 'OTRO'
      ? `Otro: ${ajusteCem.motivoOtro || '(sin detalle)'}`
      : (ajusteCem.motivoLabel || ajusteCem.motivo);
    const fechaTxt = (() => {
      try {
        const d = new Date(ajusteCem.fecha);
        if (Number.isNaN(d.getTime())) return ajusteCem.fecha || '—';
        return d.toLocaleString('es-AR');
      } catch { return ajusteCem.fecha || '—'; }
    })();

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [],
      body: [
        ['Cemento calculado por el motor', `${formatNumber(ajusteCem.cementoCalculadoKgM3, 1)} kg/m³`],
        ['Cemento adoptado',                `${formatNumber(ajusteCem.cementoAdoptadoKgM3, 1)} kg/m³`],
        ['Diferencia',                      `${ajusteCem.deltaKg >= 0 ? '+' : ''}${formatNumber(ajusteCem.deltaKg, 1)} kg/m³  (${ajusteCem.deltaPct >= 0 ? '+' : ''}${formatNumber(ajusteCem.deltaPct, 2)}%)`],
        ['Motivo', tx(motivoTexto)],
        ...(ajusteCem.usuario ? [['Aplicado por', tx(ajusteCem.usuario)]] : []),
        ['Fecha del ajuste', tx(fechaTxt)],
      ],
      styles: { fontSize: 8.5, cellPadding: 2, textColor: C.text },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 55, textColor: C.secondary },
        1: { cellWidth: 'auto' },
      },
      theme: 'plain',
    });
    y = doc.lastAutoTable.finalY + 4;

    // Tabla 2: trazabilidad del cierre volumétrico y la relación a/c efectiva.
    // El re-balance volumétrico es la consecuencia técnica del ajuste; documentarlo
    // explícitamente evita que un revisor externo dude del cierre del m³.
    const filasTraz = [];
    if (ajusteCem.acOriginal != null && ajusteCem.acEfectivo != null) {
      const deltaAc = Number(ajusteCem.acEfectivo) - Number(ajusteCem.acOriginal);
      filasTraz.push([
        'Relación a/c',
        `${formatNumber(ajusteCem.acOriginal, 3)}`,
        `${formatNumber(ajusteCem.acEfectivo, 3)}`,
        `${deltaAc >= 0 ? '+' : ''}${formatNumber(deltaAc, 3)}`,
      ]);
    }
    if (ajusteCem.volAgregadosOriginalM3 != null && ajusteCem.volAgregadosAjustadoM3 != null) {
      const deltaVol = Number(ajusteCem.volAgregadosAjustadoM3) - Number(ajusteCem.volAgregadosOriginalM3);
      filasTraz.push([
        'Volumen total de agregados',
        `${formatNumber(ajusteCem.volAgregadosOriginalM3 * 1000, 1)} L/m³`,
        `${formatNumber(ajusteCem.volAgregadosAjustadoM3 * 1000, 1)} L/m³`,
        `${deltaVol >= 0 ? '+' : ''}${formatNumber(deltaVol * 1000, 1)} L/m³`,
      ]);
    }

    if (filasTraz.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 30);
      y = subHeader(doc, 'Trazabilidad del re-balance volumétrico', margin, y);
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Magnitud', 'Antes del ajuste', 'Después del ajuste', 'Variación']],
        body: filasTraz,
        styles: { fontSize: 8.5, cellPadding: 2, textColor: C.text },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 8 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 55, textColor: C.secondary },
          1: { halign: 'right', cellWidth: 38 },
          2: { halign: 'right', cellWidth: 38 },
          3: { halign: 'right', cellWidth: 'auto' },
        },
        theme: 'grid',
      });
      y = doc.lastAutoTable.finalY + 3;
    }

    // Nota explicativa al pie de la sección.
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    const nota = 'Los agregados se redistribuyeron manteniendo las proporciones originales de la mezcla. El agua y los aditivos NO se modificaron automáticamente; cualquier cambio adicional sobre estos componentes queda a criterio del tecnólogo y deberá registrarse por separado.';
    const notaLines = doc.splitTextToSize(tx(nota), contentW);
    // Justificado: párrafo sin líneas vacías ni renglones de una palabra,
    // por lo que el cálculo de word-spacing de jsPDF es seguro (no produce
    // Tw=Infinity como sí lo hacía en el Aviso legal). maxWidth replica el
    // ancho usado en splitTextToSize.
    doc.text(notaLines, margin, y + 2, { align: 'justify', maxWidth: contentW });
    y += notaLines.length * 3.5 + 4;
    doc.setTextColor(...C.text);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION B — Parámetros de diseño / Parámetros adoptados
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('parametros')) {
  y = checkBreak(doc, y, pageH, margin, 55);
  const sectionBTitle = (estadoPdf === "APROBADO" || estadoPdf === "EN_PRODUCCION")
    ? dynTitle("Parámetros adoptados") : dynTitle("Parámetros de diseño");
  y = sectionHeader(doc, sectionBTitle, margin, y, contentW);

  const betaInfo = traz?.factorEdad;
  const leftParams = [
    ["f'ce",                snapshot?.fce  != null ? `${formatNumber(snapshot.fce, 1)} MPa`  : "-"],
    ["Desv\u00edo est\u00e1ndar S",  snapshot?.desvioS != null ? `${formatNumber(snapshot.desvioS, 1)} MPa${snapshot?.origenS === 'H' ? ' [Historial de planta]' : snapshot?.origenS === 'N' ? ' [Valor normativo]' : ' [Estimado por el usuario]'}` : "-"],
    ["f'cm requerido",      snapshot?.fcm  != null ? `${formatNumber(snapshot.fcm, 1)} MPa`  : "-"],
    ["Edad de diseño",         `${inpEdad} días${betaInfo ? ` (\u03b2 = ${betaInfo.beta})` : ''}`],
    ...(betaInfo ? [["f'cm(28d equiv.)", `${formatNumber(betaInfo.fcm28Equiv, 1)} MPa`]] : []),
    ...(snapshot?.consistenciaClase
      ? [
          ["Consistencia",        `${snapshot.consistenciaClaseNombre || snapshot.consistenciaClase} (${snapshot.consistenciaMetodo || "-"})`],
          ["Valor nominal",       snapshot.consistenciaValor != null ? `${formatNumber(snapshot.consistenciaValor, 1)} ${snapshot.consistenciaRange?.unit || ""}` : "-"],
          ...(snapshot.consistenciaRange ? [["Tolerancia", `± ${formatNumber(snapshot.consistenciaRange.tol, 1)} ${snapshot.consistenciaRange.unit}`]] : []),
        ]
      : [["Asentamiento obj.", snapshot?.asentamientoMm != null ? `${formatNumber(snapshot.asentamientoMm, 0)} mm` : "-"]]),
  ];
  // Add verified values from valoresAdoptados for APROBADO
  const va = snapshot?.valoresAdoptados;
  if (va?.parametros && (estadoPdf === "APROBADO" || estadoPdf === "EN_PRODUCCION" || estadoPdf === "A_PRUEBA")) {
    const asentReal = va.parametros.asentamiento_real;
    if (asentReal?.medido != null) {
      const okMark = asentReal.dentro_tolerancia ? " ✓" : " ⚠";
      const pastonLabel = va.fuente ? ` (${va.fuente.replace("_", " #")})` : "";
      leftParams.push(["Valor verificado", `${formatNumber(asentReal.medido, 1)} cm${okMark}${pastonLabel}`]);
    }
  }
  // HRDC: si la mezcla no declara agregado grueso, la "forma" no aplica.
  const _hrdcSinAG = esHRDC && (() => {
    const items = traz?.mezclaBase?.items || snapshot?.mezcla?.items || [];
    return items.length > 0 && !items.some(it => it.esGrueso || it.tipo === 'AG');
  })();
  const rightParams = [
    ["TMN",               inpTmn != null ? `${formatNumber(inpTmn, 1)} mm  ${tmnSrc}` : "-"],
    ["MF mezcla total",   inpMf != null ? `${formatNumber(inpMf, 2)}  ${mfSrc}` : "-"],
    ["Forma del agregado",
      _hrdcSinAG
        ? tx("No aplica (mezcla 100% arena)")
        : (inpForma ? `${FORMA_LABELS[inpForma] || tx(inpForma)}  ${tx(formaSrc)}` : "-")
    ],
    // HRDC: el aire es celular (espumígeno) → una sola fila "incorporado".
    // Sin este guard, como el service mapea aireAtrapado:0 (0 != null), la
    // rama INTENCIONAL mostraba "Aire atrapado 0,00 %" (falso split) y
    // contradecía la Sección F y el Anexo.
    ...(esHRDC
      // Label corto: "Aire incorporado (espumígeno)" desbordaba sobre el
      // valor en la grilla de 2 columnas (ancho de col. izq. fijo). El
      // detalle "espumígeno" ya está en el disclaimer y la tabla de aditivos.
      ? [["Aire incorporado",
          (resultado?.airePct ?? resultado?.aireIncorporadoPct) != null
            ? `${formatNumber(resultado.airePct ?? resultado.aireIncorporadoPct, 1, true)} %`
            : "-"]]
      : tipoAire === "INTENCIONAL"
      ? [
          ["Aire atrapado", resultado?.aireAtrapado != null ? `${formatNumber(resultado.aireAtrapado, 1, true)} %` : "-"],
          ["Aire incorporado", resultado?.aireIncorporado != null ? `${formatNumber(resultado.aireIncorporado, 1, true)} %` : "-"],
          ["Aire total", resultado?.airePct != null ? `${formatNumber(resultado.airePct, 1, true)} %` : "-"],
        ]
      // P2: Show the computed total air (includes colateral from additives), not the raw input.
      : [["Aire total", resultado?.airePct != null ? `${formatNumber(resultado.airePct, 1, true)} %` : (inpAire != null ? `${formatNumber(inpAire, 1, true)} %` : "Auto (tabla)")]]),
    ["Clase de exposición", tx(exposicionShort)],
  ];
  // Add verified air and PUV from valoresAdoptados
  if (va?.parametros && (estadoPdf === "APROBADO" || estadoPdf === "EN_PRODUCCION" || estadoPdf === "A_PRUEBA")) {
    if (va.parametros.aire_real?.medido != null) {
      rightParams.push(["Aire verificado", `${formatNumber(va.parametros.aire_real.medido, 1)} % (${va.fuente?.replace("_", " #") || "pastón"})`]);
    }
    if (va.parametros.puv_real?.medido != null) {
      rightParams.push(["PUV verificado", `${formatNumber(va.parametros.puv_real.medido, 0)} kg/m³ (${va.fuente?.replace("_", " #") || "pastón"})`]);
    }
  }
  y = twoColParams(doc, leftParams, rightParams, margin, y, contentW);

  // Verification ages table (when β factor is active)
  const edadesVerif = traz?.edadesVerificacion;
  if (edadesVerif?.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 30);
    y += 2;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.secondary);
    doc.text("Resistencias esperadas por edad", margin, y);
    y += 4;
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [edadesVerif.map(ev => `${ev.edadDias}d`)],
      body: [
        edadesVerif.map(ev => `${formatNumber(ev.resistenciaEsperada, 1)} MPa`),
        edadesVerif.map(ev => `\u03b2=${ev.factor}`),
      ],
      styles: { fontSize: 7, cellPadding: 2, halign: "center" },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
      theme: "grid",
    });
    y = doc.lastAutoTable.finalY + 4;
  }
  } // end showSection('parametros')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION C — Materiales seleccionados
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('materiales')) {
  y = checkBreak(doc, y, pageH, margin, 50);
  y = sectionHeader(doc, dynTitle('Materiales seleccionados'), margin, y, contentW);

  // Build materials key-value rows for aligned two-column table
  const matRows = [];
  const cementoDesc = tx([snapshot?.cementoLabel, snapshot?.cementoFamilia ? `(${snapshot.cementoFamilia})` : null].filter(Boolean).join(" ") || "-");
  matRows.push(["Cemento", cementoDesc]);
  if (traz?.curvaCementoUsada) {
    const ORIGEN_CURVA_LABELS = {
      REFERENCIA_GENERAL: "Curva genérica de referencia",
      ICPA:       "Curva genérica de referencia", // back-compat: snapshots viejos con origen 'ICPA'
      FABRICANTE: "Curva del fabricante",
      PROPIA:     "Curva propia del usuario",
    };
    const origenLabel = ORIGEN_CURVA_LABELS[traz.curvaCementoUsada.origenCurva] || null;
    const factor = traz?.relacionAC?.factorAjusteAplicado;
    const factorTxt = (factor && Number(factor) !== 1)
      ? ` · factor ajuste ${formatNumber(factor, 3)}`
      : "";
    const detalle = [
      traz.curvaCementoUsada.nombre,
      origenLabel,
    ].filter(Boolean).join(" — ") + factorTxt;
    matRows.push(["Curva del cemento", tx(detalle || "Curva cargada")]);
  }
  if (mezclaNombre) {
    const mezclaLabel = mezclaCodigo ? `${mezclaNombre} (${mezclaCodigo})` : mezclaNombre;
    matRows.push(["Mezcla granular", tx(mezclaLabel)]);
  }
  if (snapAdiciones.length > 0) {
    snapAdiciones.forEach((item, idx) => {
      const pct = item.reemplazoPct != null ? ` \u2014 ${formatNumber(item.reemplazoPct, 1)}% de reemplazo` : "";
      matRows.push([tx(`Adición ${idx + 1}`), tx(`${item.label || "-"}${pct}`)]);
    });
  } else {
    matRows.push(["Adiciones", "Sin adiciones minerales"]);
  }
  if (resultado?.fibras?.macrofibra?.dosisKgM3) {
    const f = resultado.fibras.macrofibra;
    const densTxt = f.densidad ? ` \u2014 densidad ${formatNumber(f.densidad, 0)} kg/m³` : "";
    matRows.push(["Macrofibra", tx(`${f.nombre || "-"} \u2014 ${formatNumber(f.dosisKgM3, 3)} kg/m³${densTxt}`)]);
  }
  if (resultado?.fibras?.microfibra?.dosisKgM3) {
    const f = resultado.fibras.microfibra;
    const densTxt = f.densidad ? ` \u2014 densidad ${formatNumber(f.densidad, 0)} kg/m³` : "";
    matRows.push(["Microfibra", tx(`${f.nombre || "-"} \u2014 ${formatNumber(f.dosisKgM3, 3)} kg/m³${densTxt}`)]);
  }

  doc.autoTable({
    startY: y,
    body: matRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, overflow: "linebreak", textColor: C.text },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: "bold", textColor: C.secondary },
      1: { cellWidth: "auto" },
    },
    theme: "plain",
  });
  y = doc.lastAutoTable.finalY + 3;

  // aditivoShortName hoisted al function scope arriba
  // Track which aditivos have been mentioned (for first-mention / short-name logic)
  const aditivoFirstMention = new Set();

  // Aditivos table (FIRST mention — shows full name)
  if (snapAditivos.length > 0) {
    snapAditivos.forEach((item) => { if (item.label) aditivoFirstMention.add(item.label); });
    y += 1;
    const aditivosBody = snapAditivos.map((item, idx) => {
      const trazItem = trazAditivos[idx] || {};
      const corr = correccionAditivo.find((c) => c.aditivo === `Aditivo ${idx + 1}`);
      // Fallback a la unidad del propio aditivo cuando la trazabilidad no la
      // trae (caso HRDC: traz.aditivos viene vacio -> quedaba el numero solo
      // sin unidad, p.ej. "0,31"). El motor HRDC ya expone unidadLabel y kgM3.
      const unidadLbl = trazItem.unidadLabel || UNIDAD_DOSIS_LABELS[trazItem.unidad]
        || trazItem.unidad || item.unidadLabel || UNIDAD_DOSIS_LABELS[item.unidad]
        || item.unidad
        // Último recurso en HRDC: la dosis es SIEMPRE % sobre cemento (motor
        // hrdcCalcEngine). Sin esto la celda quedaba con número pelado y el
        // header "Dosis (% y kg/m³)" no aclara cuál es por fila.
        || (esHRDC ? "% sobre cemento" : "");
      // Dosis en unidad original + equivalente en kg/m³ entre paréntesis (fuente única de verdad)
      const dosisOriginal = item.dosis != null ? `${formatNumber(item.dosis, 2)} ${unidadLbl}`.trim() : "\u2014";
      const _kgM3Val = trazItem.kgM3 != null ? trazItem.kgM3
        : (item.kgM3 != null ? item.kgM3 : null);
      const kgM3Str = _kgM3Val != null ? formatNumber(_kgM3Val, 3) : null;
      const dosisStr = kgM3Str != null
        ? `${dosisOriginal}\n(${kgM3Str} kg/m³)`
        : dosisOriginal;
      const efectoLabel = MODO_EFECTO_LABELS[item.modoEfecto] || tx(item.modoEfecto) || "\u2014";
      const isInformativo = item.modoEfecto && !EFECTOS_CON_CALCULO.has(item.modoEfecto);
      // Contexto: etapa + si es corrección (no entra en volumen)
      const etapa = item.etapa || 'PLANTA';
      const etapaTxt = etapa === 'OBRA' ? ' [Obra]' : '';
      const corrTxt = item.esCorreccion ? ' [Corrección]' : '';
      let impacto = "Sin impacto registrado";
      if (item.esCorreccion) {
        impacto = tx("Dosis de corrección - no incluida en el balance volumétrico");
      } else if (isInformativo) {
        impacto = "Informativo - sin incidencia en cálculo de agua";
      } else if (corr) {
        if (corr.modo === "AHORRO_AGUA" && corr.aguaAntes != null && corr.aguaDespues != null) {
          const factorPct = corr.factorDosis != null ? Math.round(corr.factorDosis * 100) : 100;
          const factorNote = factorPct !== 100
            ? ` (decl. ${formatNumber(corr.reduccionDeclarada || corr.reduccionPct, 1)}% x ${factorPct}%)`
            : "";
          impacto = tx(`${formatNumber(corr.aguaAntes, 1)} -> ${formatNumber(corr.aguaDespues, 1)} L/m³ (-${formatNumber(corr.reduccionPct, 1)}%${factorNote})`);
        } else if (corr.modo === "AHORRO_AGUA" && corr.nota) {
          impacto = tx(corr.nota);
        } else if (corr.modo === "AUMENTO_ASENTAMIENTO") {
          const inc = corr.incrementoAsentamientoMm != null ? `+${corr.incrementoAsentamientoMm} mm` : "";
          impacto = tx(`Efecto reológico${inc ? `: ${inc} asentamiento estimado` : " \u2014 mejora de trabajabilidad"}. Agua sin modificar.`);
        } else if (corr.nota) {
          impacto = tx(corr.nota);
        }
      }
      // Nombre corto en la tabla: el nombre comercial largo (ej. "Dynamon
      // XTend W247 R") forzaba la fila a 3 líneas y desalineaba la columna
      // "Efecto aplicado". El nombre completo queda en el Anexo Técnico.
      const nombreCelda = (aditivoShortName(item.label) || item.label || `Aditivo ${idx + 1}`);
      return [
        tx(`${nombreCelda}${etapaTxt}${corrTxt}`),
        dosisStr,
        efectoLabel,
        tx(impacto),
      ];
    });

    doc.autoTable({
      startY: y,
      head: [["Aditivo", tx("Dosis (% y kg/m³)"), "Efecto aplicado", tx("Impacto en diseño")]],
      body: aditivosBody,
      margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
      styles: { fontSize: 7.5, cellPadding: 2, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: C.secondary, textColor: C.white, fontSize: 7.5 },
      alternateRowStyles: { fillColor: C.light },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { cellWidth: 32, halign: "center" },
        2: { cellWidth: 32 },
        3: { cellWidth: "auto" },
      },
      rowPageBreak: "avoid",
    });
    y = doc.lastAutoTable.finalY + 4;

    // Note about automatic selection (if applicable)
    if (snapshot?.aditivosAutoSeleccionados || traz?.aditivosRecomendados) {
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(120, 120, 120);
      // B4 (audit DeepSeek): faltaba tx() → "hormigón"/"selección" se
      // renderizaban con fallback Latin-1 roto (À-tilde) en jsPDF WinAnsi.
      doc.text(tx('Aditivos seleccionados por el motor HormiQual en base a: tipo de hormigón, asentamiento objetivo, tiempo de transporte y temperatura.'), margin + 2, y);
      y += 3;
      doc.text(tx('El usuario puede modificar la selección y las dosis en cualquier momento.'), margin + 2, y);
      y += 4;
      doc.setTextColor(...C.text);
    }

    // Detail blocks for informational effects (description + normative ref)
    snapAditivos.forEach((item, idx) => {
      if (!item.modoEfecto || EFECTOS_CON_CALCULO.has(item.modoEfecto)) return;
      const shortName = aditivoShortName(item.label) || `Aditivo ${idx + 1}`;
      const desc = MODO_EFECTO_DESCRIPCION[item.modoEfecto];
      const refNorm = MODO_EFECTO_REF_NORMATIVA[item.modoEfecto];
      if (!desc && !refNorm) return;
      y = checkBreak(doc, y, pageH, margin, 18);
      doc.setFontSize(7.5);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(...C.secondary);
      doc.text(tx(`${shortName} (${MODO_EFECTO_LABELS[item.modoEfecto] || item.modoEfecto}):`), margin + 2, y);
      y += 3.5;
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(...C.text);
      if (desc) {
        const descLines = doc.splitTextToSize(tx(desc), contentW - 8);
        doc.text(descLines, margin + 4, y);
        y += descLines.length * 3.5;
      }
      if (refNorm) {
        doc.setFont("Helvetica", "italic");
        doc.setTextColor(...C.muted);
        doc.text(tx(`Ref.: ${refNorm}`), margin + 4, y);
        y += 3.5;
      }
      y += 1;
    });

  } else {
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(tx("Sin aditivos químicos."), margin + 2, y);
    doc.setTextColor(...C.text);
    y += 6;
  }

  // ── MEJ-5: Granulometry source traceability table ──
  const agregadosConGrano = (resultado?.agregados || []).filter(ag => ag.granulometriaFecha || ag.granulometriaEnsayoId);
  if (agregadosConGrano.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 30);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...C.secondary);
    doc.text(tx("Fuentes granulométricas de los agregados"), margin + 2, y);
    y += 4;
    doc.setFont("Helvetica", "normal");
    doc.setTextColor(...C.text);

    const granoRows = agregadosConGrano.map(ag => [
      tx(ag.nombre || '-'),
      ag.granulometriaFecha || '-',
      ag.granulometriaCodigo || 'IRAM 1505',
      ag.granulometriaEnsayoId ? `#${ag.granulometriaEnsayoId}` : '-',
      ag.pasante300um != null ? `${formatNumber(ag.pasante300um, 1)}%` : '-',
      ag.pasante75um != null ? `${formatNumber(ag.pasante75um, 1)}%` : '-',
    ]);
    doc.autoTable({
      startY: y,
      head: [['Agregado', 'Fecha ensayo', 'Norma', 'ID ensayo', 'Pas. 300 um', 'Pas. 75 um']],
      body: granoRows,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.5, textColor: C.text },
      headStyles: { fillColor: C.headerBg || C.secondary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      margin: { left: margin, right: margin },
      columnStyles: { 0: { cellWidth: 50 }, 3: { halign: 'center' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 5;
  }
  } // end showSection('materiales')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION D — Criterios aplicados: relación a/c
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('criteriosAC')) {
  y = checkBreak(doc, y, pageH, margin, 75);
  y = sectionHeader(doc, dynTitle(tx('Criterios aplicados \u2014 Relación agua/cemento (a/c)')), margin, y, contentW);

  // Factor prudencial ELIMINADO — la desviación estándar S cubre el margen estadístico.

  // a/c decision chain — compute three-state logic:
  //   GOBERNANTE: the restriction that sets the final adopted value
  //   APLICADA:   reduced a/c below a prior restriction, but wasn't the most restrictive
  //   INFORMATIVA: had no effect (superseded by a more restrictive value already)
  const acCandidates = [];
  if (relacionAC.acEstimado != null)
    acCandidates.push({ key: "RESISTENCIA", value: Number(relacionAC.acEstimado) });
  if (durabilidad?.acMax != null)
    acCandidates.push({ key: "EXPOSICION", value: Number(durabilidad.acMax) });
  if (pliego?.acMaxPliego != null)
    acCandidates.push({ key: "PLIEGO", value: Number(pliego.acMaxPliego) });

  // Determine state for each restriction based on value chain
  const acStateMap = {};
  {
    let runningMin = Infinity;
    // Sort by restrictiveness (lowest a/c = most restrictive) to find governing
    const sorted = [...acCandidates].sort((a, b) => a.value - b.value);
    const governingKey = acGob || (sorted.length > 0 ? sorted[0].key : null);

    for (const c of acCandidates) {
      if (c.key === governingKey) {
        acStateMap[c.key] = "GOBERNANTE";
      } else if (c.value < runningMin) {
        // This restriction reduced the a/c below what was known before it
        acStateMap[c.key] = "APLICADA";
      } else {
        acStateMap[c.key] = "INFORMATIVA";
      }
      runningMin = Math.min(runningMin, c.value);
    }
  }

  const AC_STATE_LABELS = {
    GOBERNANTE: "GOBIERNA",
    APLICADA: "Aplicada (redujo a/c)",
    INFORMATIVA: "Informativa",
  };
  const AC_STATE_COLORS = {
    GOBERNANTE: { fill: C.amberBg, text: C.amber },
    APLICADA:   { fill: [254, 243, 199], text: [120, 80, 10] },
    INFORMATIVA: null,
  };

  const acRows = [];

  // a/c por resistencia — MEJ-9: show the f'cm chain when there are corrections
  if (relacionAC.acEstimado != null) {
    const fcmReq = relacionAC.fcmObjetivo ?? snapshot?.fcm;
    const fcmCurva = relacionAC.fcmParaCurva;
    const factor = relacionAC.factorAjusteAplicado;
    const hasFactor = factor && factor !== 1;
    // fcmConFactorAjuste = value AFTER applying familia/cemento factor (the one actually used for curve lookup)
    // fcmParaCurvaCorregido = value after ICPA shape/air corrections but BEFORE the factor
    const fcmAjustado = relacionAC.fcmConFactorAjuste ?? relacionAC.fcmParaCurvaCorregido;
    const state = acStateMap["RESISTENCIA"] || "INFORMATIVA";

    let label;
    if (hasFactor && fcmReq != null && fcmAjustado != null) {
      // Two-step: f'cm requerido → f'cm corregido / factor → a/c
      label = `a/c por resistencia: f'cm ${formatNumber(fcmReq, 1)} MPa / ${formatNumber(factor, 2)} = ${formatNumber(fcmAjustado, 1)} MPa en curva`;
    } else if (fcmCurva != null) {
      label = `a/c por resistencia (curva cemento, f'cm = ${formatNumber(fcmCurva, 1)} MPa)`;
    } else {
      label = `a/c por resistencia`;
    }
    acRows.push([
      tx(label),
      formatNumber(relacionAC.acEstimado, 2),
      AC_STATE_LABELS[state],
    ]);
  }

  // a/c por durabilidad
  if (durabilidad?.acMax != null) {
    const expoRef = durabilidad.codigo
      ? tx(`Máx. por exposición ${durabilidad.codigo} (CIRSOC 200:2024 Tabla 2.5)`)
      : tx("Máximo por durabilidad");
    const state = acStateMap["EXPOSICION"] || "INFORMATIVA";
    acRows.push([
      expoRef,
      formatNumber(durabilidad.acMax, 2),
      AC_STATE_LABELS[state],
    ]);
  }

  // a/c por pliego
  if (pliego?.acMaxPliego != null) {
    const modoStr = pliego.acModo === "FIJO" ? "valor fijo" : tx("límite máximo");
    const state = acStateMap["PLIEGO"] || "INFORMATIVA";
    acRows.push([
      tx(`Por pliego / cliente (${modoStr})`),
      formatNumber(pliego.acMaxPliego, 2),
      AC_STATE_LABELS[state],
    ]);
  }

  // Final row
  acRows.push([
    "a/c FINAL ADOPTADA",
    resultado.ac != null ? formatNumber(resultado.ac, 2) : "-",
    acGob ? tx(AC_GOBERNANTE_LABELS[acGob] || acGob) : "\u2014",
  ]);

  const acGobIdx   = acRows.findIndex((r) => r[2] === "GOBIERNA");
  const acAppliedIdxs = acRows.reduce((acc, r, i) => { if (r[2] === "Aplicada (redujo a/c)") acc.push(i); return acc; }, []);
  const acFinalIdx = acRows.length - 1;

  // Decisión 2026-05-28: en modo DESCRIPTIVO la tabla muestra las
  // restricciones y sus valores sin emitir la columna "Estado" (que
  // contiene GOBIERNA / Aplicada / Informativa — veredictos sobre cuál
  // criterio "manda"). El lector ve los valores y compara contra la
  // a/c adoptada final que se reporta en la última fila.
  if (_modoNorm === 'NORMATIVO') {
    doc.autoTable({
      startY: y,
      head: [["Restricción / Criterio", "Valor", "Estado"]],
      body: acRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8 },
      alternateRowStyles: { fillColor: C.light },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { cellWidth: 28, halign: "center" },
        2: { cellWidth: 58 },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.row.index === acGobIdx) {
          data.cell.styles.fillColor   = C.amberBg;
          data.cell.styles.textColor   = C.amber;
          data.cell.styles.fontStyle   = "bold";
        }
        if (acAppliedIdxs.includes(data.row.index)) {
          data.cell.styles.fillColor   = [254, 243, 199];
          data.cell.styles.textColor   = [120, 80, 10];
        }
        if (data.row.index === acFinalIdx) {
          data.cell.styles.fillColor   = [235, 241, 248];
          data.cell.styles.fontStyle   = "bold";
          data.cell.styles.textColor   = C.primary;
        }
      },
    });
  } else {
    // DESCRIPTIVO: solo 2 columnas (Restricción + Valor). Sin coloreado
    // por estado, sin tags. La a/c FINAL ADOPTADA conserva el highlight
    // azul porque es información del diseño, no veredicto.
    const acRowsDesc = acRows.map(r => [r[0], r[1]]);
    doc.autoTable({
      startY: y,
      head: [["Restricción / Criterio", "Valor"]],
      body: acRowsDesc,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8 },
      alternateRowStyles: { fillColor: C.light },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { cellWidth: 32, halign: "center" },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.row.index === acFinalIdx) {
          data.cell.styles.fillColor   = [235, 241, 248];
          data.cell.styles.fontStyle   = "bold";
          data.cell.styles.textColor   = C.primary;
        }
      },
    });
  }
  y = doc.lastAutoTable.finalY + 5;

  // TEC-02: Note about resistance excess when a/c adopted < a/c by resistance
  if (relacionAC.acEstimado != null && resultado.ac != null &&
      Number(resultado.ac) < Number(relacionAC.acEstimado) - 0.005) {
    const acRes = Number(relacionAC.acEstimado);
    const acAdopted = Number(resultado.ac);
    const fcmReq = relacionAC.fcmParaCurva ?? snapshot?.fcm;
    // Rough estimate using Abrams' law: f'c ∝ 1/a/c (linear approximation for nearby points)
    // More precisely: if a/c goes from acRes to acAdopted, resistance increases by ratio acRes/acAdopted
    const ratio = acRes / acAdopted;
    const fcmEst = fcmReq != null ? Number(fcmReq) * ratio : null;
    const exceso = fcmReq != null && fcmEst != null ? ((fcmEst / Number(fcmReq) - 1) * 100) : null;
    let noteText = tx(`Nota: La a/c adoptada (${formatNumber(acAdopted, 2)}) es menor que la requerida por resistencia (${formatNumber(acRes, 2)}).`);
    if (fcmEst != null && exceso != null) {
      noteText += tx(` Resistencia esperada estimada: ~${formatNumber(fcmEst, 1)} MPa — exceso sobre f'cm: +${formatNumber(exceso, 0)}%.`);
    }
    y = checkBreak(doc, y, pageH, margin, 14);
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.blue);
    const noteLines = doc.splitTextToSize(noteText, contentW - 4);
    doc.text(noteLines, margin + 2, y);
    doc.setTextColor(...C.text);
    doc.setFont("Helvetica", "normal");
    y += noteLines.length * 3.5 + 3;
  }
  } // end showSection('criteriosAC')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION E — Criterios aplicados: material cementante
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('criteriosCemento')) {
  y = checkBreak(doc, y, pageH, margin, 60);
  y = sectionHeader(doc, dynTitle(tx('Criterios aplicados — Material cementante')), margin, y, contentW);

  const cemRows = [];

  if (cementoCalculado.cementoTotal != null) {
    cemRows.push([
      tx(`Por cálculo: agua / a/c = ${formatNumber(resultado.aguaLtsM3, 1)} / ${formatNumber(resultado.ac, 2)}`),
      tx(`${formatNumber(cementoCalculado.cementoTotal, 0)} kg/m³`),
      cemGob === "CALCULO" ? "GOBIERNA" : "\u2014",
    ]);
  }

  if (durabilidad?.fcmin != null) {
    cemRows.push([
      tx(`f'c mínimo requerido por exposición ${durabilidad.codigo || ""} (CIRSOC 200:2024)`),
      `${formatNumber(durabilidad.fcmin, 0)} MPa`,
      "Informativo",
    ]);
  }

  if (pliego?.cementoMinPliego != null) {
    cemRows.push([
      tx("Mínimo por pliego / cliente"),
      tx(`${formatNumber(pliego.cementoMinPliego, 0)} kg/m³`),
      cemGob === "PLIEGO" ? "GOBIERNA" : "Informativo",
    ]);
  }

  if (pliego?.cementoMinFromAmc != null) {
    const amcStr = pliego.amcMaxPliego != null ? ` (<= ${formatNumber(pliego.amcMaxPliego, 3)})` : "";
    cemRows.push([
      tx(`Mínimo por a/mc máximo de pliego${amcStr}`),
      tx(`${formatNumber(pliego.cementoMinFromAmc, 0)} kg/m³`),
      cemGob === "AMC_PLIEGO" ? "GOBIERNA" : "Informativo",
    ]);
  }

  cemRows.push([
    "CEMENTO TOTAL ADOPTADO",
    resultado.cementoTotalKgM3 != null ? tx(`${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³`) : "-",
    cemGob ? tx(CEMENTO_GOB_LABELS[cemGob] || cemGob) : "\u2014",
  ]);

  const cemGobIdx   = cemRows.findIndex((r) => r[2] === "GOBIERNA");
  const cemFinalIdx = cemRows.length - 1;

  // Decisión 2026-05-28: idem sección D — en DESCRIPTIVO omitimos la
  // columna "Estado" (GOBIERNA / Informativo) y mostramos solo Criterio
  // + Valor. La fila final "CEMENTO TOTAL ADOPTADO" conserva highlight.
  if (_modoNorm === 'NORMATIVO') {
    doc.autoTable({
      startY: y,
      head: [["Criterio", "Valor", "Estado"]],
      body: cemRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8 },
      alternateRowStyles: { fillColor: C.light },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { cellWidth: 34, halign: "center" },
        2: { cellWidth: 50 },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.row.index === cemGobIdx) {
          data.cell.styles.fillColor = C.amberBg;
          data.cell.styles.textColor = C.amber;
          data.cell.styles.fontStyle = "bold";
        }
        if (data.row.index === cemFinalIdx) {
          data.cell.styles.fillColor = [235, 241, 248];
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = C.primary;
        }
      },
    });
  } else {
    const cemRowsDesc = cemRows.map(r => [r[0], r[1]]);
    doc.autoTable({
      startY: y,
      head: [["Criterio", "Valor"]],
      body: cemRowsDesc,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
      headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8 },
      alternateRowStyles: { fillColor: C.light },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { cellWidth: 40, halign: "center" },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.row.index === cemFinalIdx) {
          data.cell.styles.fillColor = [235, 241, 248];
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = C.primary;
        }
      },
    });
  }
  y = doc.lastAutoTable.finalY + 5;
  } // end showSection('criteriosCemento')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION F — Dosificación final por m³
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('dosificacionFinal')) {
  y = checkBreak(doc, y, pageH, margin, 80);
  const sectionFTitle = (estadoPdf === "APROBADO" || estadoPdf === "EN_PRODUCCION")
    ? dynTitle("Dosificación definitiva por m³ de hormigón")
    : dynTitle("Dosificación final por m³ de hormigón");
  y = sectionHeader(doc, tx(sectionFTitle), margin, y, contentW);

  const dosifRows  = [];
  const boldIdxs   = [];

  // Agua
  dosifRows.push([tx("Agua de amasado"), tx(`${formatNumber(resultado.aguaLtsM3, 1)} L/m\u00b3`), ""]);
  boldIdxs.push(dosifRows.length - 1);

  // a/c
  dosifRows.push([tx("Relación a/c"), resultado.ac != null ? formatNumber(resultado.ac, 2) : "-", ""]);
  boldIdxs.push(dosifRows.length - 1);

  // a/mc si corresponde
  if (resultado.amc != null) {
    dosifRows.push([tx("Relación a/mc"), formatNumber(resultado.amc, 3), "(agua / total cementante)"]);
  }

  // Cemento Portland (only shown separately when adiciones present)
  if (snapAdiciones.length > 0 && resultado.cementoKgM3 != null) {
    dosifRows.push([
      tx(`Cemento ${snapshot?.cementoLabel ? `(${snapshot.cementoLabel})` : "Portland"}`),
      tx(`${formatNumber(resultado.cementoKgM3, 0)} kg/m³`),
      "",
    ]);
  }

  // Adiciones
  snapAdiciones.forEach((item, idx) => {
    const kgM3 = idx === 0 ? resultado.adicion1KgM3 : resultado.adicion2KgM3;
    const obs = item.reemplazoPct != null ? `${formatNumber(item.reemplazoPct, 1)}% de reemplazo` : "";
    dosifRows.push([tx(item.label || "-"), kgM3 != null ? tx(`${formatNumber(kgM3, 0)} kg/m³`) : "-", obs]);
  });

  // Cemento total — observación (TEC-05).
  // Bug DOS-6UCPY6-K72 (2da ronda, audit test55): si hubo ajuste MANUAL de
  // cemento, el adoptado ≠ calculado NO es un redondeo — es decisión del
  // tecnólogo. Etiquetar "Redondeado al kg entero" es factualmente falso
  // (370 ≠ round(376)) y engaña al cliente/auditor. Se distingue el caso.
  const ajCem = resultado.ajusteCemento?.aplicado === true ? resultado.ajusteCemento : null;
  const cementoObs = ajCem
    ? tx(`Ajuste manual: ${formatNumber(ajCem.cementoCalculadoKgM3, 0)} → ${formatNumber(ajCem.cementoAdoptadoKgM3, 0)} kg/m³ (${ajCem.motivoLabel || ajCem.motivo || 'decisión del tecnólogo'})`)
    : (cementoCalculado.cementoTotal != null && resultado.cementoTotalKgM3 != null
        && Math.abs(cementoCalculado.cementoTotal - resultado.cementoTotalKgM3) > 0.1
        ? "Redondeado al kg entero"
        : "");
  dosifRows.push([
    snapAdiciones.length > 0 ? "Total material cementante" : tx(`Cemento ${snapshot?.cementoLabel || "Portland"}`),
    resultado.cementoTotalKgM3 != null ? tx(`${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³`) : "-",
    cementoObs,
  ]);
  boldIdxs.push(dosifRows.length - 1);

  // Aire — with classification, split values, and collateral air
  const aireColateralPct = traz?.aireColateral || 0;
  const aireColateralDet = traz?.aireColateralDetalle || [];
  const aireAtrapBase = traz?.aireAtrapado ?? resultado?.aireAtrapado ?? null;

  if (esHRDC) {
    // RDC/HRDC: el aire es aire celular del espumígeno → intencionalmente
    // incorporado. No hay split atrapado/incorporado (el total ES el
    // incorporado, por cierre de volumen). Nunca "naturalmente atrapado".
    const aireHRDC = resultado.airePct ?? resultado.aireIncorporadoPct
      ?? traz?.airePct ?? traz?.aireIncorporadoPct ?? null;
    dosifRows.push([
      tx("Aire incorporado (espumígeno)"),
      aireHRDC != null ? `${formatNumber(aireHRDC, 1, true)} %` : "-",
      tx("Intencionalmente incorporado"),
    ]);
    if (aireColateralPct > 0) {
      dosifRows.push([
        tx("Aire colateral (aditivos)"),
        `+${formatNumber(aireColateralPct, 2)} %`,
        tx(aireColateralDet.map(d => d.nombre).join(", ")),
      ]);
    }
  } else if (tipoAire === 'INTENCIONAL' && resultado.aireAtrapado != null) {
    dosifRows.push([
      tx("Aire atrapado"),
      `${formatNumber(resultado.aireAtrapado, 1, true)} %`,
      "",
    ]);
    if (aireColateralPct > 0) {
      dosifRows.push([
        tx("Aire colateral (aditivos)"),
        `+${formatNumber(aireColateralPct, 2)} %`,
        tx(aireColateralDet.map(d => d.nombre).join(", ")),
      ]);
    }
    dosifRows.push([
      tx("Aire incorporado"),
      `${formatNumber(resultado.aireIncorporado, 1, true)} %`,
      "",
    ]);
    dosifRows.push([
      tx("Aire total"),
      `${formatNumber(resultado.airePct, 1, true)} %`,
      tx("Intencionalmente incorporado"),
    ]);
  } else if (aireColateralPct > 0) {
    dosifRows.push([
      tx("Aire atrapado (TMN)"),
      aireAtrapBase != null ? `${formatNumber(aireAtrapBase, 1, true)} %` : "-",
      tx("Naturalmente atrapado"),
    ]);
    dosifRows.push([
      tx("Aire colateral (aditivos)"),
      `+${formatNumber(aireColateralPct, 2)} %`,
      tx(aireColateralDet.map(d => d.nombre).join(", ")),
    ]);
    dosifRows.push([
      tx("Aire total"),
      resultado.airePct != null ? `${formatNumber(resultado.airePct, 1, true)} %` : "-",
      tx("Atrapado + colateral"),
    ]);
  } else {
    dosifRows.push([
      tx("Aire (naturalmente atrapado)"),
      resultado.airePct != null ? `${formatNumber(resultado.airePct, 1, true)} %` : "-",
      "",
    ]);
  }

  // Aditivos (subsequent mention — use short name).
  // Fuente del kg/m³: el motor convencional lo deja en trazabilidad.aditivos;
  // el motor RDC/HRDC en resultado.aditivos (shape canónico). Resolvemos por
  // id (orden-seguro) y caemos a índice; así la Sección F muestra los
  // aditivos también en RDC (antes quedaba vacía: traz.aditivos no existe).
  const _aditFuente = ((traz?.aditivos && traz.aditivos.length) ? traz.aditivos
    : (resultado?.aditivos || []));
  const _resolveTrazAdit = (item, idx) => {
    const iid = item?.id ?? item?.idAditivo;
    if (iid != null) {
      const byId = _aditFuente.find(a => (a?.id ?? a?.idAditivo) === iid);
      if (byId) return byId;
    }
    return _aditFuente[idx] || trazAditivos[idx] || {};
  };
  snapAditivos.forEach((item, idx) => {
    const trazItem = _resolveTrazAdit(item, idx);
    if (trazItem.kgM3 != null) {
      const efectoLabel = MODO_EFECTO_LABELS[item.modoEfecto] || tx(item.modoEfecto) || "-";
      const shortLabel = aditivoShortName(item.label) || `Aditivo ${idx + 1}`;
      dosifRows.push([
        tx(shortLabel),
        tx(`${formatNumber(trazItem.kgM3, 3)} kg/m³`),
        efectoLabel,
      ]);
    }
  });

  // Fibras (después de aditivos, antes de agregados)
  if (resultado?.fibras?.macrofibra?.dosisKgM3) {
    const f = resultado.fibras.macrofibra;
    dosifRows.push([
      tx(`Macrofibra${f.nombre ? ` (${f.nombre})` : ""}`),
      tx(`${formatNumber(f.dosisKgM3, 3)} kg/m³`),
      tx(f.densidad ? `Densidad ${formatNumber(f.densidad, 0)} kg/m³` : "densidad estimada 910 kg/m³"),
    ]);
  }
  if (resultado?.fibras?.microfibra?.dosisKgM3) {
    const f = resultado.fibras.microfibra;
    dosifRows.push([
      tx(`Microfibra${f.nombre ? ` (${f.nombre})` : ""}`),
      tx(`${formatNumber(f.dosisKgM3, 3)} kg/m³`),
      tx(f.densidad ? `Densidad ${formatNumber(f.densidad, 0)} kg/m³` : "densidad estimada 910 kg/m³"),
    ]);
  }

  // Agregados (absorcionAlerts hoisted al function scope arriba)
  (resultado.agregados || []).forEach((item) => {
    if (item.kgM3 != null) {
      const absNota = item.absorcionPct != null ? tx(`Abs. ${formatParamValue('absorcion', item.absorcionPct)}% (informativo)`) : "";
      dosifRows.push([tx(item.nombre || "-"), tx(`${formatNumber(item.kgM3, 0)} kg/m³`), absNota]);
      // Absorption alert check
      if (item.absorcionPct != null) {
        const tipoUpper = (item.tipo || "").toUpperCase();
        const nombreLower = (item.nombre || "").toLowerCase();
        const isFino = tipoUpper === "FINO" || tipoUpper === "ARENA" || nombreLower.includes("fino") || nombreLower.includes("arena");
        const umbral = isFino ? ABSORCION_UMBRAL_FINO : ABSORCION_UMBRAL_GRUESO;
        if (item.absorcionPct > umbral) {
          absorcionAlerts.push(
            tx(`${item.nombre}: absorción ${formatParamValue('absorcion', item.absorcionPct)}% supera el umbral de ${formatParamValue('absorcion', umbral)}% ` +
            `(${isFino ? "finos" : "gruesos"}) \u2014 verificar con proveedor`)
          );
        }
      }
    } else {
      dosifRows.push([tx(item.nombre || "-"), "-", "Sin densidad registrada"]);
    }
  });

  doc.autoTable({
    startY: y,
    head: [["Componente", "Cantidad", tx("Observación")]],
    body: dosifRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8.5, cellPadding: 2.8, overflow: "linebreak" },
    headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8.5 },
    alternateRowStyles: { fillColor: C.light },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: 36, halign: "center" },
      2: { cellWidth: 55 },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (boldIdxs.includes(data.row.index)) {
        data.cell.styles.fontStyle  = "bold";
        data.cell.styles.textColor  = C.primary;
      }
    },
  });
  y = doc.lastAutoTable.finalY + 3;

  // ── Balance de volúmenes ──────────────────────────────────────────────────────
  if (balanceVol) {
    y = checkBreak(doc, y, pageH, margin, 42);
    y = subHeader(doc, tx(dynSub(1, "Balance de volúmenes (verificación)")), margin + 2, y);

    // El balance se presenta cerrando exactamente a 1000,0 L/m³. Los
    // componentes individuales se redondean a 1 decimal y vAgregados absorbe
    // el residuo de redondeo acumulado (típicamente ±0,2 L/m³ por la suma
    // de 5-7 valores redondeados). Sin este ajuste, la suma de las filas
    // mostradas no daba 1000 y el lector lo leía como error de cálculo.
    const _r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
    const _vAguaD = _r1(balanceVol.vAgua);
    const _vCemD  = _r1(balanceVol.vCemento);
    const _vAireD = _r1(balanceVol.vAire);
    const _vAdcD  = _r1(balanceVol.vAdiciones);
    const _vAdtD  = _r1(balanceVol.vAditivos);
    const _vFibD  = _r1(balanceVol.vFibras);
    const _sumNoAgg = _vAguaD + _vCemD + _vAireD + _vAdcD + _vAdtD + _vFibD;
    const _vAggD = _r1(1000 - _sumNoAgg);
    const _totalD = _r1(_sumNoAgg + _vAggD); // = 1000,0 por construcción
    const _fmt1 = (n) => formatNumber(n, 1, true);

    const balRows = [
      ["V agua",      tx(`${_fmt1(_vAguaD)} L/m³`)],
      ["V cemento",   tx(`${_fmt1(_vCemD)} L/m³`)],
    ];
    if (balanceVol.vAdiciones > 0) {
      balRows.push(["V adiciones", tx(`${_fmt1(_vAdcD)} L/m³`)]);
    }
    if (balanceVol.vAditivos > 0) {
      balRows.push(["V aditivos", tx(`${_fmt1(_vAdtD)} L/m³${balanceVol.aditivoDensidadEstimada ? " (*)" : ""}`)]);
    }
    if (balanceVol.vFibras > 0) {
      balRows.push(["V fibras", tx(`${_fmt1(_vFibD)} L/m³${balanceVol.fibraDensidadEstimada ? " (**)" : ""}`)]);
    }
    balRows.push(["V aire",      tx(`${_fmt1(_vAireD)} L/m³`)]);
    balRows.push(["V agregados", tx(`${_fmt1(_vAggD)} L/m³`)]);
    balRows.push(["TOTAL",       tx(`${_fmt1(_totalD)} L/m³`)]);

    doc.autoTable({
      startY: y,
      body: balRows,
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak", textColor: C.text },
      columnStyles: {
        0: { cellWidth: 52, fontStyle: "bold", textColor: C.secondary },
        1: { cellWidth: 40, halign: "center" },
      },
      theme: "plain",
      alternateRowStyles: { fillColor: C.light },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.row.index === balRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = C.primary;
          data.cell.styles.fillColor = [235, 241, 248];
        }
      },
    });
    y = doc.lastAutoTable.finalY + 3;

    if (balanceVol.aditivoDensidadEstimada || balanceVol.fibraDensidadEstimada) {
      doc.setFont("Helvetica", "italic");
      doc.setFontSize(6.5);
      doc.setTextColor(...C.muted);
      if (balanceVol.aditivoDensidadEstimada) {
        doc.text(tx("(*) Densidad de aditivos estimada. Para mayor precisión, consultar ficha técnica del fabricante."), margin + 2, y);
        y += 3;
      }
      if (balanceVol.fibraDensidadEstimada) {
        doc.text(tx("(**) Densidad de fibra no cargada en el catálogo — se usó 910 kg/m³ por defecto (sintética/PP)."), margin + 2, y);
        y += 3;
      }
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(...C.text);
      y += 4;
    }
  }

  // PUV teórico with breakdown
  if (puvTeorico) {
    const puvVal = typeof puvTeorico === "object" ? puvTeorico.valor : puvTeorico;
    if (puvVal != null) {
      y = checkBreak(doc, y, pageH, margin, 20);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.secondary);
      doc.text(tx("PUV teórico (referencia para pastón de prueba):"), margin + 2, y);
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(...C.primary);
      doc.text(tx(`${formatNumber(puvVal, 0)} kg/m³`), margin + 84, y);
      doc.setTextColor(...C.text);
      y += 5;

      // PUV breakdown note
      if (balanceVol) {
        const parts = [];
        if (resultado.aguaLtsM3 != null) parts.push(`agua ${formatNumber(resultado.aguaLtsM3, 1)}`);
        if (resultado.cementoTotalKgM3 != null) parts.push(`cemento ${formatNumber(resultado.cementoTotalKgM3, 0)}`);
        const aggTotal = (resultado.agregados || []).reduce((s, a) => s + (a.kgM3 || 0), 0);
        if (aggTotal > 0) parts.push(`agregados ${formatNumber(aggTotal, 0)}`);
        const adTotal = (trazAditivos || []).reduce((s, a) => s + (a.kgM3 || 0), 0);
        if (adTotal > 0) parts.push(`aditivos ${formatNumber(adTotal, 1)}`);
        const fibTotal = (resultado?.fibras?.macrofibra?.dosisKgM3 ? Number(resultado.fibras.macrofibra.dosisKgM3) : 0)
                      + (resultado?.fibras?.microfibra?.dosisKgM3 ? Number(resultado.fibras.microfibra.dosisKgM3) : 0);
        if (fibTotal > 0) parts.push(`fibras ${formatNumber(fibTotal, 2)}`);
        if (parts.length > 0) {
          doc.setFont("Helvetica", "italic");
          doc.setFontSize(6.5);
          doc.setTextColor(...C.muted);
          doc.text(tx(`PUV = ${parts.join(" + ")} = ${formatNumber(puvVal, 0)} kg/m\u00b3 (suma de masas en condici\u00f3n SSS por m\u00b3 de hormig\u00f3n)`), margin + 2, y);
          doc.setTextColor(...C.text);
          doc.setFont("Helvetica", "normal");
          y += 4;
        }
      }
      y += 2;
    }
  }

  // ── Diagrama de proporciones volumétricas (INFORME-02) ───────────────────────
  if (includeVolDiagram && balanceVol) {
    y = checkBreak(doc, y, pageH, margin, 92); // group labels(7) + bar(14) + legend(8) + chart(40) + labels(10) + margins
    y = subHeader(doc, tx(dynSub(2, "Composición volumétrica de 1 m³")), margin + 2, y);

    const barX = margin + 2;
    const barW = contentW - 4;
    const barH = 14;
    const total = balanceVol.totalLM3 || 1000;

    // Modelo agrupado (opción b, sesión 2026-05-29): la barra agrupa
    // visualmente "Pasta" (agua + cemento + adiciones + aire + aditivos +
    // fibras) y "Agregados" (cada ítem con su color). El grupo Agregados
    // se renderiza como un bloque continuo con sus colores internos, con
    // etiquetas-grupo arriba que muestran el total por grupo y un
    // separador vertical entre ambos.
    const volSegments = [];
    if (balanceVol.vAgua > 0)     volSegments.push({ label: "Agua",     vol: balanceVol.vAgua,     color: [59, 130, 246], grupo: 'pasta' });
    if (balanceVol.vCemento > 0)  volSegments.push({ label: "Cemento",  vol: balanceVol.vCemento,  color: [107, 114, 128], grupo: 'pasta' });
    if (balanceVol.vAdiciones > 0) volSegments.push({ label: "Adiciones", vol: balanceVol.vAdiciones, color: [156, 163, 175], grupo: 'pasta' });
    if (balanceVol.vAire > 0)     volSegments.push({ label: "Aire",     vol: balanceVol.vAire,     color: [209, 213, 219], grupo: 'pasta' });
    if (balanceVol.vAditivos > 0) volSegments.push({ label: "Aditivos", vol: balanceVol.vAditivos, color: [168, 85, 247], grupo: 'pasta' });
    if (balanceVol.vFibras > 0)   volSegments.push({ label: "Fibras",   vol: balanceVol.vFibras,   color: [234, 88, 12], grupo: 'pasta' });

    // Sesión 2026-05-29: los agregados livianos manufacturados (telgopor en
    // perlas, EPS, perlita) NO son agregados pétreos tradicionales — van en
    // su propio grupo "Liviano" separado de "Agregados" para que la
    // composición se lea correctamente. Orden de los grupos en la barra:
    // Pasta → Agregados pétreos → Liviano.
    const aggColors = [[34, 197, 94], [22, 163, 74], [21, 128, 61], [5, 150, 105], [4, 120, 87]];
    const livianoColors = [[251, 191, 36], [245, 158, 11], [217, 119, 6]]; // ambar/dorado
    const aggVolEntries = [];
    const livianoVolEntries = [];
    if (resultado.agregados?.length > 0 && balanceVol.vAgregados > 0) {
      // Aproximación del volumen por ítem desde kg y densidad SSS.
      // densidadSss viene en kg/m³ (e.g. 2600 para pétreos, 14 para EPS),
      // así que kgM3 / densidadSss da m³ → multiplicar por 1000 para L.
      const aggsWithVol = resultado.agregados.filter(a => a.kgM3 > 0 && a.densidadSss > 0);
      if (aggsWithVol.length > 0) {
        let petreoIdx = 0;
        let livianoIdx = 0;
        aggsWithVol.forEach((agg, i) => {
          const vol = (agg.kgM3 / agg.densidadSss) * 1000; // m³ → L
          const esLiviano = agg.esLiviano === true || agg.tipo === 'LIVIANO';
          if (esLiviano) {
            livianoVolEntries.push({
              label: agg.nombre || `Material liviano ${livianoIdx + 1}`,
              vol,
              color: livianoColors[livianoIdx % livianoColors.length],
              grupo: 'liviano',
            });
            livianoIdx++;
          } else {
            aggVolEntries.push({
              label: agg.nombre || `Agregado ${petreoIdx + 1}`,
              vol,
              color: aggColors[petreoIdx % aggColors.length],
              grupo: 'agregados',
            });
            petreoIdx++;
          }
        });
      } else {
        aggVolEntries.push({ label: "Agregados", vol: balanceVol.vAgregados, color: aggColors[0], grupo: 'agregados' });
      }
    } else if (balanceVol.vAgregados > 0) {
      aggVolEntries.push({ label: "Agregados", vol: balanceVol.vAgregados, color: aggColors[0], grupo: 'agregados' });
    }
    volSegments.push(...aggVolEntries, ...livianoVolEntries);

    // Etiquetas-grupo encima de la barra. Iteramos los grupos presentes en
    // el orden Pasta → Agregados → Liviano y dibujamos corchete + etiqueta
    // "Grupo (vol L · %)" sobre el rango X que ocupa cada grupo.
    const ORDEN_GRUPOS = [
      { key: 'pasta',     label: 'Pasta' },
      { key: 'agregados', label: 'Agregados' },
      { key: 'liviano',   label: 'Liviano' },
    ];
    const grupoTotales = volSegments.reduce((acc, s) => {
      acc[s.grupo] = (acc[s.grupo] || 0) + s.vol;
      return acc;
    }, {});
    const gruposPresentes = ORDEN_GRUPOS.filter(g => (grupoTotales[g.key] || 0) > 0);
    const tieneVariosGrupos = gruposPresentes.length >= 2;
    const groupLabelH = 7;
    if (tieneVariosGrupos) {
      let xCursor = barX;
      const drawGroupLabel = (label, xs, xe, vol, pct) => {
        const cx0 = (xs + xe) / 2;
        const ybr = y + groupLabelH - 2.2;
        doc.setDrawColor(120, 120, 120);
        doc.setLineWidth(0.25);
        doc.line(xs + 0.5, ybr, xe - 0.5, ybr);
        doc.line(xs + 0.5, ybr, xs + 0.5, ybr + 1.2);
        doc.line(xe - 0.5, ybr, xe - 0.5, ybr + 1.2);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...C.secondary);
        const labelText = `${label} (${formatNumber(vol, 0)} L · ${formatNumber(pct, 1)}%)`;
        doc.text(tx(labelText), cx0, y + 2.5, { align: 'center' });
      };
      gruposPresentes.forEach((g) => {
        const wG = (grupoTotales[g.key] / total) * barW;
        const xs = xCursor;
        const xe = xCursor + wG;
        drawGroupLabel(g.label, xs, xe, grupoTotales[g.key], (grupoTotales[g.key] / total) * 100);
        xCursor = xe;
      });
      y += groupLabelH;
    }

    // Draw stacked horizontal bar. Para que segmentos muy chicos (típico
    // aditivo ~0,2% del volumen total = ~0,4mm con barW=190mm) no
    // desaparezcan visualmente y queden ausentes de la leyenda, los
    // dibujamos con un ancho mínimo de 1,5mm (distorsiona apenas el total).
    const MIN_DRAW_W = 1.5;
    let cx = barX;
    const segRects = [];
    volSegments.forEach((seg) => {
      if (!(seg.vol > 0)) return;
      const wReal = (seg.vol / total) * barW;
      const wDraw = Math.max(wReal, MIN_DRAW_W);
      doc.setFillColor(...seg.color);
      doc.rect(cx, y, wDraw, barH, "F");
      segRects.push({ ...seg, x: cx, w: wDraw, wReal, pct: (seg.vol / total) * 100 });
      cx += wDraw;
    });

    // Separadores gruesos entre cada par de grupos consecutivos.
    if (tieneVariosGrupos) {
      let xAcum = barX;
      for (let i = 0; i < gruposPresentes.length - 1; i++) {
        xAcum += (grupoTotales[gruposPresentes[i].key] / total) * barW;
        doc.setDrawColor(40, 40, 40);
        doc.setLineWidth(0.8);
        doc.line(xAcum, y - 0.3, xAcum, y + barH + 0.3);
      }
    }

    // Percentage labels inside segments (only if wide enough)
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    segRects.forEach((seg) => {
      if (seg.w > 16) {
        const pctStr = `${formatNumber(seg.pct, 1)}%`;
        doc.text(pctStr, seg.x + seg.w / 2, y + barH / 2 + 1, { align: "center" });
      }
    });

    y += barH + 2;

    // Legend row below bar
    doc.setFontSize(6);
    let legX = barX;
    const legRowH = 3.5;
    let legRow = 0;
    segRects.forEach((seg) => {
      const labelStr = `${seg.label} (${formatNumber(seg.vol, 0)} L)`;
      const labelW = doc.getTextWidth(labelStr) + 7;
      if (legX + labelW > barX + barW) {
        legX = barX;
        legRow++;
      }
      doc.setFillColor(...seg.color);
      doc.rect(legX, y + legRow * legRowH, 3, 2.5, "F");
      doc.setFont("Helvetica", "normal");
      doc.setTextColor(...C.text);
      doc.text(labelStr, legX + 4, y + legRow * legRowH + 2);
      legX += labelW;
    });
    y += (legRow + 1) * legRowH + 4;

    // ── Vertical bar chart (complement) ──
    if (segRects.length > 1) {
      const chartH = 40;
      const chartW = barW;
      const chartX = barX;
      const chartY = y;
      const maxPct = Math.max(...segRects.map(s => s.pct), 1);
      const barCount = segRects.length;
      const gap = 2;
      const bw = Math.min((chartW - gap * (barCount + 1)) / barCount, 20);
      const totalBarsW = barCount * bw + (barCount + 1) * gap;
      const startX = chartX + (chartW - totalBarsW) / 2 + gap;

      // Y axis line
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.2);
      doc.line(chartX, chartY, chartX, chartY + chartH);
      doc.line(chartX, chartY + chartH, chartX + chartW, chartY + chartH);

      // Y axis labels
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(5);
      doc.setTextColor(150, 150, 150);
      const ySteps = [0, 25, 50, 75, 100];
      ySteps.forEach(pct => {
        const ly = chartY + chartH - (pct / 100) * chartH;
        doc.text(`${pct}%`, chartX - 1, ly + 1, { align: 'right' });
        if (pct > 0) {
          doc.setDrawColor(230, 230, 230);
          doc.setLineWidth(0.1);
          doc.line(chartX, ly, chartX + chartW, ly);
        }
      });

      // Bars + separador entre grupo Pasta y grupo Agregados.
      let prevGrupo = null;
      segRects.forEach((seg, i) => {
        const bx = startX + i * (bw + gap);
        const bh = (seg.pct / 100) * chartH;
        const by = chartY + chartH - bh;
        // Línea fina vertical entre el último 'pasta' y el primer 'agregados'.
        if (prevGrupo === 'pasta' && seg.grupo === 'agregados') {
          const xSep = bx - gap / 2;
          doc.setDrawColor(40, 40, 40);
          doc.setLineWidth(0.5);
          doc.line(xSep, chartY, xSep, chartY + chartH);
        }
        prevGrupo = seg.grupo;
        doc.setFillColor(...seg.color);
        doc.rect(bx, by, bw, bh, 'F');

        // Percentage on top
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(5.5);
        doc.setTextColor(...seg.color);
        doc.text(`${formatNumber(seg.pct, 1)}%`, bx + bw / 2, by - 1, { align: 'center' });

        // Label below bar (abbreviated)
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(4.5);
        doc.setTextColor(100, 100, 100);
        const shortLabel = seg.label.length > 12 ? seg.label.substring(0, 11) + '.' : seg.label;
        doc.text(shortLabel, bx + bw / 2, chartY + chartH + 3, { align: 'center' });
      });

      y = chartY + chartH + 7;
    }
  }

  // Absorption alerts — brief note referencing Section H for details
  if (absorcionAlerts.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 12);
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.amber);
    doc.text(tx(`Nota: ${absorcionAlerts.length} ${absorcionAlerts.length === 1 ? 'alerta' : 'alertas'} de absorción. Ver detalle en la sección Advertencias técnicas.`), margin + 2, y);
    doc.setTextColor(...C.text);
    doc.setFont("Helvetica", "normal");
    y += 5;
  }
  y += 2;

  // ── F.3 Gráfico de barras — Proporciones de materiales (kg/m³) ──
  if (resultado?.agregados?.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 50);
    y = subHeader(doc, dynSub(3, 'Proporciones de materiales (kg/m³)'), margin + 2, y);

    // Collect all components: agua, cemento, adiciones, aditivos, each aggregate
    const barItems = [];
    if (resultado.aguaLtsM3) barItems.push({ label: 'Agua', valor: resultado.aguaLtsM3, color: [59, 130, 246] });
    if (resultado.cementoTotalKgM3) barItems.push({ label: 'Cemento', valor: resultado.cementoTotalKgM3, color: [107, 114, 128] });
    if (resultado.adicion1KgM3) barItems.push({ label: `Adición 1${resultado.adicion1Nombre ? ` (${String(resultado.adicion1Nombre).substring(0, 14)})` : ''}`, valor: Number(resultado.adicion1KgM3), color: [156, 163, 175] });
    if (resultado.adicion2KgM3) barItems.push({ label: `Adición 2${resultado.adicion2Nombre ? ` (${String(resultado.adicion2Nombre).substring(0, 14)})` : ''}`, valor: Number(resultado.adicion2KgM3), color: [156, 163, 175] });
    const aggColors = [[34, 197, 94], [22, 163, 74], [21, 128, 61], [5, 150, 105], [4, 120, 87]];
    const livianoColorsF3 = [[251, 191, 36], [245, 158, 11], [217, 119, 6]];
    let petreoIdxF3 = 0;
    let livianoIdxF3 = 0;
    resultado.agregados.forEach((agg) => {
      if (!(agg.kgM3 > 0)) return;
      const nom = agg.nombre || '';
      const label = nom.length > 35 ? nom.substring(0, 32) + '...' : nom;
      const esLiviano = agg.esLiviano === true || agg.tipo === 'LIVIANO';
      if (esLiviano) {
        // Para livianos, el dato dominante es el volumen (L/m³), no el peso.
        // Mostramos kg como valor principal de la barra y L como info adicional.
        const volLM3 = agg.densidadSss > 0 ? Math.round((agg.kgM3 / agg.densidadSss) * 1000) : null;
        barItems.push({
          label,
          valor: agg.kgM3,
          color: livianoColorsF3[livianoIdxF3 % livianoColorsF3.length],
          extra: volLM3 != null ? `${volLM3} L/m³` : null,
        });
        livianoIdxF3++;
      } else {
        barItems.push({ label, valor: agg.kgM3, color: aggColors[petreoIdxF3 % aggColors.length] });
        petreoIdxF3++;
      }
    });
    // Sesión 2026-05-29: incluir aditivos en F.3 (faltaban). Dosis típica
    // ~0.3-1.5% sobre cemento → unos 1-5 kg/m³, queda chico al lado de los
    // pétreos pero igualmente debe aparecer para que la lectura sea completa.
    snapAditivos.forEach((item, idx) => {
      const trazItem = trazAditivos[idx] || {};
      const kg = trazItem.kgM3 != null ? Number(trazItem.kgM3) : null;
      if (kg == null || !(kg > 0)) return;
      const aditivoLabel = aditivoShortName(item.label) || `Aditivo ${idx + 1}`;
      barItems.push({ label: aditivoLabel, valor: kg, color: [168, 85, 247] });
    });
    if (resultado.fibras?.macrofibra?.dosisKgM3) {
      const f = resultado.fibras.macrofibra;
      barItems.push({ label: `Macrofibra${f.nombre ? ` (${String(f.nombre).substring(0, 14)})` : ''}`, valor: Number(f.dosisKgM3), color: [234, 88, 12] });
    }
    if (resultado.fibras?.microfibra?.dosisKgM3) {
      const f = resultado.fibras.microfibra;
      barItems.push({ label: `Microfibra${f.nombre ? ` (${String(f.nombre).substring(0, 14)})` : ''}`, valor: Number(f.dosisKgM3), color: [251, 146, 60] });
    }

    if (barItems.length > 0) {
      const maxVal = Math.max(...barItems.map(b => b.valor));
      const chartX = margin + 2;
      const chartW = contentW - 4;
      const barH = 6;
      const gap = 2;
      const labelW = 62; // mayor ancho para etiquetas largas de agregados
      const valW = 18;
      const barArea = chartW - labelW - valW - 4;

      // P2.7 — truncar etiquetas con elipsis cuando exceden el ancho disponible.
      // Antes salía "Arena Común \"Las Que..." cortado abruptamente, solapando
      // la barra. Ahora medimos con getTextWidth y agregamos "…" al final.
      const truncarConElipsis = (txt, maxWidthMm) => {
        if (!txt) return '';
        if (doc.getTextWidth(txt) <= maxWidthMm) return txt;
        let s = txt;
        while (s.length > 0 && doc.getTextWidth(s + '…') > maxWidthMm) {
          s = s.slice(0, -1);
        }
        return (s.trim() || txt.slice(0, 1)) + '…';
      };

      barItems.forEach(item => {
        // Respetar FOOTER_RESERVE (no pageH - 12, que es la línea del footer).
        // Antes el bar chart se dibujaba hasta el footer y solapaba con el
        // texto "Página N | fecha". El bar ocupa barH=6mm + gap=2mm + ~3mm
        // del descenso del label, por eso reservamos al menos barH+gap.
        if (y + barH + gap > pageH - FOOTER_RESERVE) { doc.addPage(); y = margin + 5; }
        // Label con truncado seguro
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(...C.text);
        const labelTrunc = truncarConElipsis(item.label, labelW - 2);
        doc.text(labelTrunc, chartX, y + barH * 0.7);
        // Bar
        const bw = (item.valor / maxVal) * barArea;
        doc.setFillColor(...item.color);
        doc.roundedRect(chartX + labelW, y, bw, barH, 1, 1, 'F');
        // Value (1 decimal for water so 153,2 doesn't round to 153)
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(6.5);
        const valLabel = item.label === 'Agua'
          ? formatNumber(item.valor, 1)
          : (item.valor < 10 ? formatNumber(item.valor, 2) : `${Math.round(item.valor)}`);
        doc.text(valLabel, chartX + labelW + bw + 2, y + barH * 0.7);
        // Info extra (L/m³ para livianos): se renderiza más a la derecha
        // del valor, en gris claro y fuente fina, para no confundir con el
        // valor principal en kg/m³.
        if (item.extra) {
          doc.setFont('Helvetica', 'normal');
          doc.setFontSize(5.5);
          doc.setTextColor(120, 120, 120);
          const valW = doc.getTextWidth(valLabel);
          doc.text(`(${item.extra})`, chartX + labelW + bw + 2 + valW + 2, y + barH * 0.7);
          doc.setTextColor(...C.text);
        }
        y += barH + gap;
      });

      // Unit label — todos los valores están en kg/m³ (el agua en kg/m³
      // equivale a L/m³ por densidad 1). El "L/m³" entre paréntesis al lado
      // del Telgopor indica el volumen real (dosis manual en planta).
      if (y + 5 > pageH - FOOTER_RESERVE) { doc.addPage(); y = margin + 5; }
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      doc.text('Valores en kg/m³', chartX + labelW, y);
      doc.setTextColor(...C.text);
      y += 5;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION F.3b — Corrección por humedad de agregados (condición de obra)
  // ══════════════════════════════════════════════════════════════════════════════
  if (resultado?.items?.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 60);
    y = subHeader(doc, tx(dynSub(4, "Corrección por humedad de agregados (condición de obra)")), margin + 2, y);
    y += 1;

    doc.setFont("Helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...C.secondary);
    const introLines = doc.splitTextToSize(
      tx("Los pesos de la sección F corresponden a condición SSS (saturado superficie seca). Para producción, corregir por humedad real de cada agregado antes de cada bachada."),
      contentW - 4
    );
    for (const line of introLines) { doc.text(line, margin + 2, y); y += 3; }
    y += 2;

    // Formula
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...C.text);
    doc.text(tx("Peso obra (húmedo) = Peso SSS x (100 + h%) / (100 + Abs%).   Corrección de agua: delta_i = Peso SSS_i x (h% - Abs%) / 100. Agua obra = Agua SSS - suma(delta_i). Si h > Abs: el agregado aporta agua (se resta del amasado); si h < Abs: la absorbe (se suma)."), margin + 2, y);
    y += 5;

    // Table with empty humidity column for field use
    const humHead = ["Agregado", "Peso SSS (kg)", "Absorci\u00f3n (%)", "Humedad (%)*", "Peso obra (kg)*", "Corr. Agua (L)*"];
    const humBody = [];
    const agItems = resultado.items.filter(it => it.tipo === 'AGREGADO' || it.pesoKgM3 > 0);
    const aguaDisenoVal = resultado.aguaLtsM3 ?? 0;

    for (const it of agItems) {
      const nombre = it.nombre || it.descripcion || 'Agregado';
      const pesoSSS = it.pesoKgM3 ?? 0;
      const abs = it.absorcionPct ?? it.absorcion ?? 0;
      humBody.push([
        nombre.length > 30 ? nombre.substring(0, 28) + '...' : nombre,
        formatNumber(pesoSSS, 0),
        formatNumber(abs, 1),
        "\u2014",
        "\u2014",
        "\u2014",
      ]);
    }

    humBody.push([
      { content: tx("TOTALES"), styles: { fontStyle: 'bold' } },
      { content: formatNumber(agItems.reduce((s, it) => s + (it.pesoKgM3 || 0), 0), 0), styles: { fontStyle: 'bold' } },
      "",
      "",
      { content: "\u2014", styles: { fontStyle: 'bold' } },
      { content: "\u2014", styles: { fontStyle: 'bold' } },
    ]);

    humBody.push([
      { content: tx(`Agua de amasado corregida = ${formatNumber(aguaDisenoVal, 1)} + (suma correcciones)`), colSpan: 6, styles: { fontStyle: 'bold', halign: 'left' } },
    ]);

    doc.autoTable({
      startY: y,
      head: [humHead],
      body: humBody,
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.8, lineColor: [180, 180, 180], lineWidth: 0.15 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold", fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 25, halign: 'center' },
        2: { cellWidth: 22, halign: 'center' },
        3: { cellWidth: 22, halign: 'center' },
        4: { cellWidth: 25, halign: 'center' },
        5: { cellWidth: 22, halign: 'center' },
      },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 3;

    doc.setFont("Helvetica", "italic");
    doc.setFontSize(6);
    doc.setTextColor(...C.secondary);
    doc.text(tx("* Completar con humedad real antes de cada bachada. h = humedad natural del agregado (%)."), margin + 2, y);
    y += 5;
    doc.setTextColor(...C.text);
    doc.setFont("Helvetica", "normal");
  }
  } // end showSection('dosificacionFinal')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION G — Trazabilidad del agua y absorción
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('trazabilidadAgua')) {
  y = checkBreak(doc, y, pageH, margin, 55);
  y = sectionHeader(doc, dynTitle(tx('Trazabilidad del agua de amasado')), margin, y, contentW);

  const aguaRows     = [];
  const aguaBoldIdxs = [];

  // Agua base — única tabla en uso (motor HormiQual 1.0).
  // Los códigos ICPA_BASE_* son nombres internos de las variantes de interpolación;
  // la fuente real es la tabla HormiQual cargada en BD.
  const aguaMetodoLabel = tx("Agua base (tabla HormiQual)");
  const aguaBaseDetalle = tx(translateAguaMetodo(aguaBase.metodo) || (aguaBase.asentamientoCm != null ? `Asentamiento ${aguaBase.asentamientoCm} cm` : "-"));
  aguaRows.push([aguaMetodoLabel, aguaBase.aguaLtsM3 != null ? tx(`${formatNumber(aguaBase.aguaLtsM3, 1)} L/m³`) : "-", aguaBaseDetalle]);

  // Correcciones por aditivos
  correccionAditivo.forEach((item, cIdx) => {
    // Resolve "Aditivo 1" → commercial short name from snapAditivos
    const snapIdx = item.aditivo ? parseInt(item.aditivo.replace(/\D/g, ""), 10) - 1 : cIdx;
    const snapLabel = snapAditivos[snapIdx]?.label;
    const adNum = snapLabel ? aditivoShortName(snapLabel) : tx(item.aditivo || "Aditivo");
    if (item.informativo) {
      // Informational effect — no water modification
      const efLabel = MODO_EFECTO_LABELS[item.modo] || item.modo || "Informativo";
      aguaRows.push([
        tx(`${adNum} \u2014 ${efLabel}`),
        "Sin cambio en agua",
        "Efecto informativo",
      ]);
    } else if (item.modo === "AHORRO_AGUA") {
      const antes   = item.aguaAntes   != null ? tx(`${formatNumber(item.aguaAntes, 1)} L/m³`) : "-";
      const despues = item.aguaDespues != null ? tx(`${formatNumber(item.aguaDespues, 1)} L/m³`) : "-";
      const factorPct = item.factorDosis != null ? Math.round(item.factorDosis * 100) : 100;
      const redLabel = item.reduccionPct != null ? `-${formatNumber(item.reduccionPct, 1)}%` : "";
      const factorLabel = factorPct !== 100
        ? tx(` (factor ${factorPct}%: decl. ${formatNumber(item.reduccionDeclarada || item.reduccionPct, 1)}% a dosis rec.)`)
        : "";
      aguaRows.push([
        tx(`Reducción \u2014 ${adNum}`),
        `${antes} -> ${despues}`,
        redLabel + factorLabel,
      ]);
    } else if (item.modo === "AUMENTO_ASENTAMIENTO") {
      const inc = item.incrementoAsentamientoMm != null ? `+${item.incrementoAsentamientoMm} mm estimados` : "";
      aguaRows.push([
        tx(`Efecto reológico \u2014 ${adNum}`),
        "Sin cambio en agua",
        inc || "Mejora de trabajabilidad",
      ]);
    }
  });

  // Agua final
  aguaRows.push([
    "AGUA FINAL ADOPTADA",
    resultado.aguaLtsM3 != null ? tx(`${formatNumber(resultado.aguaLtsM3, 1)} L/m\u00b3`) : "-",
    "",
  ]);
  aguaBoldIdxs.push(aguaRows.length - 1);

  doc.autoTable({
    startY: y,
    head: [["Paso", "Valor", "Detalle"]],
    body: aguaRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 2.5, overflow: "linebreak" },
    headStyles: { fillColor: C.secondary, textColor: C.white, fontSize: 8 },
    alternateRowStyles: { fillColor: C.light },
    columnStyles: {
      0: { cellWidth: "auto" },
      1: { cellWidth: 36, halign: "center" },
      2: { cellWidth: 55 },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (aguaBoldIdxs.includes(data.row.index)) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = C.primary;
        data.cell.styles.fillColor = [235, 241, 248];
      }
    },
  });
  y = doc.lastAutoTable.finalY + 4;

  // Nota sobre el modelo de factor de dosis
  const hasFactorDosis = (correccionAditivo || []).some(c => c.factorDosis != null && Math.round(c.factorDosis * 100) !== 100);
  if (hasFactorDosis) {
    doc.setFontSize(6);
    doc.setTextColor(...C.muted);
    doc.text(tx('Modelo de factor de dosis: interpolaci\u00f3n lineal entre puntos de referencia (30% en dosis m\u00ednima, 100% en recomendada, 140% en m\u00e1xima).'), margin + 2, y);
    y += 3;
    doc.text(tx('El rendimiento es sublineal: sobredosis del 10% produce ~8% de efecto adicional (no 10%). Modelo conservador.'), margin + 2, y);
    y += 4;
    doc.setTextColor(...C.text);
  }

  // Absorción de la mezcla — dato técnico informativo
  if (absorcionMezcla) {
    y = checkBreak(doc, y, pageH, margin, 28);
    if (absorcionMezcla.absorcionPonderada != null) {
      const absText =
        `Absorción ponderada de la mezcla granular: ${formatParamValue('absorcion', absorcionMezcla.absorcionPonderada)}%` +
        (absorcionMezcla.aguaAbsorbibleTeoricaLM3 != null
          ? `   |   Capacidad teórica de absorción del paquete granular: ${formatNumber(absorcionMezcla.aguaAbsorbibleTeoricaLM3, 1)} L/m³` : "") +
        `   [DATO TÉCNICO INFORMATIVO \u2014 no modifica el agua de diseño]`;
      y = callout(doc, absText, margin, y, contentW, C.infoBg, C.blue);
    } else if (absorcionMezcla.nota) {
      y = callout(doc, tx(`Absorción de mezcla incompleta: ${absorcionMezcla.nota}`), margin, y, contentW, C.amberBg, C.amber);
    }
  }
  y += 2;
  } // end showSection('trazabilidadAgua')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION G2 — Verificaciones CIRSOC 200:2024 (Aire T.4.3 + Pulverulento T.4.4)
  // HRDC: se omite (CIRSOC no aplica a hormigones celulares livianos).
  // ══════════════════════════════════════════════════════════════════════════════
  if (!fueraDeCirsoc && showSection('verificacionesCIRSOC')) {
  const verificacionAire = traz?.verificacionAire || null;
  const verificacionPulverulento = traz?.verificacionPulverulento || null;

  if (verificacionAire || verificacionPulverulento) {
    y = checkBreak(doc, y, pageH, margin, 30);
    y = sectionHeader(doc, dynTitle(tx('Verificaciones CIRSOC 200:2024')), margin, y, contentW);

    const verifRows = [];

    // Decisión 2026-05-28: en modo DESCRIPTIVO la tabla muestra los
    // valores calculados con la referencia CIRSOC al lado, sin emitir
    // veredicto "APTO / NO APTO". En NORMATIVO se mantiene la fila
    // "Resultado" con la categoría canónica.
    const _emitirResultado = _modoNorm === 'NORMATIVO';

    if (verificacionAire) {
      verifRows.push([
        tx("Aire incorporado (Tabla 4.3)"),
        tx(`Clase ${verificacionAire.clase}, TMN ${verificacionAire.tmnMm} mm`),
      ]);
      verifRows.push([
        tx("Aire requerido"),
        tx(`${formatNumber(verificacionAire.aireRequeridoEfectivo, 1, true)}% ± ${formatNumber(verificacionAire.tolerancia, 1, true)}%${verificacionAire.excepcionH35 ? " (reducción H-35)" : ""}`),
      ]);
      if (verificacionAire.aireActual != null) {
        verifRows.push([
          tx("Aire actual"),
          tx(`${formatNumber(verificacionAire.aireActual, 1, true)}%`),
        ]);
      }
      if (_emitirResultado) {
        verifRows.push([
          tx("Resultado"),
          verificacionAire.cumple === true || verificacionAire.cumple === false
            ? tx(getCategoriaPdfLabel(verificacionAire.cumple))
            : tx("Sin dato de aire"),
        ]);
      }
    }

    if (verificacionPulverulento) {
      verifRows.push([
        tx("Pulverulento mínimo (Tabla 4.4)"),
        tx(`TMN ${verificacionPulverulento.tmnMm} mm \u2014 mínimo ${verificacionPulverulento.minimoKgM3} kg/m³`),
      ]);

      // Build detailed breakdown string
      const pulvParts = [`Cemento: ${verificacionPulverulento.cementoPulv} kg/m³`];
      if (verificacionPulverulento.adicionesPulv > 0) {
        pulvParts.push(`Adiciones: ${verificacionPulverulento.adicionesPulv} kg/m³`);
      }
      if (verificacionPulverulento.finosAgregadoPulv > 0) {
        pulvParts.push(`Finos agregados (< 300 µm): ${verificacionPulverulento.finosAgregadoPulv} kg/m³`);
      }
      verifRows.push([
        tx("Pulverulento estimado"),
        tx(`${verificacionPulverulento.totalPulverulento} kg/m³`),
      ]);
      verifRows.push([
        tx("  Desglose"),
        tx(pulvParts.join(" + ")),
      ]);

      // Per-aggregate fines detail
      const finosDetalle = verificacionPulverulento.finosDetalle || [];
      if (finosDetalle.length > 0) {
        finosDetalle.forEach((d) => {
          // MEJ-8: Always indicate that the % p300 comes from the individual aggregate's
          // granulometry (not from the combined mix). Append fecha/ensayo ID if available.
          const srcParts = ['granulometría individual del agregado'];
          if (d.granulometriaFecha) srcParts.push(d.granulometriaFecha);
          if (d.granulometriaEnsayoId) srcParts.push(`ensayo #${d.granulometriaEnsayoId}`);
          verifRows.push([
            tx(`    ${d.nombre}`),
            tx(`${d.aporteKg} kg (${d.kgM3} kg x ${formatNumber(d.p300Pct, 1)}% pas. 300 um \u2014 ${srcParts.join(', ')})`),
          ]);
        });
      }

      if (_emitirResultado) {
        verifRows.push([
          tx("Resultado"),
          verificacionPulverulento.cumple
            ? tx(`${getCategoriaPdfLabel(true)} (${verificacionPulverulento.totalPulverulento} >= ${verificacionPulverulento.minimoKgM3})`) + (verificacionPulverulento.excepcionH20 ? tx(" (excepción <= H-20)") : "")
            : tx(`${getCategoriaPdfLabel(false)} (${verificacionPulverulento.totalPulverulento} < ${verificacionPulverulento.minimoKgM3})`),
        ]);
      } else {
        // En DESCRIPTIVO mostramos solo el dato comparativo sin etiqueta
        // de veredicto: "Pulverulento estimado / mínimo: X kg/m³ / Y kg/m³"
        // ya está en filas previas; sin "Resultado" final.
      }
    }

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [[tx("Verificación"), tx("Valor / Resultado")]],
      body: verifRows,
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 2.5, textColor: C.text, lineColor: [220, 220, 220], lineWidth: 0.2 },
      headStyles: { fillColor: C.light, textColor: C.primary, fontStyle: "bold", fontSize: 7 },
      columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 1) {
          // Prompt 3 C9.5: color canónico desde el label. El check `startsWith('NO APTO')`
          // PRECEDE al de `startsWith('APTO')` porque "NO APTO ..." también startsWith "NO".
          const val = String(data.cell.raw);
          if (val.startsWith("NO APTO")) data.cell.styles.textColor = getCategoriaPdfColor(VEREDICTO.NO_APTO);
          else if (val.startsWith("APTO")) data.cell.styles.textColor = getCategoriaPdfColor(VEREDICTO.APTO);
        }
      },
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION G2b — CIRSOC 200-2024 Tabla 9.3 (hormigones con características particulares)
  // ══════════════════════════════════════════════════════════════════════════════
  const hpInfo = traz?.hormigonParticular || null;
  if (hpInfo) {
    y = checkBreak(doc, y, pageH, margin, 40);
    const tipoLabels = { BAJO_AGUA: "Hormigón a colocar bajo agua", IMPERMEABILIDAD: "Elevada impermeabilidad", ABRASION: "Expuesto a abrasión" };
    y = sectionHeader(doc, dynTitle(tx(`Tabla 9.3 CIRSOC — ${tipoLabels[hpInfo.tipoHormigon] || hpInfo.tipoHormigon} (Clase ${hpInfo.clase})`)), margin, y, contentW);

    const req = hpInfo.requisitos || {};
    const hpRows = [];
    if (req.acMax != null) hpRows.push([tx("a/c máxima"), tx(Number(req.acMax).toFixed(3))]);
    if (req.claseMinima) hpRows.push([tx("Clase mínima"), tx(req.claseMinima)]);
    if (req.aireIncorporado) hpRows.push([tx("Aire incorporado"), tx({ OPCIONAL: "Opcional", NO: "No admitido", REQUERIDO: "Requerido" }[req.aireIncorporado] || req.aireIncorporado)]);
    if (Array.isArray(req.consistenciaPermitida) && req.consistenciaPermitida.length > 0) hpRows.push([tx("Consistencias permitidas"), tx(req.consistenciaPermitida.join(", "))]);
    if (req.penetracionAguaMaxMm != null) hpRows.push([tx("Penetración agua máx (IRAM 1554)"), tx(`${req.penetracionAguaMaxMm} mm`)]);
    if (req.tmnMaxMm != null) hpRows.push([tx("TMN máximo absoluto"), tx(`${req.tmnMaxMm} mm`)]);
    if (req.tmnMaxFraccionEspesor != null) {
      const frac = `${req.tmnMaxFraccionEspesor} × espesor`;
      const aplic = hpInfo.espesorEvaluadoMm ? ` (= ${(req.tmnMaxFraccionEspesor * hpInfo.espesorEvaluadoMm).toFixed(1)} mm sobre ${hpInfo.espesorEvaluadoMm} mm)` : "";
      hpRows.push([tx("TMN máx / espesor"), tx(frac + aplic)]);
    }
    if (req.desgasteLAMaxPct != null) hpRows.push([tx("Desgaste Los Ángeles máx"), tx(`${req.desgasteLAMaxPct}%`)]);

    hpRows.push([
      tx("Cumplimiento del diseño"),
      hpInfo.cumple ? tx(getCategoriaPdfLabel(true)) : tx(`${getCategoriaPdfLabel(false)} (${(hpInfo.checks || []).filter(c => c.tipo === 'error').length} error(es))`),
    ]);

    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [[tx("Requisito"), tx("Valor / Resultado")]],
      body: hpRows,
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 2.5, textColor: C.text, lineColor: [220, 220, 220], lineWidth: 0.2 },
      headStyles: { fillColor: C.light, textColor: C.primary, fontStyle: "bold", fontSize: 7 },
      columnStyles: { 0: { cellWidth: 55, fontStyle: "bold" } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 1) {
          // Prompt 3 C9.5: mismo patrón que la tabla de aire+pulverulento — orden NO APTO antes que APTO.
          const val = String(data.cell.raw);
          if (val.startsWith("NO APTO")) data.cell.styles.textColor = getCategoriaPdfColor(VEREDICTO.NO_APTO);
          else if (val.startsWith("APTO")) data.cell.styles.textColor = getCategoriaPdfColor(VEREDICTO.APTO);
        }
      },
    });
    y = doc.lastAutoTable.finalY + 2;

    if (Array.isArray(hpInfo.checks) && hpInfo.checks.length > 0) {
      const checkRows = hpInfo.checks.map(c => [
        tx(c.tipo === 'error' ? "✗ ERROR" : "⚠ ADVERTENCIA"),
        tx(c.msg || ""),
      ]);
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        body: checkRows,
        theme: "plain",
        styles: { fontSize: 7, cellPadding: 2, textColor: C.text },
        columnStyles: { 0: { cellWidth: 25, fontStyle: "bold" } },
        didParseCell: (data) => {
          if (data.column.index === 0) {
            data.cell.styles.textColor = String(data.cell.raw).includes("ERROR") ? [220, 38, 38] : [217, 119, 6];
          }
        },
      });
      y = doc.lastAutoTable.finalY + 4;
    }
  }
  } // end showSection('verificacionesCIRSOC')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION G3 — Verificación granulométrica — Banda IRAM 1627
  // HRDC: se omite (la banda IRAM 1627 está calibrada para hormigón estructural).
  // ══════════════════════════════════════════════════════════════════════════════
  if (!esHRDC && showSection('granulometria')) {
  const verifIRAM = resultado?.verificacionIRAM;
  if (verifIRAM?.rows?.length > 0) {
    // PR6.c — keep-together SOLO de header + tabla + verdict (lo que no
    // tiene break interno). El chart sí tiene su propio checkBreak y puede
    // saltar a la página siguiente sin dejar la tabla huérfana. Antes el
    // keep-together incluía el chart completo (~100mm), forzando un salto
    // de página agresivo que dejaba la sección CIRSOC anterior con ~180mm
    // en blanco (audit smoke-pdf-visual). Reducir el keep-together a
    // tabla+verdict permite que la sección CIRSOC + tabla granulométrica
    // convivan en la misma página, y el chart fluye a la siguiente.
    const _estHeader = 12;
    const _estTabla = 10 + verifIRAM.rows.length * 5 + 6;
    const _estVerdictNota = 14;
    const _estKeepTogether = _estHeader + _estTabla + _estVerdictNota;
    y = checkBreak(doc, y, pageH, margin, _estKeepTogether);
    y = sectionHeader(doc, dynTitle(tx(`Verificación granulométrica \u2014 Banda IRAM 1627 (TMN ${verifIRAM.tmnMm} mm)`)), margin, y, contentW);

    // Per-sieve table.
    // Decisión 2026-05-28 (auditor-pdf 2026-05-28): en DESCRIPTIVO se
    // omite la columna "Estado" por tamiz (Cumple / No cumple). El lector
    // ve la curva sobre la banda (gráfico) + los valores numéricos vs
    // los límites IRAM y compara por su cuenta.
    const _emitirEstadoTamiz = _modoNorm === 'NORMATIVO';
    const iramHead = _emitirEstadoTamiz
      ? [tx('Tamiz'), tx('% Pasante mezcla'), tx('Lím. inf. IRAM'), tx('Lím. sup. IRAM'), tx('Estado')]
      : [tx('Tamiz'), tx('% Pasante mezcla'), tx('Lím. inf. IRAM'), tx('Lím. sup. IRAM')];
    const iramBody = verifIRAM.rows.map(r => {
      const pasaStr = r.pasaMix != null ? formatNumber(r.pasaMix, 1) : 'N/D';
      const infStr = r.limInf != null ? formatNumber(r.limInf, 0) : '-';
      const supStr = r.limSup != null ? formatNumber(r.limSup, 0) : '-';
      const row = [
        r.tamiz,
        { content: pasaStr, styles: { halign: 'center' } },
        { content: infStr, styles: { halign: 'center' } },
        { content: supStr, styles: { halign: 'center' } },
      ];
      if (_emitirEstadoTamiz) {
        let estadoStr, estadoColor;
        if (r.estado === 'FUERA') {
          const desvStr = r.desvio != null ? ` (${r.desvio > 0 ? '+' : ''}${formatNumber(r.desvio, 1)} pp)` : '';
          estadoStr = `No cumple${desvStr}`;
          estadoColor = getCategoriaPdfColor(VEREDICTO.NO_APTO);
        } else if (r.estado === 'SIN_DATO') {
          estadoStr = 'Sin dato';
          estadoColor = C.muted;
        } else {
          estadoStr = 'Cumple';
          estadoColor = getCategoriaPdfColor(VEREDICTO.APTO);
        }
        row.push({ content: estadoStr, styles: { fontStyle: r.estado === 'FUERA' ? 'bold' : 'normal', textColor: estadoColor } });
      }
      return row;
    });

    doc.autoTable({
      startY: y,
      head: [iramHead],
      body: iramBody,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: 0.2 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 7 },
      margin: { left: margin, right: margin },
      columnStyles: _emitirEstadoTamiz ? {
        0: { cellWidth: 25 },
        1: { cellWidth: 30, halign: 'center' },
        2: { cellWidth: 28, halign: 'center' },
        3: { cellWidth: 28, halign: 'center' },
        4: { cellWidth: 40 },
      } : {
        0: { cellWidth: 30 },
        1: { cellWidth: 40, halign: 'center' },
        2: { cellWidth: 35, halign: 'center' },
        3: { cellWidth: 35, halign: 'center' },
      },
    });
    y = doc.lastAutoTable.finalY + 5;

    // Global verdict
    // Prompt 3 C9.5 — color canónico vía helper. CUMPLE_AC y CUMPLE_CON_DESVIOS
    // mapean a APTO_CON_OBSERVACIONES (cumple con matiz; análogo a
    // 'cumple_con_tolerancia §3.2.4' de granulometría individual del agregado).
    // Labels (iramGlobalLabels) preservados — descriptivos, citan banda específica.
    const iramGlobalColors = {
      'CUMPLE':            getCategoriaPdfColor(VEREDICTO.APTO),
      'CUMPLE_AC':         getCategoriaPdfColor(VEREDICTO.APTO_CON_OBSERVACIONES),
      'CUMPLE_CON_DESVIOS': getCategoriaPdfColor(VEREDICTO.APTO_CON_OBSERVACIONES),
      'NO_CUMPLE':         getCategoriaPdfColor(VEREDICTO.NO_APTO),
    };
    const iramGlobalLabels = {
      'CUMPLE': 'CUMPLE (Banda A-B)',
      'CUMPLE_AC': 'CUMPLE BANDA A-C',
      'CUMPLE_CON_DESVIOS': 'CUMPLE CON DESVÍOS MENORES',
      'NO_CUMPLE': 'NO CUMPLE',
    };
    // Decisi\u00f3n 2026-05-28 (auditor-pdf): en DESCRIPTIVO se omite el
    // bloque "Resultado: CUMPLE/NO CUMPLE" porque emite veredicto formal
    // con texto de acci\u00f3n ("Revisar proporciones"). La curva sobre la
    // banda + los valores num\u00e9ricos de la tabla siguen visibles.
    if (_modoNorm === 'NORMATIVO') {
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...(iramGlobalColors[verifIRAM.estado] || C.text));
    doc.text(tx(`Resultado: ${iramGlobalLabels[verifIRAM.estado] || verifIRAM.estado} \u2014 ${verifIRAM.mensaje}`), margin + 2, y);
    y += 4;

    // If CUMPLE_AC, show detail about A-B failure
    if (verifIRAM.estado === 'CUMPLE_AC' && verifIRAM.evalAB) {
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(120, 100, 30);
      doc.text(tx(`Nota: no cumple banda A-B (${verifIRAM.evalAB.nFuera} tamiz(es) fuera, desvío máx. ${verifIRAM.evalAB.maxDesvio != null ? formatNumber(verifIRAM.evalAB.maxDesvio, 1, true) : '?'} pp). Cumple la banda más permisiva A-C.`), margin + 2, y);
      y += 3;
    }
    } // end if (_modoNorm === 'NORMATIVO')

    // Band reference footnote (se mantiene en ambos modos: es citación
    // descriptiva, no veredicto).
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(6);
    doc.setTextColor(...C.muted);
    const tablaRefStr = verifIRAM.tablaRef ? ` (${verifIRAM.tablaRef})` : '';
    doc.text(tx(`Banda: ${verifIRAM.bandaNombre}${tablaRefStr}. Comparación: primero A-B, luego A-C si no cumple A-B.`), margin + 2, y);
    y += 4;
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(...C.text);

    // ── Chart: Curva granulométrica vs Banda IRAM 1627 (vector SVG) ──
    if (verifIRAM.series?.medida?.length > 1) {
      y = checkBreak(doc, y, pageH, margin, 85);
      try {
        // Build curvas A, B, C from evalAB/evalAC data
        const fueraAB = new Set((verifIRAM.evalAB?.rows || verifIRAM.rows || []).filter(r => r.estado === 'FUERA').map(r => r.aberturaMm));
        const fueraAC = new Set((verifIRAM.evalAC?.rows || []).filter(r => r.estado === 'FUERA').map(r => r.aberturaMm));

        let svgParams;
        if (verifIRAM.evalAB?.series && verifIRAM.evalAC?.series) {
          // Full 3-curve mode: A from evalAB.bandaMin, B from evalAB.bandaMax, C from evalAC.bandaMax
          svgParams = {
            curvaA: (verifIRAM.evalAB.series.bandaMin || []).map(p => ({ aberturaMm: p.aberturaMm, target: p.pasaPct })),
            curvaB: (verifIRAM.evalAB.series.bandaMax || []).map(p => ({ aberturaMm: p.aberturaMm, target: p.pasaPct })),
            curvaC: (verifIRAM.evalAC.series.bandaMax || []).map(p => ({ aberturaMm: p.aberturaMm, target: p.pasaPct })),
            medida: verifIRAM.evalAB.series.medida || verifIRAM.series?.medida || [],
          };
        } else {
          // Legacy fallback: single band
          svgParams = verifIRAM.series;
        }
        const svgStr = generarIRAM1627SVG(svgParams, { tmnMm: verifIRAM.tmnMm, fueraAB, fueraAC, tablaRef: verifIRAM.tablaRef });

        const chartW = contentW - 4;
        const chartH = chartW * 400 / 720; // aspect ratio from iram1627Svg viewBox

        // Ensure chart + footer margin fits on current page
        if (y + chartH + 10 > pageH - 15) { doc.addPage(); y = margin + 5; }

        let usedVector = false;
        try {
          const { svg2pdf } = require('svg2pdf.js');
          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(svgStr, 'image/svg+xml');
          const svgEl = svgDoc.documentElement;
          await svg2pdf(svgEl, doc, { x: margin + 2, y, width: chartW, height: chartH });
          usedVector = true;
        } catch (vecErr) {
          console.warn('[iram1627] svg2pdf.js failed, falling back to Canvas:', vecErr.message);
        }

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
          doc.addImage(cvs.toDataURL('image/png'), 'PNG', margin + 2, y, chartW, chartH);
        }

        y += chartH + 8;
      } catch (svgErr) {
        console.warn('[iram1627-svg] Error:', svgErr);
      }
    }
  }
  } // end showSection('granulometria')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION G3-HRDC — Granulometría de la mezcla (HRDC)
  // En HRDC se omite la verificación contra banda IRAM 1627 (no aplica), pero
  // sí mostramos la curva granulométrica de la mezcla y los componentes para
  // dejar trazabilidad de la composición granular.
  // ══════════════════════════════════════════════════════════════════════════════
  if (esHRDC) {
    const mezclaBase = traz?.mezclaBase || null;
    let curva = mezclaBase?.curvaMezclaJson || null;
    if (typeof curva === 'string') { try { curva = JSON.parse(curva); } catch { curva = null; } }
    const items = mezclaBase?.items || [];
    if ((Array.isArray(curva) && curva.length > 0) || items.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 60);
      y = sectionHeader(doc, dynTitle(tx('Granulometría de la mezcla (HRDC)')), margin, y, contentW);

      // Tabla de componentes
      if (items.length > 0) {
        doc.autoTable({
          startY: y,
          head: [[tx('Componente'), tx('Tipo'), tx('% en mezcla'), tx('Densidad SSS')]],
          body: items.map(it => [
            tx(it.nombre || `Agregado ${it.idAgregado || '?'}`),
            tx(it.esGrueso ? 'Grueso' : 'Fino'),
            { content: it.porcentaje != null ? `${formatNumber(it.porcentaje, 1)} %` : '-', styles: { halign: 'center' } },
            { content: it.densidad != null ? `${formatNumber(it.densidad, 3)} g/cm³` : '-', styles: { halign: 'center' } },
          ]),
          margin: { left: margin, right: margin },
          styles: { fontSize: 8, cellPadding: 1.8, lineColor: [200, 200, 200], lineWidth: 0.2 },
          headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 8 },
          alternateRowStyles: { fillColor: C.light },
          theme: 'grid',
        });
        y = doc.lastAutoTable.finalY + 4;
      }

      // Tabla compacta de tamiz vs % pasante de la mezcla combinada
      if (Array.isArray(curva) && curva.length > 0) {
        const puntos = curva
          .filter(p => (p.pasaPct ?? p.pasa) != null)
          .map(p => ({
            tamiz: p.tamiz || `${p.aberturaMm ?? p.abertura} mm`,
            aberturaMm: Number(p.aberturaMm ?? p.abertura) || 0,
            pasaPct: Number(p.pasaPct ?? p.pasa) || 0,
          }))
          .sort((a, b) => b.aberturaMm - a.aberturaMm);

        if (puntos.length > 0) {
          y = checkBreak(doc, y, pageH, margin, 30);
          doc.autoTable({
            startY: y,
            head: [[tx('Tamiz'), tx('% Pasante mezcla')]],
            body: puntos.map(p => [
              tx(p.tamiz),
              { content: formatNumber(p.pasaPct, 1), styles: { halign: 'center' } },
            ]),
            margin: { left: margin, right: margin },
            styles: { fontSize: 7.5, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: 0.2 },
            headStyles: { fillColor: C.primary, textColor: C.white, fontSize: 7.5 },
            alternateRowStyles: { fillColor: C.light },
            theme: 'grid',
            columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 40, halign: 'center' } },
          });
          y = doc.lastAutoTable.finalY + 3;
          doc.setFont('Helvetica', 'italic');
          doc.setFontSize(6.5);
          doc.setTextColor(...C.muted);
          doc.text(tx(`Mezcla: ${mezclaBase?.nombre || '—'} · MF ${formatNumber(mezclaBase?.moduloFinura || 0, 2)} · TMN calculado ${mezclaBase?.tmnCalculadoMm || '—'} mm`), margin + 2, y);
          y += 4;
          doc.setFont('Helvetica', 'normal');
          doc.setTextColor(...C.text);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION K — Evaluación de trabajabilidad (Shilstone + Ken Day)
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('trabajabilidad')) {
  // trab hoisted al function scope arriba
  if (trab) {
    if (y > pageH - 70) { doc.addPage(); y = margin + 5; }
    y = sectionHeader(doc, dynTitle(tx('Evaluación de trabajabilidad')), margin, y, contentW);
    y += 1;
    doc.setFontSize(7);
    doc.setFont('Helvetica', 'italic');
    doc.setTextColor(...C.muted);
    doc.text(tx('An\u00e1lisis complementario basado en Shilstone (1990) y Ken Day.'), margin + 2, y);
    y += 4;
    doc.setTextColor(...C.text);

    // trab can be either nested (from trazabilidad) or flat (from resultado.trabajabilidad)
    const sh = trab.shilstone || trab;
    const kd = trab.kenDay || trab;

    const fdgVal = sh.factorGrosor ?? sh.fdg ?? trab.fdg;
    const fdtVal = sh.factorTrabajabilidad ?? sh.fdt ?? trab.fdt;
    const fdtAridoVal = sh.factorTrabajabilidadArido ?? sh.fdtArido ?? trab.shilstone?.factorTrabajabilidadArido ?? trab.factorTrabajabilidadArido;
    const seVal = kd.superficieEspecifica ?? kd.se ?? trab.se;
    const fdaCalc = kd.factorAptitud ?? kd.fda ?? trab.fda;
    const offsetTmnVal = trab.offsetTmn ?? sh.offsetTmn ?? 0;
    // FdA normalizado: siempre RESTA el offset (ver documentaci\u00f3n trabajabilidadEngine.js)
    const fdaNorm = fdaCalc != null && offsetTmnVal !== 0 ? Math.round((fdaCalc - offsetTmnVal) * 10) / 10 : fdaCalc;
    const fdaVal = fdaNorm; // Display FdA_norm, not FdA_calc

    // ── K.1 Tarjetas de indicadores ──
    // Antes este bloque no tenía subheader y la numeración saltaba directo a
    // K.2 (Gráfico de Shilstone). El smoke-pdf-visual marcó el salto K.1
    // implícito como bug de numeración.
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.text);
    doc.text(dynSub(1, 'Indicadores de trabajabilidad'), margin + 2, y);
    y += 4;
    const fmtV = (v, d = 1) => v != null ? Number(v).toFixed(d).replace('.', ',') : '\u2014';
    // FdT card subtitle: include uncorrected value when available, so the reader can
    // cross-reference with the mezcla report (which calculates FdT without cement).
    const fdtSub = (fdtAridoVal != null && fdtVal != null && Math.abs(Number(fdtAridoVal) - Number(fdtVal)) > 0.05)
      ? `sin cementante: ${fmtV(fdtAridoVal)}%`
      : 'Trabajabilidad';
    const cards = [
      { title: 'FdG', value: fmtV(fdgVal), unit: '%', sub: 'Grosor' },
      { title: 'FdT', value: fmtV(fdtVal), unit: '%', sub: fdtSub },
      { title: 'SE', value: fmtV(seVal), unit: '', sub: 'Sup. Espec\u00edfica' },
      { title: 'FdA', value: fmtV(fdaVal), unit: '', sub: offsetTmnVal !== 0 ? `base: ${fmtV(fdaCalc)} \u00b7 offset: ${offsetTmnVal > 0 ? '-' : '+'}${Math.abs(offsetTmnVal).toFixed(1)}` : 'Aptitud' },
    ];
    const cardW = (contentW - 12) / 4;
    const cardH = 14;
    for (let i = 0; i < cards.length; i++) {
      const cx = margin + i * (cardW + 4);
      doc.setFillColor(245, 247, 250);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.roundedRect(cx, y, cardW, cardH, 1, 1, 'FD');
      doc.setFontSize(6);
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.muted);
      doc.text(cards[i].title, cx + cardW / 2, y + 3, { align: 'center' });
      doc.setFontSize(11);
      doc.setFont('Helvetica', 'bold');
      doc.setTextColor(...C.text);
      doc.text(`${cards[i].value}${cards[i].unit ? ' ' + cards[i].unit : ''}`, cx + cardW / 2, y + 9, { align: 'center' });
      doc.setFontSize(5.5);
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.muted);
      doc.text(cards[i].sub, cx + cardW / 2, y + 12.5, { align: 'center' });
    }
    y += cardH + 3;

    // INC-2: Note explaining the FdT correction (the values are already shown in the card subtitle)
    if (fdtAridoVal != null && fdtVal != null && Math.abs(Number(fdtAridoVal) - Number(fdtVal)) > 0.05) {
      doc.setFontSize(6);
      doc.setFont('Helvetica', 'italic');
      doc.setTextColor(...C.muted);
      doc.text(tx(`FdT corregido por cementante (Cc = cem/42,6 - Day 2006). El valor sin corrección (${fmtV(fdtAridoVal)}%) coincide con el del informe de mezcla.`), margin + 2, y);
      y += 4;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
    }

    // I3: Explicit breakdown of FdA — raw value, TMN offset, effective value
    if (offsetTmnVal !== 0 && fdaCalc != null) {
      const tmnMmVal = trab.tmnMm || resultado?.tmnMm || snapshot?.tmnMm || '?';
      const offsetSign = offsetTmnVal > 0 ? '+' : '';
      const fdaBreakRows = [
        ['FdA calculado (sin corrección por TMN)', fmtV(fdaCalc)],
        [`Offset por TMN ${tmnMmVal} mm`, `${offsetSign}${fmtV(offsetTmnVal)}`],
        ['FdA efectivo (aplicado a rangos corregidos)', fmtV(fdaVal)],
      ];
      doc.autoTable({
        startY: y,
        margin: { left: margin + 2, right: margin + 2 },
        body: fdaBreakRows,
        theme: 'plain',
        styles: { fontSize: 7, cellPadding: 1, textColor: C.text },
        columnStyles: { 0: { cellWidth: 90 }, 1: { halign: 'right', fontStyle: 'bold' } },
      });
      y = doc.lastAutoTable.finalY + 4;
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(6);
      doc.setTextColor(...C.muted);
      doc.text(tx(`Los rangos de asentamiento mostrados ya están corregidos por el offset de TMN. La comparación usa el FdA efectivo (${fmtV(fdaVal)}).`), margin + 2, y);
      y += 4;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
    }

    // Zone badge + aptitude text
    const zona = sh.zona || (trab.zonaShilstone ? { zona: trab.zonaShilstone, nombre: trab.zonaShilstoneNombre } : null);
    const interp = kd.interpretacion || (trab.fdaInterpretacion ? { uso: trab.fdaInterpretacion, cono: trab.fdaConoEstimado } : null);
    if (zona) {
      // Decisión 2026-05-28: en DESCRIPTIVO el badge usa color neutro
      // azul-grisáceo (no verde/rojo de veredicto).
      let badgeColor;
      if (_modoNorm === 'NORMATIVO') {
        const zGreen = zona.zona === 'II' || zona.zona === 'III';
        const zRed = zona.zona === 'V' || zona.zona === 'I';
        badgeColor = zGreen ? C.green : zRed ? [220, 53, 69] : [253, 126, 20];
      } else {
        badgeColor = [100, 130, 160];
      }
      doc.setFillColor(...badgeColor);
      doc.roundedRect(margin + 2, y - 0.5, 50, 5, 1, 1, 'F');
      doc.setFontSize(7);
      doc.setFont('Helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(`Zona ${zona.zona} \u2014 ${zona.nombre || ''}`, margin + 27, y + 3, { align: 'center' });
      if (interp?.uso) {
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(7);
        // Check coherence: if FdA suggests a slump range far from the design target, note it
        const asentDisenoMm = resultado?.asentamientoDisenoMm || resultado?.asentamiento;
        const conoMinInterp = interp.conoMin != null ? Number(interp.conoMin) : null;
        const conoMaxInterp = interp.conoMax != null ? Number(interp.conoMax) : null;
        const asentNum = asentDisenoMm ? Number(asentDisenoMm) : null;
        const coherente = !asentNum || !conoMinInterp || (asentNum >= conoMinInterp - 20 && asentNum <= (conoMaxInterp || conoMinInterp + 40) + 20);
        // En DESCRIPTIVO el label cambia a "Tipo de hormigón esperado"
        // (descripción del comportamiento, no juicio sobre el diseño).
        const labelPrefix = _modoNorm === 'NORMATIVO' ? 'Aptitud' : 'Tipo de hormigón esperado';
        // En DESCRIPTIVO también omitimos la nota "verificar coherencia"
        // (es veredicto del sistema sobre el diseño del operador).
        if (coherente || _modoNorm === 'DESCRIPTIVO') {
          doc.setTextColor(...C.text);
          doc.text(tx(`${labelPrefix}: ${interp.uso}${interp.cono ? ' (Cono: ' + interp.cono + ')' : ''}`), margin + 55, y + 3);
        } else {
          doc.setTextColor(180, 120, 30);
          doc.text(tx(`${labelPrefix}: ${interp.uso} — asentamiento de dise\u00f1o ${asentNum} mm (verificar coherencia)`), margin + 55, y + 3);
        }
      }
      y += 7;
    }
    doc.setTextColor(...C.text);

    // I.2 Gr\u00e1fico de Shilstone
    if (fdgVal != null && fdtVal != null) {
      y += 3; // margen superior
      if (y > pageH - 110) { doc.addPage(); y = margin + 5; }
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      doc.text(dynSub(2, 'Gráfico de Shilstone'), margin + 2, y);
      y += 4;

      // ── Chart: Shilstone via svg2pdf.js (vector nativo) ──
      try {
        const { generarShilstoneSVG } = require('./shilstoneSvg');
        const _fdg = Number(fdgVal), _wf = Number(fdtVal);
        const svgStr = generarShilstoneSVG(_fdg, _wf, zona?.zona || '');

        const chartW = contentW - 4;
        const chartH = chartW * 440 / 720;

        // Try svg2pdf.js for vector output
        let usedVector = false;
        try {
          const { svg2pdf } = require('svg2pdf.js');
          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(svgStr, 'image/svg+xml');
          const svgEl = svgDoc.documentElement;
          await svg2pdf(svgEl, doc, { x: margin + 2, y, width: chartW, height: chartH });
          usedVector = true;
        } catch (vecErr) {
          console.warn('[shilstone] svg2pdf.js failed, falling back to Canvas:', vecErr.message);
        }

        // Fallback: Canvas rasterization at 4x DPI
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
          doc.addImage(cvs.toDataURL('image/png'), 'PNG', margin + 2, y, chartW, chartH);
        }

        y += chartH + 3;
      } catch (svgErr) {
        console.warn('[shilstone-svg] Error:', svgErr);
        // Fallback: minimal text display
        doc.setFontSize(7); doc.setTextColor(...C.text);
        doc.text(tx(`FdG: ${fmtV(fdgVal)}% | FdT: ${fmtV(fdtVal)}% | Zona: ${zona?.zona || '?'} (${zona?.nombre || ''})`), margin + 4, y);
        y += 5;
      }
      // Skip old jsPDF primitives chart
      if (false) {
      const cX = margin + 8;
      const cY = y;
      const cW = contentW - 20; // leave room for Y axis label on right
      const cH = 84; // +20% for better vertical distinction
      const gMin = 0, gMax = 100; // FdG range (full)
      const tMin = 22, tMax = 48; // FdT range

      // Mapping: X inverted (100 left, 0 right), Y normal
      const tpX = (g) => cX + ((gMax - g) / (gMax - gMin)) * cW;
      const tpY = (t) => cY + cH - ((t - tMin) / (tMax - tMin)) * cH;

      // Background
      doc.setFillColor(255, 255, 255);
      doc.rect(cX, cY, cW, cH, 'F');

      // ── Zone boundaries — Shilstone (1990) exact equations ──
      // lim_inf = 0.125 * FdG + 27.25 (lower limit Zone II)
      // lim_sup = 0.125 * FdG + 35.25 (upper limit Zone II)
      // These are the SAME equations used by getZone() in the backend.
      // The graph and the classification are now perfectly coherent.
      const band1At = (g) => 0.125 * g + 27.25; // lower limit
      const band2At = (g) => 0.125 * g + 35.25; // upper limit

      // ── Zone fills (using closed polygons for seamless fill) ──
      // Build polygon points for the band (upper boundary forward, lower boundary backward)
      const bandSteps = [];
      for (let g = 0; g <= 100; g += 1) bandSteps.push(g);

      // Zone II+III band (green, between Limite 1 and Limite 2)
      doc.setFillColor(210, 240, 215);
      doc.setDrawColor(210, 240, 215); // same as fill to avoid stroke artifacts
      doc.setLineWidth(0.05);
      // Draw as many small rects to fill seamlessly
      for (let i = 0; i < bandSteps.length - 1; i++) {
        const g1 = bandSteps[i], g2 = bandSteps[i + 1];
        const x1 = tpX(g1), x2 = tpX(g2);
        const y1t = tpY(band2At(g1)), y2t = tpY(band2At(g2));
        const y1b = tpY(band1At(g1)), y2b = tpY(band1At(g2));
        // Draw as two triangles forming a quad
        doc.triangle(x1, y1t, x2, y2t, x1, y1b, 'F');
        doc.triangle(x2, y2t, x2, y2b, x1, y1b, 'F');
      }

      // ── Grid ──
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.1);
      for (let g = 0; g <= 100; g += 10) doc.line(tpX(g), cY, tpX(g), cY + cH);
      for (let t = 22; t <= 48; t += 2) doc.line(cX, tpY(t), cX + cW, tpY(t));

      // ── Zone boundary lines (Shilstone 1990 formula) ──

      // Draw zone boundary lines — Shilstone 1990 (vectorial, exact)
      // Band upper (brown dashed) — straight line from band2At(0) to band2At(100)
      doc.setDrawColor(139, 69, 19);
      doc.setLineWidth(0.7);
      doc.setLineDash([2, 1]);
      doc.line(tpX(0), tpY(band2At(0)), tpX(100), tpY(band2At(100)));
      // Band lower (brown dashed)
      doc.line(tpX(0), tpY(band1At(0)), tpX(100), tpY(band1At(100)));
      doc.setLineDash([]);

      // Vertical FdG=75 (red — separates Zone I)
      doc.setDrawColor(255, 0, 0);
      doc.setLineWidth(0.6);
      doc.line(tpX(75), tpY(band1At(75) - 4), tpX(75), tpY(band2At(75) + 4));

      // Vertical FdG=45 (blue — separates Zone IV)
      doc.setDrawColor(0, 176, 240);
      doc.setLineWidth(0.6);
      doc.line(tpX(45), tpY(band1At(45) - 4), tpX(45), tpY(band2At(45) + 4));

      // 6-9. Optimo rectangle (green dashed)
      doc.setDrawColor(0, 176, 80);
      doc.setLineWidth(0.6);
      doc.setLineDash([1.5, 1]);
      // Superior: (52,39) to (68,37)
      doc.line(tpX(52), tpY(39), tpX(68), tpY(37));
      // Inferior: (52,35) to (68,33)
      doc.line(tpX(52), tpY(35), tpX(68), tpY(33));
      // Izquierda (FdG=68): (68,33) to (68,37)
      doc.line(tpX(68), tpY(33), tpX(68), tpY(37));
      // Derecha (FdG=52): (52,35) to (52,39)
      doc.line(tpX(52), tpY(35), tpX(52), tpY(39));
      doc.setLineDash([]);

      // Pavimentadora Deslizante removed (was a spurious horizontal line)

      // ── Border ──
      doc.setDrawColor(200, 130, 30);
      doc.setLineWidth(0.6);
      doc.rect(cX, cY, cW, cH, 'S');

      // ── Zone labels (positioned centered in each region) ──
      const zoneColor = [180, 80, 20]; // unified color for I, IV, V
      doc.setFont('Helvetica', 'bold');
      // IV Muy Fino — northwest (FdG high = left in inverted axis, FdT high = top)
      doc.setFontSize(8);
      doc.setTextColor(...zoneColor);
      doc.text('IV Muy Fino', tpX(85), tpY(45));
      // I Mal Graduado — far left (FdG ~96)
      doc.setFontSize(8);
      doc.setTextColor(...zoneColor);
      doc.text('I Mal Graduado', tpX(96), tpY(30));
      // II Deseable — well above Optimo rectangle, inclined
      doc.setFontSize(7);
      doc.setTextColor(0, 120, 50);
      doc.text('II Deseable', tpX(62), tpY(band2At(62) + 1.5), { angle: 10 });
      // III Óptima Dmáx ≤ 12,5 mm — center of zone III area
      doc.setFontSize(7);
      doc.setTextColor(0, 140, 60);
      doc.text('III \u00d3ptima', tpX(28), tpY(40.5));
      doc.text('Dmax <= 12,5 mm', tpX(28), tpY(39));
      // V Muy Grueso — below band, central-right area
      doc.setFontSize(8);
      doc.setTextColor(...zoneColor);
      doc.text('V Muy Grueso', tpX(50), tpY(25));
      // Óptima label inside dashed rect
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(5.5);
      doc.setTextColor(0, 140, 60);
      doc.text('\u00d3ptima', tpX(60), tpY(36), { align: 'center' });
      // Pavimentadora Deslizante — inside the green band, centered vertically
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(80, 110, 60);
      const pavFdg = 48;
      const pavFdt = 29.5;
      doc.text('Pavimentadora Deslizante', tpX(pavFdg), tpY(pavFdt), { align: 'center', angle: 16 });

      // ── Data point (smaller) ──
      const dpx = tpX(Number(fdgVal));
      const dpy = tpY(Number(fdtVal));
      doc.setFillColor(240, 200, 20);
      doc.setDrawColor(50, 50, 50);
      doc.setLineWidth(0.3);
      doc.circle(dpx, dpy, 1.2, 'FD');

      // ── Axis ticks ──
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.setTextColor(...C.text);
      for (let g = 100; g >= 0; g -= 10) {
        doc.text(String(g), tpX(g), cY + cH + 3, { align: 'center' });
      }
      for (let t = 22; t <= 48; t += 2) {
        doc.text(String(t), cX + cW + 2, tpY(t) + 1);
      }

      // Axis titles
      doc.setFontSize(6.5);
      doc.setFont('Helvetica', 'normal');
      doc.text('Factor de grosor (%)', cX + cW / 2, cY + cH + 7, { align: 'center' });
      // Y axis label (right side, vertical)
      doc.setFontSize(6);
      doc.setTextColor(...C.text);
      doc.text('Factor de trabajabilidad (%)', cX + cW + 8, cY + cH * 0.6, { angle: 90 });

      // ── Legend below ──
      y = cY + cH + 10;
      doc.setFontSize(6);
      doc.setFillColor(240, 200, 20);
      doc.circle(margin + 5, y - 0.5, 1.2, 'F');
      doc.setTextColor(...C.text);
      const fdtAridoVal = sh.factorTrabajabilidadArido ?? trab.shilstone?.factorTrabajabilidadArido;
      const fdtNote = fdtAridoVal != null && fdtAridoVal !== fdtVal
        ? ` (FdT solo aridos: ${fmtV(fdtAridoVal)}%, corregido por cementante: ${fmtV(fdtVal)}%)`
        : '';
      doc.text(tx(`Mezcla actual (FdG: ${fmtV(fdgVal)}% ; FdT: ${fmtV(fdtVal)}%${fdtNote}) \u2014 Zona ${zona?.zona || '\u2014'}`), margin + 8, y);
      y += 3;
      doc.setFontSize(5);
      doc.setTextColor(...C.muted);
      doc.text(tx('Shilstone, J.M. (1990) "Concrete Mixture Optimization"'), margin + 8, y);
      y += 4;
      } // end if(false) — old chart code
    }

    // I.3 Barra del Factor de Aptitud (FdA)
    if (fdaVal != null) {
      y += 5; // espacio antes del título
      if (y > pageH - 30) { doc.addPage(); y = margin + 5; }
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      doc.text(dynSub(3, 'Factor de Aptitud (Ken Day) *'), margin + 2, y);
      y += 3;
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(5.5);
      doc.setTextColor(...C.muted);
      doc.text(tx('* Rangos corregidos por TMN y actualizados para pr\u00e1ctica moderna. Ver Nota al pie de esta secci\u00f3n.'), margin + 4, y);
      y += 4;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);

      // Gauge bar
      const barX = margin + 2;
      const barW = contentW - 4;
      const barH = 6;
      const barY = y;

      // Gauge segments — always shown at base ranges (TMN 19 / no offset)
      // The FdA value is positioned on these base ranges for visual consistency
      // with the text interpretation. TMN correction is noted as footnote.
      const segments = [
        [0, 16, [239, 68, 68], 'Inutilizable'],
        [16, 20, [251, 146, 60], '\u00c1spera'],
        [20, 22, [250, 204, 21], 'Pisos'],
        [22, 24, [34, 197, 94], 'Estructural'],
        [24, 25, [21, 128, 61], 'Bombeable'],
        [25, 27, [34, 197, 94], 'B. fluido'],
        [27, 29, [130, 200, 100], 'Fluido'],
        [29, 31, [251, 146, 60], 'Exceso'],
      ];
      const gaugeMin = 0;
      const gaugeMax = 31;

      for (const [sMin, sMax, color, label] of segments) {
        const x1 = barX + ((sMin - gaugeMin) / (gaugeMax - gaugeMin)) * barW;
        const x2 = barX + ((sMax - gaugeMin) / (gaugeMax - gaugeMin)) * barW;
        doc.setFillColor(...color);
        doc.rect(x1, barY, x2 - x1, barH, 'F');
        // Label
        doc.setFontSize(4.5);
        doc.setTextColor(255, 255, 255);
        doc.setFont('Helvetica', 'bold');
        if (x2 - x1 > 8) {
          doc.text(label, x1 + (x2 - x1) / 2, barY + barH / 2 + 1, { align: 'center' });
        }
      }

      // Border
      doc.setDrawColor(100, 100, 100);
      doc.setLineWidth(0.3);
      doc.rect(barX, barY, barW, barH, 'S');

      // Tick labels below
      doc.setFontSize(5);
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
      for (const val of [0, 16, 20, 22, 25, 27, 31]) {
        const tx2 = barX + ((val - gaugeMin) / (gaugeMax - gaugeMin)) * barW;
        doc.text(String(val), tx2, barY + barH + 3, { align: 'center' });
      }

      // Marker (triangle pointing down)
      const fdaNum = Number(fdaVal);
      const markerX = barX + ((Math.min(Math.max(fdaNum, gaugeMin), gaugeMax) - gaugeMin) / (gaugeMax - gaugeMin)) * barW;
      doc.setFillColor(29, 78, 216);
      doc.triangle(markerX - 1.5, barY - 0.5, markerX + 1.5, barY - 0.5, markerX, barY + 1, 'F');
      // Label above marker
      doc.setFontSize(7);
      doc.setFont('Helvetica', 'bold');
      doc.setTextColor(29, 78, 216);
      doc.text(`FdA = ${fdaNum.toFixed(1).replace('.', ',')}`, markerX, barY - 2, { align: 'center' });

      y = barY + barH + 7;

      // Interpretation text — with coherence check against design slump
      const interp2 = kd.interpretacion || (trab.fdaInterpretacion ? { uso: trab.fdaInterpretacion, cono: trab.fdaConoEstimado } : null);
      if (interp2?.uso) {
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(7.5);
        const asentDisenoMm2 = resultado?.asentamientoDisenoMm || resultado?.asentamiento;
        const conoMin2 = interp2.conoMin != null ? Number(interp2.conoMin) : null;
        const conoMax2 = interp2.conoMax != null ? Number(interp2.conoMax) : null;
        const asentNum2 = asentDisenoMm2 ? Number(asentDisenoMm2) : null;
        const coh2 = !asentNum2 || !conoMin2 || (asentNum2 >= conoMin2 - 20 && asentNum2 <= (conoMax2 || conoMin2 + 40) + 20);
        if (coh2) {
          doc.setTextColor(...C.text);
          doc.text(tx(`Uso recomendado: ${interp2.uso}${interp2.cono ? ' (Cono: ' + interp2.cono + ')' : ''}`), margin + 4, y);
        } else {
          doc.setTextColor(180, 120, 30);
          doc.text(tx(`Uso recomendado: ${interp2.uso} — asentamiento de dise\u00f1o: ${asentNum2} mm`), margin + 4, y);
        }
        y += 4;
      }
    }

    // I.4 Coherencia con asentamiento objetivo
    // Normalize coherencia to { estado, mensaje } — it may be a string or an object
    let coherencia2 = null;
    const rawCoh = kd.coherencia || trab.coherencia;
    if (rawCoh && typeof rawCoh === 'object' && rawCoh.estado) {
      coherencia2 = rawCoh;
    } else if (rawCoh && typeof rawCoh === 'string') {
      const est = rawCoh;
      const msg = est === 'coherente' ? 'Coherente con el asentamiento objetivo.'
        : est === 'fda_alto' ? 'FdA sugiere asentamiento mayor al objetivo.'
        : est === 'fda_bajo' ? 'FdA sugiere asentamiento menor al objetivo.'
        : 'No evaluable.';
      coherencia2 = { estado: est, mensaje: msg };
    }
    if (coherencia2) {
      y += 5; // espacio antes del título
      if (y > pageH - 30) { doc.addPage(); y = margin + 5; }
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      doc.text(dynSub(4, 'Coherencia con asentamiento objetivo'), margin + 2, y);
      y += 5;

      const isOk = coherencia2.estado === 'coherente';
      const boxColor = isOk ? [220, 252, 231] : [254, 243, 199];
      const borderColor = isOk ? C.green : [253, 126, 20];
      doc.setFillColor(...boxColor);
      doc.setDrawColor(...borderColor);
      doc.setLineWidth(0.5);

      // Calculate box height based on content
      doc.setFontSize(7);
      const asentObj = resultado?.asentamientoMm || resultado?.asentamientoNominalCm ? resultado.asentamientoNominalCm * 10 : null;
      const cohMsg = coherencia2.mensaje || '';
      const cohLines = doc.splitTextToSize(tx(cohMsg), contentW - 12);
      const notaTmnText = trab.notaTmn || '';
      const notaLines = notaTmnText ? doc.splitTextToSize(tx(notaTmnText), contentW - 12) : [];
      const boxH = 8 + cohLines.length * 3 + (notaLines.length > 0 ? notaLines.length * 2.5 + 2 : 0);

      doc.roundedRect(margin + 2, y, contentW - 4, boxH, 1, 1, 'FD');

      let by = y + 4;
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...(isOk ? C.green : [253, 126, 20]));
      doc.text(isOk ? 'Coherencia verificada' : 'Discrepancia detectada', margin + 6, by);
      by += 4;

      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...C.text);
      for (const line of cohLines) { doc.text(line, margin + 6, by); by += 3; }

      if (notaLines.length > 0) {
        by += 1;
        doc.setFontSize(6);
        doc.setTextColor(...C.muted);
        doc.setFont('Helvetica', 'italic');
        for (const line of notaLines) { doc.text(line, margin + 6, by); by += 2.5; }
      }

      y += boxH + 2;
      doc.setTextColor(...C.text);
      doc.setFont('Helvetica', 'normal');
    }

    // Nota de discrepancia Shilstone vs FdA (si existe)
    const notaDiscrep = trab.notaDiscrepancia || traz?.trabajabilidad?.notaDiscrepancia;
    if (notaDiscrep) {
      if (y > pageH - 20) { doc.addPage(); y = margin + 5; }
      doc.setFillColor(254, 249, 235);
      doc.setDrawColor(180, 150, 50);
      doc.setLineWidth(0.4);
      doc.setFontSize(6.5);
      const discLines = doc.splitTextToSize(tx(notaDiscrep), contentW - 12);
      const discH = 4 + discLines.length * 2.5;
      doc.roundedRect(margin + 2, y, contentW - 4, discH, 1, 1, 'FD');
      doc.setFont('Helvetica', 'italic');
      doc.setTextColor(120, 100, 30);
      let dy = y + 3;
      for (const line of discLines) { doc.text(line, margin + 6, dy); dy += 2.5; }
      y += discH + 2;
      doc.setTextColor(...C.text);
      doc.setFont('Helvetica', 'normal');
    }

    // Nota de borde (cuando el punto está cerca del límite de zona)
    const notaBorde = trab.notaBorde || traz?.trabajabilidad?.notaBorde;
    if (notaBorde) {
      if (y > pageH - 12) { doc.addPage(); y = margin + 5; }
      doc.setFontSize(6.5);
      doc.setTextColor(120, 120, 40);
      doc.setFont('Helvetica', 'italic');
      const bordeLines = doc.splitTextToSize(tx(notaBorde), contentW - 8);
      for (const line of bordeLines) { doc.text(line, margin + 4, y); y += 2.5; }
      y += 2;
      doc.setTextColor(...C.text);
      doc.setFont('Helvetica', 'normal');
    }

    // FdT note (Shilstone correction)
    const notaWF = sh.notaWF || trab.shilstone?.notaWF;
    if (notaWF) {
      doc.setFontSize(6);
      doc.setTextColor(...C.muted);
      doc.setFont('Helvetica', 'italic');
      doc.text(tx(notaWF), margin + 4, y);
      y += 3;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
    }

    // Nota sobre el modelo
    y += 4; // espacio antes de la nota
    if (y > pageH - 45) { doc.addPage(); y = margin + 5; }
    const noteX = margin + 2;
    const noteW = contentW - 4;
    const noteLines = [
      'Nota sobre el modelo:',
      tx('Esta evaluaci\u00f3n se basa en el gr\u00e1fico de Shilstone (1990) y el Factor de Aptitud de Ken Day (2006),'),
      tx('con adaptaciones de HormiQual: (1) Correcci\u00f3n del FdA por TMN mediante offsets te\u00f3ricos (curvas Fuller).'),
      tx('(2) Rangos de asentamiento actualizados para pr\u00e1ctica moderna con superplastificantes policarboxilato.'),
      tx('Estas adaptaciones son estimaciones te\u00f3ricas orientativas que requieren validaci\u00f3n experimental.'),
    ];
    // Draw note box
    doc.setFillColor(245, 245, 250);
    doc.setDrawColor(180, 180, 200);
    doc.setLineWidth(0.3);
    const noteH = noteLines.length * 3.5 + 3;
    doc.rect(noteX, y, noteW, noteH, 'FD');
    // Left accent bar
    doc.setFillColor(100, 120, 180);
    doc.rect(noteX, y, 1.5, noteH, 'F');
    doc.setFontSize(5.5);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(80, 80, 100);
    doc.text(noteLines[0], noteX + 4, y + 3.5);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(100, 100, 120);
    for (let i = 1; i < noteLines.length; i++) {
      doc.text(noteLines[i], noteX + 4, y + 3.5 + i * 3.5);
    }
    y += noteH + 2;

    // Referencia ampliada
    doc.setFontSize(6);
    doc.setTextColor(...C.muted);
    doc.text('Referencias:', margin + 2, y);
    y += 3;
    doc.setFontSize(5.5);
    doc.text('Shilstone, J.M. (1990). "Concrete Mixture Optimization." Concrete International, Vol. 12, N. 6. ACI.', margin + 4, y);
    y += 2.5;
    doc.text('Day, K.W. (2006). Concrete Mix Design, Quality Control and Specification. 3ra ed., Taylor & Francis.', margin + 4, y);
    y += 2.5;
    doc.text(tx('Adaptaciones HormiQual: correcci\u00f3n por TMN (offsets Fuller) y rangos para pr\u00e1ctica moderna con superplastificantes.'), margin + 4, y);
    y += 3;
    doc.setTextColor(...C.text);
  }

  // ── I.5 Sugerencia de optimización granulométrica (si hay problemas de zona) ──
  const sugGran = resultado?.sugerenciaGranulometrica || traz?.sugerenciaGranulometrica;
  if (sugGran?.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 40);
    y = subHeader(doc, dynSub(5, 'Sugerencia de optimización granulométrica'), margin + 2, y);
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(tx('Se detect\u00f3 zona problem\u00e1tica. El optimizador calcul\u00f3 alternativas con los materiales disponibles.'), margin + 4, y);
    y += 5;

    for (const sug of sugGran) {
      y = checkBreak(doc, y, pageH, margin, 25);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.text);
      doc.text(`${sug.etiqueta || 'Alternativa ' + sug.ranking}`, margin + 4, y);
      y += 4;

      // Components table
      const compRows = sug.componentes.map(c => [c.nombre || 'Agregado', `${c.porcentaje}%`, c.tipo || '-']);
      doc.autoTable({
        startY: y,
        head: [['Material', '%', 'Tipo']],
        body: compRows,
        theme: 'grid',
        styles: { fontSize: 6.5, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: 0.2 },
        headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 80 }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 25, halign: 'center' } },
        margin: { left: margin + 4, right: margin },
      });
      y = doc.lastAutoTable.finalY + 3;

      // Indicators
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...C.text);
      const zona = sug.zona || '-';
      const zonaNombre = sug.zonaNombre || '-';
      const wf = sug.wf != null ? formatNumber(sug.wf, 1) : '-';
      const fdg = sug.fdg != null ? formatNumber(sug.fdg, 1) : '-';
      const mf = sug.mf != null ? formatNumber(sug.mf, 2) : '-';
      doc.text(`Zona: ${zona} (${zonaNombre}) | FdT: ${wf}% | FdG: ${fdg}% | MF: ${mf}`, margin + 4, y);
      y += 4;
    }

    doc.setFontSize(6);
    doc.setTextColor(...C.muted);
    doc.text(tx('Para aplicar, recalcular el dise\u00f1o con las nuevas proporciones. Cemento, agua y a/c no cambian.'), margin + 4, y);
    y += 5;
    doc.setTextColor(...C.text);
  }
  } // end showSection('trabajabilidad')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION H — Advertencias técnicas
  // ══════════════════════════════════════════════════════════════════════════════
  // Nota: uniqueWarnings se calcula siempre (aunque la sección se oculte) porque
  // el Anexo Técnico (Section J) lo reutiliza. El guard showSection solo controla
  // el render, no el cálculo.

  // Merge validación cruzada into warnings
  const validacionWarnings = validacionCruzada
    .filter((v) => v.resultado !== "OK")
    .map((v) => tx(`[Validación cruzada] ${v.detalle}`));

  // ── Automatic warnings for informational aditivo effects ──
  const _ADVERTENCIAS_EFECTO = {
    RETARDANTE: "El aditivo retardante puede afectar los tiempos de desencofrado y curado. Verificar compatibilidad con el programa de obra.",
    ACELERANTE_FRAGUE: "El acelerante de fraguado puede reducir la resistencia final. Verificar compatibilidad con requisitos de resistencia a 28 días.",
    ACELERANTE_ENDURECIMIENTO: "El acelerante de endurecimiento modifica la cinética de resistencia. Verificar el desarrollo de resistencia a edades tempranas y finales.",
    INCORPORADOR_AIRE: "El aire intencionalmente incorporado reduce la resistencia mecánica (~5% por cada 1% de aire). Verificar que la resistencia de diseño contemple esta reducción.",
    ANTICONGELANTE: "El aditivo anticongelante no exime del cumplimiento de las temperaturas mínimas de colocación y curado según CIRSOC 200:2024.",
    FIBRAS: "Las fibras no reemplazan la armadura estructural. Verificar su función específica (control de fisuración, tenacidad, resistencia al fuego, etc.).",
  };
  const aditivoWarnings = [];
  snapAditivos.forEach((item, idx) => {
    if (!item.modoEfecto || EFECTOS_CON_CALCULO.has(item.modoEfecto)) return;
    const warnText = _ADVERTENCIAS_EFECTO[item.modoEfecto];
    if (warnText) {
      const shortName = aditivoShortName(item.label) || `Aditivo ${idx + 1}`;
      aditivoWarnings.push(tx(`[${shortName}] ${warnText}`));
    }
  });

  // MEJ 6: Surface "no concluyente" items from aptitud de materiales as action items.
  // These are typically cloruros below detection limit (e.g. "< 0,01%") that can't be
  // verified against a stricter limit (e.g. 0,003%). Put them in warnings so the reader
  // sees a clear "Accion requerida" instead of digging into the aptitud table detalle.
  const aptitudActionWarnings = [];
  if (snapshot?.aptitudMateriales?.verificaciones?.length) {
    for (const verif of snapshot.aptitudMateriales.verificaciones) {
      for (const it of (verif.items || [])) {
        if (it.estado === 'no_concluyente' && it.detalle) {
          aptitudActionWarnings.push(tx(`[Acción requerida] ${fmtNombreMaterial(verif.agregadoNombre)} - ${it.parametro}: ${it.detalle}`));
        }
      }
    }
  }

  // ── Combine all warnings and deduplicate ──
  const absAlertsPrefixed = absorcionAlerts.map((a) => tx(`[absorción] ${a}`));
  // Normalize motor warnings (objects with {campo, msg}) to prefixed strings
  // Info-type notes get a special [info:campo] prefix for differentiated rendering
  const motorWarnings = (warnings || []).map(w => {
    if (typeof w === 'string') return w;
    const campo = w.campo || w.tipo || 'info';
    const msg = w.msg || w.mensaje || w.message || JSON.stringify(w);
    const prefix = w.tipo === 'info' ? `info:${campo}` : campo;
    return tx(`[${prefix}] ${msg}`);
  });
  const allWarnings = [...absAlertsPrefixed, ...motorWarnings, ...validacionWarnings, ...aditivoWarnings, ...aptitudActionWarnings];

  // Deduplicate by normalized base message (ignore category prefix)
  // Deduplication: strip prefix [tag], normalize, and also check for semantic overlap
  const _baseMsg = (s) => s.replace(/^\[[\w\s\-\.:]+\]\s*/i, "").toLowerCase().trim();
  const _seenBases = [];
  const _isSimilar = (a, b) => {
    if (a === b) return true;
    // Check if one contains the core of the other (>60% of the shorter)
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (longer.includes(shorter)) return true;
    // Check significant word overlap
    const wordsA = a.split(/\s+/).filter(w => w.length > 4);
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 4));
    if (wordsA.length === 0) return false;
    const overlap = wordsA.filter(w => wordsB.has(w)).length;
    return overlap / wordsA.length > 0.6;
  };
  const uniqueWarnings = allWarnings.filter((w) => {
    // P4: "Accion requerida" warnings are per-aggregate by construction — skip dedup
    // so each aggregate's specific action appears in the final list, not just one.
    if (/^\[Acci[oó]n requerida\]/i.test(w)) return true;
    const b = _baseMsg(w);
    if (_seenBases.some(seen => _isSimilar(seen, b))) return false;
    _seenBases.push(b);
    return true;
  });

  if (showSection('advertencias') && uniqueWarnings.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 40);
    y = sectionHeader(doc, dynTitle(tx(`Advertencias técnicas (${uniqueWarnings.length})`)), margin, y, contentW);
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);

    uniqueWarnings.forEach((w) => {
      y = checkBreak(doc, y, pageH, margin, 14);
      // Info-type notes (prefixed [info:...]) render in blue; others in amber
      const isInfo = /^\[info:/i.test(w);
      doc.setTextColor(...(isInfo ? C.blue : C.amber));
      // Strip internal [tag] prefixes — used for dedup but not for display
      const wClean = w.replace(/^\[[\w\s\-\.:áéíóúñü]+\]\s*/i, "");
      const bullet = isInfo ? 'i' : '-';
      const lines = doc.splitTextToSize(`${bullet} ${wClean}`, contentW - 4);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4.5 + 1;
    });
    doc.setTextColor(...C.text);
    y += 3;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION H2 — Aptitud de materiales (CIRSOC 200-2024 §3.2.3.3)
  // ══════════════════════════════════════════════════════════════════════════════
  // HRDC: la aptitud de materiales según CIRSOC 200 §3.2.3.3 (Tabla 3.4/3.6)
  // no aplica a hormigones livianos celulares; se omite.
  //
  // Decisión 2026-05-28: la sección K emite veredicto por sustancia
  // (cumple / no cumple Tabla 3.4 o 3.6) sobre el material en el contexto
  // del destino declarado. En modo DESCRIPTIVO el documento no juzga →
  // se omite. La caracterización del material ya está visible en otras
  // secciones; aptitud queda solo en NORMATIVO.
  if (!fueraDeCirsoc && _modoNorm === 'NORMATIVO' && showSection('aptitudMateriales')) {
  const aptitud = snapshot?.aptitudMateriales;
  if (aptitud && aptitud.verificaciones?.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 50);
    y = sectionHeader(doc, dynTitle(tx('Verificación de aptitud de materiales para el destino declarado')), margin, y, contentW);

    // ── Destino declarado + criterio aplicado ─────────────────────────────
    // La sección anterior presentaba "Condiciones: Expuesto a desgaste | Tipo: armado"
    // sin aclarar que ese era EL contexto de esta evaluación específica. Resultado:
    // cuando el destino implicaba desgaste, los "No cumple" de la tabla se leían
    // como veredicto absoluto sobre el material — contradiciendo la filosofía
    // prestacional de la portada.
    //
    // La nueva intro declara explícitamente el destino evaluado, el criterio
    // normativo aplicado, y el hecho de que el mismo material puede tener
    // una lectura diferente bajo otros destinos.
    const expuestoCtx = !!aptitud.contexto?.expuestoDesgaste;
    const aspectoCtx = !!aptitud.contexto?.aspectoSuperficialImportante;
    const armaduraCtx = String(aptitud.contexto?.tipoArmadura || 'armado').toLowerCase();
    const tipologiaRaw = String(snapshot?.tipologiaCodigo || snapshot?.tipologia?.codigo || '').toLowerCase();

    // Inferir un destino legible a partir de la tipología o los flags.
    // Los valores van después de los dos puntos en el panel de contexto y
    // siempre arrancan en mayúscula para uniformidad visual (pedido del
    // usuario 2026-05-27: "que empiece en mayúsculas").
    let destinoLabel;
    if (tipologiaRaw === 'pavimento') destinoLabel = 'Pavimento con desgaste superficial';
    else if (tipologiaRaw === 'rcc') destinoLabel = 'Hormigón compactado con rodillo (RCC)';
    else if (tipologiaRaw === 'hac') destinoLabel = 'Hormigón autocompactante';
    else if (tipologiaRaw === 'arquitectonico' || tipologiaRaw === 'arquitectónico') destinoLabel = 'Hormigón arquitectónico';
    else if (expuestoCtx) destinoLabel = 'Destino con desgaste superficial declarado';
    else destinoLabel = 'Hormigón estructural sin exigencia de desgaste superficial';

    const armaduraLabel = armaduraCtx === 'simple' ? 'Hormigón simple'
      : armaduraCtx === 'pretensado' ? 'Hormigón pretensado'
      : 'Hormigón armado';

    const criterioNocivas = expuestoCtx
      ? 'IRAM 1512 §5.2.2 criterio estricto: suma de sustancias nocivas <= 5,0% (destinos con desgaste superficial)'
      : 'IRAM 1512 §5.2.2 criterio estándar: suma de sustancias nocivas <= 7,0% (destinos sin desgaste superficial)';

    // Tipología seleccionada (trazable, formateada para el lector)
    const tipologiaNombre = fmtTipologiaLabel(
      snapshot?.tipologia?.nombre || snapshot?.tipologiaCodigo || null,
    );

    // Panel informativo destacando el contexto y mostrando los checkboxes
    // como datos de entrada trazables para reconstrucción futura.
    const destinoLines = [
      `Destino evaluado: ${destinoLabel}.`,
      `Tipo estructural: ${armaduraLabel}.`,
      ...(tipologiaNombre ? [`Tipología seleccionada: ${tipologiaNombre}.`] : []),
      `Configuración de evaluación: Expuesto a desgaste = ${expuestoCtx ? 'Sí' : 'No'} · Aspecto superficial importante = ${aspectoCtx ? 'Sí' : 'No'}.`,
      `Criterio normativo aplicado: ${criterioNocivas}.`,
      'Los veredictos de esta tabla corresponden a este destino. El mismo material puede tener una lectura diferente bajo otros destinos; esto no invalida su viabilidad técnica fuera del contexto evaluado.',
    ];
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(6.8);
    const destinoInnerW = contentW - 14;
    const wrapped = destinoLines.map(l => doc.splitTextToSize(tx(l), destinoInnerW));
    const totalLines = wrapped.reduce((a, lines) => a + lines.length, 0);
    const destinoBoxH = 5 + totalLines * 3 + 2;
    doc.setFillColor(245, 247, 250);
    doc.setDrawColor(180, 190, 210);
    doc.setLineWidth(0.25);
    doc.roundedRect(margin, y, contentW, destinoBoxH, 1.5, 1.5, 'FD');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(60, 80, 110);
    doc.text(tx('Contexto de evaluación'), margin + 4, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(70, 70, 80);
    let dy = y + 7.5;
    for (const lines of wrapped) {
      for (const line of lines) {
        doc.text(line, margin + 6, dy);
        dy += 3;
      }
    }
    y += destinoBoxH + 3;
    doc.setTextColor(...C.text);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);

    for (const verif of aptitud.verificaciones) {
      // ROUND-FINAL 4: reserve enough space for the WHOLE aggregate block so the
      // "Estado global" line never floats into the next page visually attached to
      // the wrong aggregate. Estimated size:
      //   - title gap + title (4 + 5)
      //   - table header + items (~5 + 4*rows)
      //   - footnotes (~3*footnotes, unknown yet, use 6 average)
      //   - "Estado global" + separator (8)
      //   - buffer (4)
      const _estNumItems = (verif.items || []).length;
      const _estBlockH = 4 + 5 + 5 + Math.max(_estNumItems * 4, 16) + 6 + 8 + 4;
      y = checkBreak(doc, y, pageH, margin, _estBlockH);
      // Margen superior antes del título de cada agregado. Sin este gap el
      // título "Agregado fino: X" quedaba pegado al cuadro de contexto o a
      // la tabla anterior (pedido del usuario 2026-05-27).
      y += 4;
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      const tipoLabel = verif.tipoAgregado === 'GRUESO' ? 'Agregado grueso' : 'Agregado fino';
      doc.text(tx(`${tipoLabel}: ${fmtNombreMaterial(verif.agregadoNombre)}`), margin + 2, y);
      y += 5;

      // Prompt 3 C9.5: labels preservados (vocabulario por celda \u2014 patr\u00f3n C9.3 (a)).
      // Colores migrados a categor\u00edas can\u00f3nicas v\u00eda helper:
      //   cumple         \u2192 APTO                    (verde)
      //   atencion       \u2192 APTITUD_CONDICIONADA    (naranja) [Fix B post-smoke]
      //                    Raz\u00f3n: el label "Atenci\u00f3n" en espa\u00f1ol carga con peso
      //                    de alerta. Mapearlo a APTO_CON_OBSERVACIONES (verde)
      //                    genera conflicto cognitivo "Atenci\u00f3n verde". El estado
      //                    sem\u00e1nticamente es "cumple pero requiere monitoreo o
      //                    acci\u00f3n contextual", que es exactamente conditionalPass.
      //                    Adem\u00e1s mantiene la hermandad visual hist\u00f3rica con
      //                    excepcion (ambos eran marr\u00f3n legacy, ambos quedan
      //                    naranja can\u00f3nico).
      //   no_cumple      \u2192 NO_APTO                 (rojo)
      //   no_concluyente \u2192 EVALUACI\u00d3N INCOMPLETA   (azul; antes era naranja)
      //   sin_dato       \u2192 muted (sin dato no tiene veredicto, color neutro)
      //   informativo    \u2192 INFORMATIVO             (gris)
      //   excepcion      \u2192 APTITUD_CONDICIONADA    (naranja; cumple bajo condici\u00f3n/excepci\u00f3n declarada)
      //   pendiente      \u2192 EVALUACI\u00d3N INCOMPLETA   (azul)
      const ESTADO_LABEL = { cumple: "Cumple", atencion: "Atenci\u00f3n", no_cumple: "No cumple", no_concluyente: "No concluyente", sin_dato: "Sin dato", informativo: "Info.", excepcion: "Excepci\u00f3n", pendiente: "Pendiente" };
      const ESTADO_COLOR = {
        cumple:         getCategoriaPdfColor(VEREDICTO.APTO),
        atencion:       getCategoriaPdfColor(VEREDICTO.APTITUD_CONDICIONADA),
        no_cumple:      getCategoriaPdfColor(VEREDICTO.NO_APTO),
        no_concluyente: getCategoriaPdfColor(VEREDICTO.EVALUACION_INCOMPLETA),
        sin_dato:       [107, 114, 128],
        informativo:    getCategoriaPdfColor(VEREDICTO.INFORMATIVO),
        excepcion:      getCategoriaPdfColor(VEREDICTO.APTITUD_CONDICIONADA),
        pendiente:      getCategoriaPdfColor(VEREDICTO.EVALUACION_INCOMPLETA),
      };
      const fmtLim = (v, dec) => { if (v == null) return "--"; const s = Number(v).toFixed(dec ?? (v < 1 ? 3 : 1)); return s.replace('.', ','); };
      const fmtVal = (v) => { if (v == null) return "--"; const s = typeof v === 'number' ? (v < 1 ? v.toFixed(3) : v.toFixed(2)) : String(v); return s.replace('.', ','); };

      // Collect footnotes from conditional limits
      const footnotes = [];
      const getFootnoteRef = (condicion) => {
        if (!condicion) return '';
        let idx = footnotes.indexOf(condicion);
        if (idx === -1) { footnotes.push(condicion); idx = footnotes.length - 1; }
        return ` (${idx + 1})`;
      };

      const aptHead = [tx("Sustancia"), tx("Límite"), tx("Resultado"), tx("Estado")];
      const aptBody = verif.items.map((it) => {
        const ref = it.condicion ? getFootnoteRef(it.condicion) : '';
        const paramText = tx(it.parametro) + ref;
        const limText = it.informativo ? "--" : it.cualitativo ? `< ${fmtLim(it.max)} ${it.unidad}` : it.max != null ? `<= ${fmtLim(it.max)} ${it.unidad}` : "--";
        const valText = it.valor != null ? `${fmtVal(it.valor)} ${it.unidad || ""}`.trim() : "--";
        // Pedido del usuario: si Cumple, Cumple. Sin matiz de "cerca del límite"
        // (antes se anexaba "(NN% del límite)" cuando el resultado estaba al
        // 90% o más del valor máximo). El motor sigue calculando
        // `it.alertaProximidad` para uso en otros canales si fuera útil.
        const estText = ESTADO_LABEL[it.estado] || "?";
        return [paramText, tx(limText), tx(valText), tx(estText)];
      });

      doc.autoTable({
        startY: y,
        head: [aptHead],
        body: aptBody,
        margin: { left: margin, right: margin },
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 1.5, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2, font: "Helvetica" },
        headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: "bold", halign: "center" },
        columnStyles: { 0: { cellWidth: 65 }, 1: { halign: "right", cellWidth: 35 }, 2: { halign: "right", cellWidth: 30, fontStyle: "bold" }, 3: { halign: "center", cellWidth: 20 } },
        didParseCell: (data) => {
          if (data.section === "body" && data.column.index === 3) {
            // Color del estado según veredicto canónico, sin matiz por
            // proximidad (un Cumple es Cumple verde aunque esté al 97% del
            // límite — pedido explícito del usuario).
            const raw = data.cell.raw;
            for (const [key, color] of Object.entries(ESTADO_COLOR)) {
              if (raw === tx(ESTADO_LABEL[key])) { data.cell.styles.textColor = color; break; }
            }
          }
        },
      });
      y = doc.lastAutoTable.finalY + 4;

      // Render footnotes
      if (footnotes.length > 0) {
        doc.setFont("Helvetica", "italic");
        doc.setFontSize(6);
        doc.setTextColor(...C.muted);
        for (let i = 0; i < footnotes.length; i++) {
          y = checkBreak(doc, y, pageH, margin, 5);
          doc.text(tx(`(${i + 1}) ${footnotes[i]}`), margin + 2, y);
          y += 3;
        }
        y += 2;
      }

      // ── Nota contextual sobre el criterio IRAM 1512 (solo AF) ───────────
      // Si el veredicto del ítem "suma de sustancias nocivas" depende del flag
      // de desgaste (es decir, cambiaría bajo el otro destino), imprimimos una
      // nota explicativa debajo de la tabla. Esto evita que un "No cumple"
      // específico del destino con desgaste se lea como sentencia absoluta
      // sobre el material.
      if (verif.tipoAgregado === 'FINO') {
        const sumaItem = (verif.items || []).find(it => {
          const k = String(it.key || it.parametro || '').toLowerCase();
          return k.includes('suma') && k.includes('nociv');
        });
        if (sumaItem && sumaItem.valor != null) {
          const sumaVal = Number(sumaItem.valor);
          const contextual = [];
          if (expuestoCtx && sumaVal > 5.0 && sumaVal <= 7.0) {
            contextual.push(
              `Lectura alternativa para otros destinos: con ${formatNumber(sumaVal, 2, true)}%, el material cumpliría el criterio estándar IRAM 1512 de 7,0% aplicable a hormigones sin desgaste superficial. La no conformidad arriba es específica del destino declarado (${destinoLabel}); no invalida el uso del material fuera de ese contexto.`
            );
          } else if (!expuestoCtx && sumaVal > 5.0 && sumaVal <= 7.0) {
            contextual.push(
              `Lectura alternativa para destinos con desgaste: con ${formatNumber(sumaVal, 2, true)}%, el material superaría el criterio estricto IRAM 1512 de 5,0% aplicable a destinos con desgaste superficial. Para el destino declarado (${destinoLabel}) el resultado está dentro del límite; el material no debería utilizarse tal cual en pavimentos u obras con desgaste.`
            );
          } else if (expuestoCtx && sumaVal > 7.0) {
            contextual.push(
              `Nota IRAM 1512: con ${formatNumber(sumaVal, 2, true)}%, el material supera ambos límites (5,0% con desgaste y 7,0% sin desgaste). No se trata de una lectura dependiente del destino: requiere sustitución o tratamiento del fino.`
            );
          }
          if (contextual.length) {
            doc.setFont('Helvetica', 'italic');
            doc.setFontSize(6.3);
            doc.setTextColor(90, 95, 110);
            const notaInnerW = contentW - 14;
            for (const nota of contextual) {
              const nlines = doc.splitTextToSize(tx(nota), notaInnerW);
              const nH = nlines.length * 2.8 + 2;
              y = checkBreak(doc, y, pageH, margin, nH + 2);
              // Barra vertical izquierda para indicar que es nota contextual
              doc.setDrawColor(180, 190, 210);
              doc.setLineWidth(0.4);
              doc.line(margin + 2, y - 0.5, margin + 2, y + nH - 2);
              let ny = y + 1.5;
              for (const line of nlines) {
                doc.text(line, margin + 5, ny);
                ny += 2.8;
              }
              y += nH + 1;
            }
            doc.setTextColor(...C.text);
            doc.setFont('Helvetica', 'normal');
            doc.setFontSize(7);
          }
        }
      }

      // Estado global del agregado — consolidación honesta
      const items = verif.items || [];
      let cumpleCount = 0, noCumpleCount = 0, noConclCount = 0, sinDatoCount = 0, infoCount = 0;
      for (const it of items) {
        const e = (it.estado || '').toLowerCase();
        if (e === 'cumple') cumpleCount++;
        else if (e === 'no_cumple') noCumpleCount++;
        else if (e === 'no_concluyente') noConclCount++;
        else if (e === 'sin_dato' || e === 'pendiente') sinDatoCount++;
        else if (e === 'informativo') infoCount++;
      }
      // Prompt 3 C9.5: estado global del bloque (per-agregado dentro de aptitud).
      // Labels descriptivos preservados; color canónico vía helper. Mismo patrón
      // que los items individuales arriba.
      let globalEstado, globalColor, globalMsg;
      if (noCumpleCount > 0) {
        globalEstado = 'No cumple'; globalColor = getCategoriaPdfColor(VEREDICTO.NO_APTO);
        const parts = [`${noCumpleCount} incumplido(s)`];
        if (noConclCount > 0) parts.push(`${noConclCount} no concluyente(s)`);
        if (sinDatoCount > 0) parts.push(`${sinDatoCount} sin dato`);
        globalMsg = parts.join('; ') + '.';
      } else if (noConclCount > 0 || sinDatoCount > 0) {
        globalEstado = 'Cumple con observaciones'; globalColor = getCategoriaPdfColor(VEREDICTO.APTO_CON_OBSERVACIONES);
        const parts = [];
        if (cumpleCount > 0) parts.push(`${cumpleCount} cumple(n)`);
        if (noConclCount > 0) parts.push(`${noConclCount} no concluyente(s)`);
        if (sinDatoCount > 0) parts.push(`${sinDatoCount} sin dato`);
        globalMsg = parts.join('; ') + '.';
      } else if (cumpleCount > 0) {
        globalEstado = 'Cumple'; globalColor = getCategoriaPdfColor(VEREDICTO.APTO);
        globalMsg = `${cumpleCount} requisito(s) verificado(s).`;
      } else {
        globalEstado = 'Sin verificaciones'; globalColor = [107, 114, 128];
        globalMsg = 'No hay verificaciones disponibles.';
      }
      // ROUND-FINAL 4: keep "Estado global" visually anchored to the aggregate block.
      // Two measures: (a) always reserve enough space to draw the whole block plus
      // a small separator, so a page break never splits header + table + state;
      // (b) repeat the aggregate name in the state label so, even if the PDF viewer
      // renders an unexpected break, the reader cannot confuse it with the next block.
      y = checkBreak(doc, y, pageH, margin, 14);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...globalColor);
      const _tipoAg = verif.tipoAgregado === 'GRUESO' ? 'AG' : 'AF';
      const _nombreLimpio = fmtNombreMaterial(verif.agregadoNombre);
      const _nombreCorto = _nombreLimpio.length > 35 ? _nombreLimpio.substring(0, 32) + '...' : _nombreLimpio;
      doc.text(tx(`Estado global [${_tipoAg} ${_nombreCorto}]: ${globalEstado} \u2014 ${globalMsg}`), margin + 2, y);
      y += 5;
      // Thin horizontal rule after each aggregate block to reinforce visual separation
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.line(margin, y, pageW - margin, y);
      y += 3;
      doc.setTextColor(...C.text);
    }
    doc.setTextColor(...C.text);
    y += 3;

    // ── Cloruros totales a nivel hormigón (CIRSOC 200:2024 art. 2.2.8) ──
    if (aptitud?.verificaciones?.length > 0 && resultado?.agregados?.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 35);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      doc.text(tx('Cloruros solubles totales en el hormig\u00f3n (CIRSOC 200:2024 art. 2.2.8)'), margin + 2, y);
      y += 5;

      const tipoArm = (snapshot?.tipoArmadura || 'armado').toUpperCase();
      const limiteCl = tipoArm === 'PRETENSADO' ? 0.10 : tipoArm === 'SIMPLE' ? 0.60 : 0.30;
      const limiteLabel = tipoArm === 'PRETENSADO' ? 'Pretensado' : tipoArm === 'SIMPLE' ? 'Simple' : 'Armado';

      // Calculate Cl contribution from each aggregate
      const clRows = [];
      let clTotal = 0;
      let datosIncompletos = false;

      // Build maps for Cl% lookup from aptitud verificaciones
      const clByTipo = {}; // tipoAgregado → { valor, operador }
      for (let vi = 0; vi < (aptitud?.verificaciones || []).length; vi++) {
        const v = aptitud.verificaciones[vi];
        const clItem = (v.items || []).find(it => {
          const k = (it.codigo || it.key || it.ensayoCodigo || it.parametro || '').toUpperCase();
          return k.includes('CLORURO') || k.includes('CHLOR') || k === 'CL';
        });
        if (clItem?.valor != null) {
          const tipo = (v.tipoAgregado || '').toUpperCase();
          const esMenor = clItem.estado === 'no_concluyente' || String(clItem.valor).startsWith('<') || (typeof clItem.valor === 'string' && clItem.valor.includes('<'));
          const esMayor = String(clItem.valor).startsWith('>') || (typeof clItem.valor === 'string' && clItem.valor.includes('>'));
          const operador = esMenor ? 'menor_que' : esMayor ? 'mayor_que' : null;
          if (!clByTipo[tipo]) clByTipo[tipo] = { valor: Number(String(clItem.valor).replace(/[<>=\s]/g, '')), operador };
        }
      }

      for (const ag of (resultado.agregados || [])) {
        // Find Cl% — try multiple strategies
        let clPct = null;
        const agId = ag.id || ag.idAgregado || ag.legacyAgregadoId;
        const agName = (ag.nombre || '').toLowerCase().trim();

        // Strategy 1: match by ID or name in verificaciones
        for (const v of (aptitud.verificaciones || [])) {
          const vId = v.idMaterial || v.legacyAgregadoId;
          const vName = (v.nombreMaterial || '').toLowerCase().trim();
          const idMatch = agId && vId && String(agId) === String(vId);
          const nameMatch = agName && vName && (agName === vName || agName.includes(vName) || vName.includes(agName));
          if (idMatch || nameMatch) {
            for (const it of (v.items || [])) {
              const itId = (it.codigo || it.key || it.ensayoCodigo || it.parametro || '').toUpperCase();
              if (itId.includes('CLORURO') || itId.includes('CHLOR') || itId === 'CLORUROS') {
                clPct = it.valor ?? it.resultado ?? it.resultadoValor ?? null;
                if (clPct != null) break;
              }
            }
            if (clPct != null) break;
          }
        }
        // Strategy 2: fallback — match by aggregate type (FINO/GRUESO)
        let clOperador = null;
        if (clPct == null) {
          const agTipo = (ag.tipo || ag.tipoAgregado || '').toUpperCase();
          const isFino = agTipo === 'FINO' || agTipo === 'FINE' ||
            (ag.moduloFinura != null && ag.moduloFinura < 4) ||
            (agName && (agName.includes('arena') || agName.includes('sand')));
          const tipo = isFino ? 'FINO' : 'GRUESO';
          if (clByTipo[tipo] != null) {
            clPct = clByTipo[tipo].valor;
            clOperador = clByTipo[tipo].operador || null;
          }
        }
        const kgM3 = ag.kgM3 || 0;
        const aporte = clPct != null && kgM3 > 0 ? (clPct / 100) * kgM3 : null;
        if (aporte != null) clTotal += aporte; else datosIncompletos = true;
        const opPfx = clOperador === 'menor_que' ? '<= ' : clOperador === 'mayor_que' ? '>= ' : '';
        const clLabel = clPct != null ? `${opPfx}${formatNumber(clPct, 3)} %` : 'N/D';
        const aporteLabel = aporte != null ? (opPfx ? `${opPfx}${formatNumber(aporte, 3)}` : formatNumber(aporte, 3)) : 'N/D';
        clRows.push([ag.nombre || 'Agregado', clLabel, `${formatNumber(kgM3, 0)}`, aporteLabel]);
      }

      // Cement and water — always N/D (no Cl data available for these)
      // Worst-case estimation: assume Cl = 0.010% for N/D components (standard upper bound
      // for portland cement and potable water per typical industry practice).
      const CL_ASUMIDO_ND = 0.010; // %
      const cementoKgM3 = resultado.cementoTotalKgM3 || resultado.cementoKgM3 || 0;
      const aguaKgM3 = resultado.aguaLtsM3 || 0; // 1 L ≈ 1 kg for water
      clRows.push([tx('Cemento'), 'N/D', `${formatNumber(cementoKgM3, 0)}`, 'N/D']);
      clRows.push([tx('Agua'), 'N/D', `${formatNumber(aguaKgM3, 1)}`, 'N/D']);
      datosIncompletos = true; // Cemento y agua siempre son N/D → total siempre es parcial

      // Total parcial (only known data)
      const clTotalRound = Math.round(clTotal * 1000) / 1000;

      // Worst-case total: parcial + assumed Cl for all N/D components
      const clAporteND = (CL_ASUMIDO_ND / 100) * (cementoKgM3 + aguaKgM3);
      const clTotalMax = Math.round((clTotal + clAporteND) * 1000) / 1000;

      const componentesND = ['cemento', 'agua'];
      // Determine state using worst-case logic:
      // - total_max ≤ límite → CUMPLE (even considering N/D)
      // - total_parcial ≤ límite but total_max > límite → CUMPLE CON DATOS DISPONIBLES
      // - total_parcial > límite → NO CUMPLE
      // Prompt 3 C9.5: tres estados de cloruros con etiquetas descriptivas que
      // citan la condición específica (worst-case / con datos / no cumple).
      // Labels preservados (informativos para el ingeniero); colores migrados
      // al canónico:
      //   NO_CUMPLE         → NO_APTO                  (rojo, bloqueante)
      //   CUMPLE_WORST_CASE → APTO                     (verde puro; cumple incluso con estimación pesimista)
      //   CUMPLE_CON_DATOS  → APTO_CON_OBSERVACIONES   (verde con matiz; cumple sólo con datos disponibles, no con worst-case)
      let clEstado, clEstadoColor, clEstadoLabel;
      if (clTotalRound > limiteCl) {
        clEstado = 'NO_CUMPLE'; clEstadoColor = getCategoriaPdfColor(VEREDICTO.NO_APTO); clEstadoLabel = 'NO CUMPLE';
      } else if (clTotalMax <= limiteCl) {
        clEstado = 'CUMPLE_WORST_CASE'; clEstadoColor = getCategoriaPdfColor(VEREDICTO.APTO); clEstadoLabel = 'CUMPLE (incluso con estimación conservadora)';
      } else {
        clEstado = 'CUMPLE_CON_DATOS'; clEstadoColor = getCategoriaPdfColor(VEREDICTO.APTO_CON_OBSERVACIONES); clEstadoLabel = 'CUMPLE CON DATOS DISPONIBLES';
      }

      // Build table body
      const clSummaryRows = [
        [{ content: 'TOTAL HORMIGÓN (parcial)', styles: { fontStyle: 'bold' } }, '', '', { content: `${formatNumber(clTotalRound, 3)} kg/m³`, styles: { fontStyle: 'bold' } }],
        [{ content: 'TOTAL MÁXIMO ESTIMADO', styles: { fontStyle: 'bold', textColor: [100, 80, 20] } }, { content: `${formatNumber(CL_ASUMIDO_ND, 3)} % *`, colSpan: 1, styles: { fontSize: 6, textColor: [120, 100, 30] } }, '', { content: `${formatNumber(clTotalMax, 3)} kg/m³`, styles: { fontStyle: 'bold', textColor: [100, 80, 20] } }],
        [{ content: `Límite (${limiteLabel})`, styles: { fontStyle: 'bold' } }, '', '', { content: `${formatNumber(limiteCl, 2)} kg/m³`, styles: { fontStyle: 'bold' } }],
        [{ content: 'Estado', styles: { fontStyle: 'bold' } }, '', '', { content: clEstadoLabel, styles: { fontStyle: 'bold', textColor: clEstadoColor } }],
      ];

      doc.autoTable({
        startY: y,
        head: [['Componente', 'Cl (%)', 'kg/m³', 'Cl aportado (kg/m³)']],
        body: [...clRows, ...clSummaryRows],
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.5, lineColor: [200, 200, 200], lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 7 },
        margin: { left: margin, right: margin },
        columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 25, halign: 'center' }, 2: { cellWidth: 25, halign: 'center' }, 3: { cellWidth: 35, halign: 'center' } },
      });
      y = doc.lastAutoTable.finalY + 4;

      // Footnote with worst-case explanation
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(6);
      doc.setTextColor(120, 100, 30);
      if (clEstado === 'CUMPLE_WORST_CASE') {
        const noteLines = doc.splitTextToSize(tx(
          `* Estimación conservadora: se asume Cl = ${formatNumber(CL_ASUMIDO_ND, 3)}% para componentes sin dato declarado ` +
          '(cemento portland y agua potable). Este valor corresponde al límite superior típico para estos materiales según práctica estándar. ' +
          'El total máximo estimado no supera el límite normativo.'
        ), contentW - 8);
        for (const line of noteLines) { doc.text(line, margin + 2, y); y += 2.5; }
      } else if (clEstado === 'CUMPLE_CON_DATOS') {
        const noteLines = doc.splitTextToSize(tx(
          `* Estimación conservadora: se asume Cl = ${formatNumber(CL_ASUMIDO_ND, 3)}% para componentes sin dato declarado ` +
          '(cemento portland y agua potable). El total parcial cumple, pero el total máximo estimado podría superar el límite ' +
          'si los componentes sin dato aportan cloruros significativos.'
        ), contentW - 8);
        for (const line of noteLines) { doc.text(line, margin + 2, y); y += 2.5; }
      }
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
      y += 1;

      if (clEstado === 'NO_CUMPLE') {
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(220, 38, 38);
        doc.text(tx('Cl total en hormig\u00f3n excede l\u00edmite CIRSOC 200:2024 art. 2.2.8.'), margin + 2, y);
        y += 4;
      }

      // ROUND-X Priority 7: Always show the global vs individual reminder when
      // any aggregate has non-conclusive or non-conforming chloride status, regardless
      // of the global verdict. This prevents the "CUMPLE" verdict from masking the
      // need for more precise individual tests.
      {
        const aggIssues = aptitud?.verificaciones?.filter(v => v.items?.some(it => {
          const k = (it.codigo || it.key || it.ensayoCodigo || '').toUpperCase();
          return k.includes('CLORURO') && (it.estado === 'no_cumple' || it.estado === 'no_concluyente');
        })) || [];
        if (aggIssues.length > 0) {
          const nombres = aggIssues.map(v => fmtNombreMaterial(v.agregadoNombre)).join(', ');
          const sujeto = aggIssues.length === 1 ? 'el agregado' : 'los agregados';
          const verbo = aggIssues.length === 1 ? 'presenta' : 'presentan';
          const noteText = `Importante: la verificación global del hormigón resulta CUMPLE, pero ${sujeto} ${nombres} ${verbo} un ensayo de cloruros NO CONCLUYENTE por límite de detección insuficiente. Las verificaciones global e individual son complementarias: el cumplimiento global no reemplaza la necesidad de solicitar ensayos individuales más precisos (límite de detección <= 0,003%) antes de liberar el diseño.`;
          // IMPORTANTE: activar el font/size del body ANTES de splitTextToSize
          // para que el wrap use el ancho de carácter correcto.
          doc.setFont('Helvetica', 'normal');
          doc.setFontSize(6.5);
          const noteLines = doc.splitTextToSize(tx(noteText), contentW - 14);
          const noteH = 8 + noteLines.length * 3 + 3;
          doc.setFillColor(255, 248, 225);
          doc.setDrawColor(245, 158, 11);
          doc.setLineWidth(0.3);
          doc.roundedRect(margin, y, contentW, noteH, 1.5, 1.5, 'FD');
          doc.setFont('Helvetica', 'bold');
          doc.setFontSize(7);
          doc.setTextColor(180, 120, 30);
          doc.text(tx('Verificación global vs individual'), margin + 4, y + 4.5);
          doc.setFont('Helvetica', 'normal');
          doc.setFontSize(6.5);
          doc.setTextColor(80, 80, 80);
          let ny = y + 9;
          for (const line of noteLines) { doc.text(line, margin + 4, ny); ny += 3; }
          y += noteH + 3;
        }
      }
      doc.setTextColor(...C.text);
      y += 3;
    }
  }
  } // end showSection('aptitudMateriales')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION I — Receta de obra (corrección por humedad)
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('recetaObra')) {
  const correccionHumedad = snapshot?.correccionHumedad;
  // Always show correction section — as template if no humidity data
  const agregadosDosif = traz?.agregadosDistribucion?.items || resultado?.agregados || [];
  if ((correccionHumedad && correccionHumedad.items?.length) || agregadosDosif.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 50);
    y = sectionHeader(doc, dynTitle(tx('Receta de obra — Corrección por humedad')), margin, y, contentW);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.text);

    if (correccionHumedad?.items?.length) {
      // With humidity data — show calculated correction
      const correccionSign = correccionHumedad.deltaAguaTotal > 0 ? "-" : "+";
      doc.text(tx(
        `Agua de dise\u00f1o (SSS): ${formatNumber(resultado.aguaLtsM3, 1)} L/m\u00b3   |   ` +
        `Correcci\u00f3n: ${correccionSign}${formatNumber(Math.abs(correccionHumedad.deltaAguaTotal), 1)} L/m\u00b3   |   ` +
        `Agua a agregar en obra: ${formatNumber(correccionHumedad.aguaObra, 1)} L/m\u00b3`
      ), margin + 2, y);
      y += 6;

      const hHead = [tx("Agregado"), tx("kg/m\u00b3 (SSS)"), tx("Abs. %"), tx("Hum. %"), tx("Corr. Agua (L)"), tx("kg/m\u00b3 (natural)")];
      const hBody = correccionHumedad.items
        // Livianos manufacturados no participan de la correcci\u00f3n por humedad.
        .filter((it) => !(it.esLiviano === true || it.tipo === 'LIVIANO' || it.tipoAgregado === 'LIVIANO'))
        .filter((it) => it.humedadPct != null)
        .map((it) => [
          tx(it.nombre || "\u2014"),
          it.kgSSS != null ? formatNumber(it.kgSSS, 0) : "\u2014",
          it.absorcionPct != null ? formatParamValue('absorcion', it.absorcionPct) : "\u2014",
          formatNumber(it.humedadPct, 2),
          it.deltaAgua != null ? `${it.deltaAgua > 0 ? "-" : "+"}${formatNumber(Math.abs(it.deltaAgua), 1)}` : "-",
          it.kgNatural != null ? formatNumber(it.kgNatural, 0) : "\u2014",
        ]);

      if (hBody.length > 0) {
      doc.autoTable({
        startY: y,
        head: [hHead],
        body: hBody,
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 1.5, textColor: C.text },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
        alternateRowStyles: { fillColor: C.light },
        margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
        columnStyles: {
          1: { halign: "right" },
          2: { halign: "right" },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
        },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    // Receta de obra summary
    y = checkBreak(doc, y, pageH, margin, 20);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...C.primary);
    doc.text(tx("Receta de obra (por m³):"), margin + 2, y);
    y += 5;
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.text);
    const recetaLines = [
      `Agua: ${formatNumber(correccionHumedad.aguaObra, 1)} L/m³`,
      `Cemento: ${formatNumber(resultado.cementoTotalKgM3 ?? resultado.cementoKgM3, 0)} kg/m³`,
    ];
    if (resultado.adicion1KgM3) recetaLines.push(`Adición 1: ${formatNumber(resultado.adicion1KgM3, 0)} kg/m³`);
    if (resultado.adicion2KgM3) recetaLines.push(`Adición 2: ${formatNumber(resultado.adicion2KgM3, 0)} kg/m³`);
    // MEJ-3: Include aditivos in receta de obra
    snapAditivos.forEach((item, idx) => {
      const trazItem = trazAditivos[idx] || {};
      if (trazItem.kgM3 != null) {
        const shortLabel = aditivoShortName(item.label) || `Aditivo ${idx + 1}`;
        recetaLines.push(`${shortLabel}: ${formatNumber(trazItem.kgM3, 2)} kg/m³`);
      }
    });
    if (resultado?.fibras?.macrofibra?.dosisKgM3) {
      const f = resultado.fibras.macrofibra;
      recetaLines.push(`Macrofibra${f.nombre ? ` ${f.nombre}` : ""}: ${formatNumber(f.dosisKgM3, 3)} kg/m³`);
    }
    if (resultado?.fibras?.microfibra?.dosisKgM3) {
      const f = resultado.fibras.microfibra;
      recetaLines.push(`Microfibra${f.nombre ? ` ${f.nombre}` : ""}: ${formatNumber(f.dosisKgM3, 3)} kg/m³`);
    }
    correccionHumedad.items.forEach((it) => {
      if (it.kgNatural != null) {
        recetaLines.push(`${it.nombre}: ${formatNumber(it.kgNatural, 0)} kg/m³ (húmedo natural)`);
      }
    });
    recetaLines.forEach((line) => {
      doc.text(tx(line), margin + 4, y);
      y += 4.5;
    });
    y += 3;

    } else {
      // Template en blanco — sin datos de humedad
      doc.setFont("Helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      // Envolver con splitTextToSize para que no se desborde por la derecha.
      const tplIntro = 'Completar con humedad real antes de cada bachada. Peso obra = Peso SSS x (100 + h%) / (100 + Abs%). Agua obra = Agua SSS - suma de correcciones por humedad.';
      const tplIntroLines = doc.splitTextToSize(tx(tplIntro), contentW - 4);
      for (const line of tplIntroLines) {
        doc.text(line, margin + 2, y);
        y += 3.5;
      }
      y += 1.5;
      doc.text(tx(`Agua de dise\u00f1o (SSS): ${formatNumber(resultado.aguaLtsM3, 1)} L/m\u00b3`), margin + 2, y);
      y += 5;

      const tplHead = ['Componente', 'kg/m\u00b3 (SSS)', 'Abs. %', 'Hum. % (medir)', 'kg/m\u00b3 (obra)', 'Corr. Agua (L)'];
      // Excluir agregados livianos manufacturados (telgopor en perlas, EPS,
      // perlita): no tienen absorci\u00f3n ni humedad p\u00e9trea, no participan de la
      // correcci\u00f3n por humedad. Se cargan manualmente en planta.
      const agregadosPetreos = agregadosDosif.filter(ag => !(ag.esLiviano === true || ag.tipo === 'LIVIANO' || ag.tipoAgregado === 'LIVIANO'));
      const tplBody = agregadosPetreos.map(ag => [
        tx(ag.nombre || '\u2014'),
        ag.kgM3 != null ? formatNumber(ag.kgM3, 0) : '\u2014',
        ag.absorcionPct != null ? formatParamValue('absorcion', ag.absorcionPct) : '\u2014',
        '\u2014',
        '\u2014',
        '\u2014',
      ]);
      // Fila informativa por cada agregado liviano: se carga manual, sin correcci\u00f3n.
      const agregadosLivianos = agregadosDosif.filter(ag => ag.esLiviano === true || ag.tipo === 'LIVIANO' || ag.tipoAgregado === 'LIVIANO');
      agregadosLivianos.forEach(ag => {
        tplBody.push([
          tx(`${ag.nombre || 'Material liviano'} (carga manual)`),
          ag.kgM3 != null ? formatNumber(ag.kgM3, 1) : '\u2014',
          'N/A',
          'N/A',
          ag.kgM3 != null ? formatNumber(ag.kgM3, 1) : '\u2014',
          'N/A',
        ]);
      });
      // MEJ-3: Include aditivos in receta de obra template (no humidity correction needed)
      snapAditivos.forEach((item, idx) => {
        const trazItem = trazAditivos[idx] || {};
        if (trazItem.kgM3 != null) {
          const shortLabel = aditivoShortName(item.label) || `Aditivo ${idx + 1}`;
          const dosis = formatNumber(trazItem.kgM3, 2);
          tplBody.push([
            tx(shortLabel),
            dosis,
            '\u2014',
            '\u2014',
            dosis,
            '\u2014',
          ]);
        }
      });
      if (tplBody.length > 0) {
        doc.autoTable({
          startY: y,
          head: [tplHead.map(tx)],
          body: tplBody,
          theme: 'grid',
          styles: { fontSize: 7.5, cellPadding: 2, textColor: C.text },
          headStyles: { fillColor: C.headerBg || C.primary, textColor: [255, 255, 255], fontStyle: 'bold' },
          margin: { left: margin, right: margin },
          columnStyles: { 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } },
        });
        y = doc.lastAutoTable.finalY + 3;
      }

      doc.setFont("Helvetica", "normal");
      doc.setFontSize(7);
      // ROUND-FINAL 3: single sign convention. Corr. Agua column carries the signed
      // delta_i = Peso SSS_i x (h% - Abs%) / 100. Agua obra = Agua SSS - suma(delta_i).
      // Positive delta = aggregate brings water, so subtract it; negative delta = aggregate
      // absorbs water, so the negative sign in the sum effectively adds water back.
      doc.text(tx('Agua obra = Agua SSS - suma(Corr. Agua)   (delta positivo: el agregado aporta agua; delta negativo: el agregado la absorbe).'), margin + 2, y);
      y += 5;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION M — Redosificaciones en obra (acciones trazables)
  // No son parte del diseño teórico: son eventos de obra (típicamente recuperar
  // asentamiento con dosis extra de superplastificante). Se listan solo si hay
  // registros; su fin es trazabilidad.
  // ══════════════════════════════════════════════════════════════════════════════
  const redos = Array.isArray(snapshot?.redosificaciones) ? snapshot.redosificaciones : [];
  if (redos.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 50);
    y = sectionHeader(doc, dynTitle(tx('Redosificaciones en obra')), margin, y, contentW);

    doc.setFont("Helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    const introLines = doc.splitTextToSize(
      tx('Eventos de redosificación aplicados en obra sobre esta dosificación. No forman parte del diseño teórico (no afectan a/c ni el cálculo de cemento de planta); se registran como acciones trazables.'),
      contentW - 4
    );
    for (const l of introLines) { doc.text(l, margin + 2, y); y += 3.2; }
    y += 2;
    doc.setTextColor(...C.text);

    const UNIDADES_LABEL = {
      PCT_CEMENTO: '% cem.', CC_M3: 'cc/m³', G_M3: 'g/m³', KG_M3: 'kg/m³',
    };
    const MODO_LABEL = {
      AUMENTO_ASENTAMIENTO: 'Aumento de asentamiento',
      AHORRO_AGUA: 'Ahorro de agua',
      RETARDANTE: 'Retardante',
      ACELERANTE_FRAGUE: 'Acelerante fragüe',
      ACELERANTE_ENDURECIMIENTO: 'Acelerante endurecimiento',
      INCORPORADOR_AIRE: 'Incorporador aire',
      ANTICONGELANTE: 'Anticongelante',
      REDUCTOR_RETRACCION: 'Reductor retracción',
      EXPANSIVO: 'Expansivo',
      INHIBIDOR_CORROSION: 'Inhibidor corrosión',
      VISCOSANTE: 'Viscosante',
      IMPERMEABILIZANTE: 'Impermeabilizante',
      FIBRAS: 'Fibras',
      OTRO: 'Otro',
    };

    const fmtFechaPDF = (v) => {
      if (!v) return '—';
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const redosHead = [tx('Fecha'), tx('Aditivo'), tx('Dosis'), tx('Efecto'), tx('Motivo')];
    const redosBody = redos.map(r => {
      const aditivoNombre = fmtNombreMaterial(r.aditivo?.nombre || r.aditivoNombre || `Aditivo #${r.idAditivo}`);
      const dosisTxt = `${formatNumber(Number(r.dosis), 3, true)} ${UNIDADES_LABEL[r.unidadDosis] || r.unidadDosis || ''}`.trim();
      return [
        tx(fmtFechaPDF(r.fecha)),
        tx(aditivoNombre),
        tx(dosisTxt),
        tx(MODO_LABEL[r.modoEfecto] || r.modoEfecto || '—'),
        tx(r.motivo || '—'),
      ];
    });

    doc.autoTable({
      startY: y,
      head: [redosHead],
      body: redosBody,
      margin: { left: margin, right: margin },
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.8, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2 },
      headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: "bold", halign: "center" },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 45 },
        2: { cellWidth: 25, halign: 'right' },
        3: { cellWidth: 35 },
        4: { cellWidth: 'auto' },
      },
    });
    y = doc.lastAutoTable.finalY + 4;

    // Detalle expandido por cada redosificación con contexto adicional
    for (const r of redos) {
      y = checkBreak(doc, y, pageH, margin, 20);
      const datos = [];
      if (r.asentamientoAntes != null) datos.push(`Asent. antes: ${formatNumber(r.asentamientoAntes, 0)} mm`);
      if (r.asentamientoDespues != null) datos.push(`Asent. después: ${formatNumber(r.asentamientoDespues, 0)} mm`);
      if (r.volumenHormigonM3 != null) datos.push(`Volumen: ${formatNumber(r.volumenHormigonM3, 2, true)} m³`);
      if (r.reduccionAguaPct != null) datos.push(`Reducción agua: ${formatNumber(r.reduccionAguaPct, 1, true)}%`);
      if (r.usuario) datos.push(`Registró: ${r.usuario}`);
      if (datos.length === 0 && !r.observaciones) continue;
      doc.setFont("Helvetica", "italic");
      doc.setFontSize(6.5);
      doc.setTextColor(110, 110, 110);
      const header = fmtNombreMaterial(r.aditivo?.nombre || r.aditivoNombre || `Aditivo #${r.idAditivo}`);
      const headerLine = `· ${header} — ${fmtFechaPDF(r.fecha)}`;
      const wrappedHeader = doc.splitTextToSize(tx(headerLine), contentW - 4);
      for (const l of wrappedHeader) { doc.text(l, margin + 2, y); y += 2.8; }
      if (datos.length > 0) {
        const datosTxt = datos.join(' · ');
        const wrapped = doc.splitTextToSize(tx('  ' + datosTxt), contentW - 6);
        for (const l of wrapped) { doc.text(l, margin + 2, y); y += 2.8; }
      }
      if (r.observaciones) {
        const wrapped = doc.splitTextToSize(tx('  Observación: ' + r.observaciones), contentW - 6);
        for (const l of wrapped) { doc.text(l, margin + 2, y); y += 2.8; }
      }
      y += 1;
    }
    doc.setTextColor(...C.text);
    y += 3;
  }
  } // end showSection('recetaObra')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION O — Comportamiento fresco esperado (predicción heurística V1)
  // Estimación previa al pastón de prueba. No sustituye validación experimental.
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('prediccionFresco')) {
  const predFresco = snapshot?.prediccionFresco || resultado?.prediccionFresco || null;
  if (predFresco?.indices) {
    y = checkBreak(doc, y, pageH, margin, 60);
    y = sectionHeader(doc, dynTitle(tx('Comportamiento fresco esperado')), margin, y, contentW);

    // Intro + aviso de prudencia
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    const introLines = doc.splitTextToSize(
      tx('Estimación técnica del comportamiento fresco del hormigón a partir de la dosificación calculada y la caracterización disponible. Es una predicción heurística: anticipa tendencias y no reemplaza el pastón de prueba ni los ensayos de planta.'),
      contentW - 4
    );
    for (const l of introLines) { doc.text(l, margin + 2, y); y += 3.2; }
    y += 2;
    doc.setTextColor(...C.text);
    doc.setFont('Helvetica', 'normal');

    // Labels legibles para las clases
    const CLASE_LABEL = {
      MUY_SECA: 'Muy seca', SECA: 'Seca', PLASTICA: 'Plástica',
      MUY_PLASTICA: 'Muy plástica', FLUIDA: 'Fluida', MUY_FLUIDA: 'Muy fluida',
      BAJA: 'Baja', MEDIA_BAJA: 'Media-baja', MEDIA: 'Media',
      MEDIA_ALTA: 'Media-alta', ALTA: 'Alta',
      INESTABLE: 'Inestable', SENSIBLE: 'Sensible',
      MODERADAMENTE_ESTABLE: 'Moderadamente estable', ESTABLE: 'Estable',
      BAJO: 'Bajo', MEDIO: 'Medio', ALTO: 'Alto',
      NO_RECOMENDABLE: 'No recomendable', CONDICIONADA: 'Condicionada',
      RAZONABLE: 'Razonable', BUENA: 'Buena', MUY_BUENA: 'Muy buena',
      ASPERA: 'Áspera', ACEPTABLE: 'Aceptable',
      MUY_SENSIBLE: 'Muy sensible',
      MEDIANAMENTE_ROBUSTA: 'Medianamente robusta', ROBUSTA: 'Robusta',
      SIN_DATOS: 'Sin datos suficientes',
    };
    const lbl = (c) => CLASE_LABEL[c] || c || '—';
    const pctTxt = (s) => s == null ? '—' : `${Math.round(Number(s) * 100)}%`;

    // Tabla de índices + confianza
    const ix = predFresco.indices;
    const conf = predFresco.nivelConfianza || {};
    const predHead = [tx('Indicador'), tx('Clase estimada'), tx('Score')];
    const predBody = [
      ['Fluidez esperada',       lbl(ix.fluidez?.clase),        pctTxt(ix.fluidez?.score)],
      ['Cohesión esperada',      lbl(ix.cohesion?.clase),       pctTxt(ix.cohesion?.score)],
      ['Estabilidad',            lbl(ix.estabilidad?.clase),    pctTxt(ix.estabilidad?.score)],
      ['Riesgo de exudación',    lbl(ix.exudacion?.clase),      pctTxt(ix.exudacion?.score)],
      ['Bombeabilidad estimada', lbl(ix.bombeabilidad?.clase),  pctTxt(ix.bombeabilidad?.score)],
      ['Terminabilidad',         lbl(ix.terminabilidad?.clase), pctTxt(ix.terminabilidad?.score)],
      ['Robustez operativa',     lbl(ix.robustez?.clase),       pctTxt(ix.robustez?.score)],
    ].map(row => row.map(v => tx(v)));
    // Fix UX (pedido del usuario): la fila "Nivel de confianza del modelo" antes
    // estaba DENTRO de esta tabla con la misma columna "Score". Confundía porque
    // los scores parciales (~65%) y el 100% de confianza parecían comparables,
    // pero miden cosas distintas: el 65% es la calidad estimada del indicador,
    // el 100% es la cobertura de inputs del modelo (21/21 datos). Ahora va
    // como un párrafo destacado debajo de la tabla con explicación.

    doc.autoTable({
      startY: y,
      head: [predHead],
      body: predBody,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2 },
      headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 20, halign: 'right' },
      },
    });
    y = doc.lastAutoTable.finalY + 4;

    // ── Bloque destacado: Nivel de confianza del modelo ──
    if (conf.clase || conf.score != null) {
      y = checkBreak(doc, y, pageH, margin, 14);
      const _confClaseLabel = lbl(conf.clase);
      const _confScoreTxt = pctTxt(conf.score);
      const _confScore = conf.score != null ? Number(conf.score) : null;
      // Color según nivel: verde >=0.8, ámbar >=0.5, rojo el resto.
      const _confColor = _confScore == null ? [80, 80, 80]
        : _confScore >= 0.8 ? [40, 130, 50]
        : _confScore >= 0.5 ? [200, 130, 30]
        : [180, 60, 50];
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(..._confColor);
      doc.text(tx(`Nivel de confianza del modelo: ${_confClaseLabel} (${_confScoreTxt})`), margin + 2, y);
      y += 4;
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(6.8);
      doc.setTextColor(...C.muted);
      const confExplLines = doc.splitTextToSize(
        tx('Indica la cobertura de inputs del modelo (proporción de datos requeridos que estaban disponibles). No es un promedio de los indicadores parciales: un score parcial bajo no implica baja confianza en la predicción, sino que el indicador específico salió bajo en su escala.'),
        contentW - 4
      );
      for (const l of confExplLines) { doc.text(l, margin + 2, y); y += 2.8; }
      y += 2;
      doc.setFont('Helvetica', 'normal');
      doc.setTextColor(...C.text);
    }

    // Lectura técnica
    if (predFresco.perfilTexto) {
      y = checkBreak(doc, y, pageH, margin, 20);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.text);
      doc.text(tx('Lectura técnica'), margin + 2, y);
      y += 3.5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      const lecLines = doc.splitTextToSize(tx(predFresco.perfilTexto), contentW - 4);
      for (const l of lecLines) { doc.text(l, margin + 2, y); y += 3.2; }
      y += 2;
    }

    // Riesgos
    if (Array.isArray(predFresco.riesgos) && predFresco.riesgos.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 10 + predFresco.riesgos.length * 6);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(180, 80, 20);
      doc.text(tx('Riesgos detectados'), margin + 2, y);
      y += 3.5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(80, 80, 80);
      for (const r of predFresco.riesgos) {
        const tit = r.titulo || r.codigo || '—';
        const msg = r.mensaje || '';
        const lines = doc.splitTextToSize(tx(`· ${tit}: ${msg}`), contentW - 6);
        for (const l of lines) { doc.text(l, margin + 4, y); y += 2.8; }
      }
      y += 2;
      doc.setTextColor(...C.text);
    }

    // Recomendaciones operativas
    if (Array.isArray(predFresco.recomendaciones) && predFresco.recomendaciones.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 10 + predFresco.recomendaciones.length * 4);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.text);
      doc.text(tx('Recomendaciones operativas'), margin + 2, y);
      y += 3.5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(80, 80, 80);
      for (const rec of predFresco.recomendaciones) {
        const lines = doc.splitTextToSize(tx(`- ${rec}`), contentW - 6);
        for (const l of lines) { doc.text(l, margin + 4, y); y += 2.8; }
      }
      y += 2;
      doc.setTextColor(...C.text);
    }

    // Datos disponibles para el cálculo (transparencia — Fix2 v4 audit)
    // Antes los scores se mostraban sin indicar qué inputs entraron al cálculo,
    // así que un veredicto "Media" podía ser tanto un resultado real como un
    // default por falta de datos. Ahora se lista explícitamente.
    if (predFresco.disponibilidadDatos && typeof predFresco.disponibilidadDatos === 'object') {
      const DATA_LABELS = {
        granulometria: 'Granulometría agregados', tmn: 'TMN', mf: 'Módulo de finura',
        pasa075: 'Pasa #200 ponderado', pasa030: 'Pasa #50 ponderado',
        proporcionFinos: 'Proporción FINO/GRUESO',
        fdg: 'Factor de grosor (Shilstone)', fdt: 'Factor trabajabilidad (Shilstone)',
        fda: 'Factor aptitud (Ken Day)', superficie: 'Superficie específica',
        agua: 'Agua L/m³', ac: 'Relación a/c', cemento: 'Cemento kg/m³',
        volPasta: 'Volumen de pasta', aire: 'Aire %', forma: 'Forma agregado',
        aditivo: 'Aditivo (reducción agua)', asentamiento: 'Asentamiento objetivo',
        tipologia: 'Tipología hormigón', shilstone: 'Zona Shilstone',
        coherenciaFda: 'Coherencia Ken Day',
      };
      const todos = Object.keys(DATA_LABELS);
      const usados = todos.filter((k) => predFresco.disponibilidadDatos[k] === true);
      const faltantes = todos.filter((k) => !predFresco.disponibilidadDatos[k]);
      y = checkBreak(doc, y, pageH, margin, 14);
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.text);
      doc.text(tx(`Datos usados (${usados.length}/${todos.length})`), margin + 2, y);
      y += 3.5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(6.5);
      if (usados.length > 0) {
        doc.setTextColor(40, 100, 40);
        const usadosTxt = usados.map((k) => DATA_LABELS[k] || k).join(' · ');
        const lines = doc.splitTextToSize(tx(`✓ ${usadosTxt}`), contentW - 6);
        for (const l of lines) { doc.text(l, margin + 4, y); y += 2.6; }
      }
      if (faltantes.length > 0) {
        doc.setTextColor(150, 90, 30);
        const faltTxt = faltantes.map((k) => DATA_LABELS[k] || k).join(' · ');
        const lines = doc.splitTextToSize(tx(`✗ Sin datos: ${faltTxt}`), contentW - 6);
        for (const l of lines) { doc.text(l, margin + 4, y); y += 2.6; }
        y += 1;
        doc.setTextColor(120, 120, 130);
        doc.setFont('Helvetica', 'italic');
        const nota = doc.splitTextToSize(
          tx('Los indicadores cuyos inputs principales no estuvieron disponibles aparecen como "Sin datos suficientes". Cargar caracterización completa de los agregados y ensayos asociados mejora la predicción.'),
          contentW - 6
        );
        for (const l of nota) { doc.text(l, margin + 4, y); y += 2.6; }
        doc.setFont('Helvetica', 'normal');
      }
      y += 2;
      doc.setTextColor(...C.text);
    }

    // Aviso final de prudencia (siempre visible)
    y = checkBreak(doc, y, pageH, margin, 10);
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 120, 130);
    const aviso = doc.splitTextToSize(
      tx(`Predicción heurística ${predFresco.versionModelo || 'V1'}. La confianza depende de la completitud de la caracterización de materiales y la dosificación. No reemplaza pastón de prueba ni ensayos reales de planta. Se recomienda validar experimentalmente antes de liberar.`),
      contentW - 4
    );
    for (const l of aviso) { doc.text(l, margin + 2, y); y += 2.8; }
    y += 3;
    doc.setTextColor(...C.text);
    doc.setFont('Helvetica', 'normal');
  }
  } // end showSection('prediccionFresco')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION P — Historial de modificaciones (Fase 2A)
  // Muestra las correcciones post-pastón aplicadas a la dosificación + los
  // eventos de ciclo de vida relevantes (nuevas rondas de prueba, cambios de
  // estado). La sección sólo se imprime si hay registros.
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('historial')) {
  const correccionesHist = Array.isArray(snapshot?.correccionesPostPaston) ? snapshot.correccionesPostPaston : [];
  const historialHist = Array.isArray(snapshot?.historial) ? snapshot.historial
    : Array.isArray(historialData) ? historialData : [];
  const rondaActual = snapshot?.numeroRondaPrueba || 1;
  const hayModificaciones = correccionesHist.length > 0
    || historialHist.some(h => ['modificacion', 'nueva_ronda_prueba', 'cambio_estado'].includes(h.tipoEvento));

  if (hayModificaciones) {
    y = checkBreak(doc, y, pageH, margin, 40);
    y = sectionHeader(doc, dynTitle(tx('Historial de modificaciones')), margin, y, contentW);

    doc.setFont("Helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    const introP = (rondaActual > 1)
      ? `Ronda de prueba actual: ${rondaActual}. Se listan los ajustes aplicados a la dosificación y los eventos de ciclo de vida desde su creación. Garantiza trazabilidad entre el diseño original y los valores finalmente adoptados.`
      : 'Ronda de prueba 1. Se listan los ajustes aplicados a la dosificación y los eventos de ciclo de vida desde su creación.';
    const introPLines = doc.splitTextToSize(tx(introP), contentW - 4);
    for (const l of introPLines) { doc.text(l, margin + 2, y); y += 3.2; }
    y += 2;
    doc.setTextColor(...C.text);
    doc.setFont("Helvetica", "normal");

    const fmtFechaHist = (v) => {
      if (!v) return '—';
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    // Tabla 1: Correcciones post-pastón (cambios concretos de valores)
    if (correccionesHist.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 20);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      doc.text(tx('Correcciones aplicadas tras el pastón'), margin + 2, y);
      y += 4;

      const corrHead = [tx('Fecha'), tx('Campo'), tx('Anterior'), tx('Nuevo'), tx('Motivo'), tx('Usuario')];
      const corrBody = correccionesHist.map(c => [
        tx(fmtFechaHist(c.createdAt || c.fecha)),
        tx(c.campoLabel || c.campo || '—'),
        tx(`${c.valorAnterior ?? '—'}${c.unidad ? ' ' + c.unidad : ''}`),
        tx(`${c.valorNuevo ?? '—'}${c.unidad ? ' ' + c.unidad : ''}`),
        tx(c.motivo || '—'),
        tx(c.usuario || '—'),
      ]);
      doc.autoTable({
        startY: y,
        head: [corrHead],
        body: corrBody,
        margin: { left: margin, right: margin },
        theme: 'grid',
        styles: { fontSize: 6.8, cellPadding: 1.8, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2 },
        headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 42 },
          2: { cellWidth: 25, halign: 'right' },
          3: { cellWidth: 25, halign: 'right' },
          4: { cellWidth: 'auto' },
          5: { cellWidth: 28 },
        },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    // Tabla 2: Eventos de ciclo de vida (nuevas rondas, cambios de estado,
    // aprobaciones) — solo los que aportan al contexto de modificaciones.
    const eventosRelevantes = historialHist.filter(h =>
      ['nueva_ronda_prueba', 'cambio_estado', 'modificacion', 'aprobacion', 'rechazo'].includes(h.tipoEvento)
    );
    if (eventosRelevantes.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 20);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      doc.text(tx('Eventos de ciclo de vida'), margin + 2, y);
      y += 4;

      const EVENTO_LABEL = {
        nueva_ronda_prueba: 'Nueva ronda de prueba',
        cambio_estado: 'Cambio de estado',
        modificacion: 'Modificación',
        aprobacion: 'Aprobación',
        rechazo: 'Rechazo',
        creacion: 'Creación',
        calculo: 'Cálculo',
      };
      const evHead = [tx('Fecha'), tx('Evento'), tx('Estado'), tx('Motivo / observación'), tx('Usuario')];
      const evBody = eventosRelevantes.map(h => {
        const estadoTxt = h.estadoAnterior && h.estadoNuevo && h.estadoAnterior !== h.estadoNuevo
          ? `${h.estadoAnterior} → ${h.estadoNuevo}`
          : (h.estadoNuevo || h.estadoAnterior || '—');
        return [
          tx(fmtFechaHist(h.createdAt || h.fecha)),
          tx(EVENTO_LABEL[h.tipoEvento] || h.tipoEvento || '—'),
          tx(estadoTxt),
          tx(h.motivo || h.observaciones || '—'),
          tx(h.usuario || '—'),
        ];
      });
      doc.autoTable({
        startY: y,
        head: [evHead],
        body: evBody,
        margin: { left: margin, right: margin },
        theme: 'grid',
        styles: { fontSize: 6.8, cellPadding: 1.8, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2 },
        headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 'auto' },
          4: { cellWidth: 28 },
        },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    // Sección complementaria: valores adoptados si se declararon distintos del
    // cálculo. Sirve cuando el equipo técnico decide explícitamente un cemento
    // o proporciones distintas del resultado del motor tras la prueba.
    const cemAdop = snapshot?.cementoKgM3Adoptado != null ? Number(snapshot.cementoKgM3Adoptado) : null;
    const propsAdop = snapshot?.proporcionesAgregadosAdoptadasJson || null;
    if (cemAdop != null || (propsAdop && (Array.isArray(propsAdop) ? propsAdop.length : Object.keys(propsAdop).length))) {
      y = checkBreak(doc, y, pageH, margin, 20);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      doc.text(tx('Valores adoptados tras la prueba'), margin + 2, y);
      y += 4;

      const adopRows = [];
      if (cemAdop != null) {
        const cemOrig = resultado?.cementoTotalKgM3 || resultado?.cementoKgM3 || null;
        adopRows.push([
          tx('Cantidad de cemento'),
          tx(cemOrig != null ? `${formatNumber(cemOrig, 0)} kg/m³` : '—'),
          tx(`${formatNumber(cemAdop, 0)} kg/m³`),
        ]);
      }
      if (propsAdop) {
        const entries = Array.isArray(propsAdop) ? propsAdop : Object.entries(propsAdop).map(([k, v]) => ({ nombre: k, porcentaje: v }));
        for (const e of entries) {
          adopRows.push([
            tx(`% ${e.nombre || 'Agregado'}`),
            tx('—'),
            tx(`${formatNumber(Number(e.porcentaje), 1, true)}%`),
          ]);
        }
      }

      doc.autoTable({
        startY: y,
        head: [[tx('Parámetro'), tx('Valor calculado'), tx('Valor adoptado')]],
        body: adopRows,
        margin: { left: margin, right: margin },
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 2, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2 },
        headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 40, halign: 'right' },
          2: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
        },
      });
      y = doc.lastAutoTable.finalY + 3;

      doc.setFont("Helvetica", "italic");
      doc.setFontSize(6.5);
      doc.setTextColor(...C.muted);
      const adopNote = doc.splitTextToSize(
        tx('Los valores adoptados registran decisiones técnicas tras la prueba. No reemplazan al cálculo del motor; conviven con él como registro paralelo hasta que se recalcule la dosificación con los parámetros ajustados.'),
        contentW - 4
      );
      for (const l of adopNote) { doc.text(l, margin + 2, y); y += 2.8; }
      y += 3;
      doc.setTextColor(...C.text);
      doc.setFont("Helvetica", "normal");
    }

    y += 2;
  }
  } // end showSection('historial')

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION I — Análisis de sensibilidad (optional, INFORME-01)
  // ══════════════════════════════════════════════════════════════════════════════
  // El análisis de sensibilidad varía f'c/a/c para recalcular cemento desde la
  // curva del cemento, lo cual NO aplica a modelos fuera de CIRSOC (HRDC y
  // Alivianado): en ellos el cemento es input directo y f'c es orientativo.
  if (!fueraDeCirsoc && showSection('sensibilidad') && includeSensibilidad && resultado.ac != null && resultado.aguaLtsM3 != null && resultado.cementoTotalKgM3 != null) {
    y = checkBreak(doc, y, pageH, margin, 70);
    y = sectionHeader(doc, dynTitle(tx('Análisis de sensibilidad')), margin, y, contentW);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(tx("Efecto estimado de variaciones en parámetros clave sobre la dosificación. Valores aproximados para referencia."), margin + 2, y);
    y += 5;

    const baseAC = resultado.ac;
    const baseAgua = resultado.aguaLtsM3;
    const baseCemento = resultado.cementoTotalKgM3;

    // Perturbation scenarios
    const scenarios = [];

    // a/c variations: ±0.02, ±0.05
    const acDeltas = [-0.05, -0.02, 0.02, 0.05];
    acDeltas.forEach(delta => {
      const newAC = baseAC + delta;
      if (newAC > 0.25 && newAC < 1.0) {
        const newCemento = baseAgua / newAC;
        scenarios.push({
          param: "a/c",
          variacion: `${delta > 0 ? "+" : ""}${formatNumber(delta, 2)}`,
          nuevoValor: formatNumber(newAC, 2),
          cemento: `${formatNumber(newCemento, 0)} kg/m³`,
          deltaCemento: `${newCemento > baseCemento ? "+" : ""}${formatNumber(newCemento - baseCemento, 0)} kg`,
          agua: `${formatNumber(baseAgua, 0)} L/m³`,
          obs: newCemento > baseCemento ? "Mayor consumo" : "Menor consumo",
        });
      }
    });

    // Agua variations: ±5 L, ±10 L
    const aguaDeltas = [-10, -5, 5, 10];
    aguaDeltas.forEach(delta => {
      const newAgua = baseAgua + delta;
      if (newAgua > 100 && newAgua < 300) {
        const newCemento = newAgua / baseAC;
        scenarios.push({
          param: "Agua",
          variacion: `${delta > 0 ? "+" : ""}${delta} L/m³`,
          nuevoValor: `${formatNumber(newAgua, 0)} L/m³`,
          cemento: `${formatNumber(newCemento, 0)} kg/m³`,
          deltaCemento: `${newCemento > baseCemento ? "+" : ""}${formatNumber(newCemento - baseCemento, 0)} kg`,
          agua: `${formatNumber(newAgua, 0)} L/m³`,
          obs: "",
        });
      }
    });

    // f'c variations: ±5 MPa, +10 MPa
    const fce = snapshot?.fce ?? snapshot?.resistencia;
    const fcm = snapshot?.fcm;
    const curvaCemento = resultado?.relacionAC?.curva || snapshot?.curvaCemento;
    if (fce != null && fcm != null) {
      const fcDeltas = [-5, 5, 10];
      fcDeltas.forEach(delta => {
        const newFc = fce + delta;
        if (newFc < 15 || newFc > 80) return;
        // Estimate new f'cm using same margin (f'cm - f'c)
        const margen = fcm - fce;
        const newFcm = newFc + margen;
        // Estimate new a/c: use linear interpolation from current point
        // a/c roughly proportional to 1/f'cm for a given cement
        const acRatio = fcm / newFcm;
        const newAC = Math.min(Math.max(baseAC * acRatio, 0.28), 0.85);
        const newCemento = baseAgua / newAC;
        scenarios.push({
          param: "f'c",
          variacion: `${delta > 0 ? "+" : ""}${delta} MPa`,
          nuevoValor: `${formatNumber(newFc, 0)} MPa (f'cm ${formatNumber(newFcm, 0)})`,
          cemento: `${formatNumber(newCemento, 0)} kg/m³`,
          deltaCemento: `${newCemento > baseCemento ? "+" : ""}${formatNumber(newCemento - baseCemento, 0)} kg`,
          agua: `${formatNumber(baseAgua, 0)} L/m³`,
          obs: "",
        });
      });
    }

    // Proporción finos (±5%) — effect on FdG/FdT (most actionable parameter for plant operator)
    const trabData = resultado?.trabajabilidad || traz?.trabajabilidad;
    const fdgBase = trabData?.fdg ?? trabData?.factorGrosor;
    const fdtBase = trabData?.fdt ?? trabData?.factorTrabajabilidad;
    if (fdgBase != null && fdtBase != null) {
      const finoDeltas = [-5, 5];
      finoDeltas.forEach(delta => {
        // Approximate: ±5% finos shifts FdG by ~∓3-5 pts and FdT by ~±2-3 pts
        // These are rough estimates — actual values depend on specific granulometries
        const fdgEst = Math.round((fdgBase - delta * 0.7) * 10) / 10;
        const fdtEst = Math.round((fdtBase + delta * 0.5) * 10) / 10;
        scenarios.push({
          param: tx("Proporción finos"),
          variacion: `${delta > 0 ? "+" : ""}${delta} pp`,
          nuevoValor: `FdG: ${formatNumber(fdgEst, 1)}%  FdT: ${formatNumber(fdtEst, 1)}%`,
          cemento: `${formatNumber(baseCemento, 0)} kg/m\u00b3`,
          deltaCemento: tx("FdG " + (delta > 0 ? "\u2193" : "\u2191") + " / FdT " + (delta > 0 ? "\u2191" : "\u2193")),
          obs: delta > 0 ? "Más fino, más trabajable" : "Más grueso, menos trabajable",
        });
      });
    }

    if (scenarios.length > 0) {
      const sensHead = [
        tx("Parámetro"),
        tx("Variación"),
        tx("Nuevo valor"),
        tx("Cemento resultante"),
        tx("Diferencia"),
      ];
      const sensBody = scenarios.map(s => [
        s.param,
        s.variacion,
        s.nuevoValor,
        s.cemento,
        s.deltaCemento,
      ]);

      doc.autoTable({
        startY: y,
        head: [sensHead],
        body: sensBody,
        margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
        styles: { fontSize: 7.5, cellPadding: 2, overflow: "linebreak", textColor: C.text },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold", fontSize: 7 },
        alternateRowStyles: { fillColor: C.light },
        columnStyles: {
          0: { cellWidth: 28, fontStyle: "bold" },
          1: { cellWidth: 28, halign: "center" },
          2: { cellWidth: 30, halign: "center" },
          3: { cellWidth: 36, halign: "center" },
          4: { cellWidth: 28, halign: "center" },
        },
        didParseCell: (data) => {
          if (data.section !== "body" || data.column.index !== 4) return;
          const val = String(data.cell.raw);
          if (val.startsWith("+")) data.cell.styles.textColor = [220, 38, 38];
          else if (val.startsWith("-")) data.cell.styles.textColor = C.green;
        },
      });
      y = doc.lastAutoTable.finalY + 3;
    }

    // Base values reference
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(6.5);
    doc.setTextColor(...C.muted);
    doc.text(tx(`Valores base: a/c = ${formatNumber(baseAC, 2)}  |  Agua = ${formatNumber(baseAgua, 0)} L/m³  |  Cemento = ${formatNumber(baseCemento, 0)} kg/m³. Mantiene proporciones de agregados constantes.`), margin + 2, y);
    doc.setTextColor(...C.text);
    doc.setFont("Helvetica", "normal");
    y += 6;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION E — Análisis de costos (optional, FUNC-02)
  // ══════════════════════════════════════════════════════════════════════════════
  if (includeCostos && costosData && costosData.items && costosData.items.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 40);

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...C.primary);
    doc.text(tx(dynTitle("Análisis de costos por m³")), margin, y);
    y += 7;

    if (costosData.missingPrecios && costosData.missingPrecios.length > 0) {
      doc.setFont("Helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.amber);
      doc.text(tx(`Costo parcial - faltan precios para: ${costosData.missingPrecios.join(", ")}.`), margin, y);
      y += 5;
    }

    const costRows = costosData.items
      .filter(i => i.subtotal != null)
      .map(i => [
        tx(i.nombre),
        `${i.cantidadLabel} ${i.unidadCantidad}`,
        i.precioUnit != null ? `$${Number(i.precioUnit).toLocaleString("es-AR")}/${i.precioUnidad}` : "-",
        i.subtotal != null ? `$${Number(i.subtotal).toLocaleString("es-AR", { maximumFractionDigits: 0 })}` : "-",
        i.pct != null ? `${formatNumber(i.pct, 1, true)}%` : "-",
      ]);

    // Add totals
    costRows.push([
      { content: tx("TOTAL MATERIALES"), styles: { fontStyle: "bold" } },
      "", "",
      { content: `$${Number(costosData.totalMateriales).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`, styles: { fontStyle: "bold" } },
      "",
    ]);

    if (costosData.totalFlete > 0) {
      costRows.push([
        tx("Flete (agregados)"), "", "",
        `$${Number(costosData.totalFlete).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`,
        "(sep.)",
      ]);
      costRows.push([
        { content: tx("TOTAL CON FLETE"), styles: { fontStyle: "bold" } },
        "", "",
        { content: `$${Number(costosData.totalConFlete).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`, styles: { fontStyle: "bold" } },
        "",
      ]);
    }

    doc.autoTable({
      startY: y,
      head: [["Componente", "Cantidad", "P. Unit.", "Subtotal", "%"]],
      body: costRows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
      },
      theme: "grid",
      margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
    });
    y = doc.lastAutoTable.finalY + 4;

    // Footnote
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    const fechaPrecio = new Date().toLocaleDateString("es-AR");
    doc.text(tx(`(*) Precios vigentes al ${fechaPrecio}. Los costos no incluyen IVA, gastos de elaboración, ni costos operativos de planta.`), margin, y);
    y += 8;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION K — Verificación experimental (pastones de prueba)
  // ══════════════════════════════════════════════════════════════════════════════
  if (showSection('verificacionExp')) {
    const pastonesList = snapshot?.pastones || [];
    const vaK = snapshot?.valoresAdoptados;
    if (pastonesList.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 60);
      y = sectionHeader(doc, dynTitle(tx('Verificación experimental')), margin, y, contentW);

      // Each paston as a sub-block
      for (let pi = 0; pi < pastonesList.length; pi++) {
        const p = pastonesList[pi];
        y = checkBreak(doc, y, pageH, margin, 35);

        // Paston header line
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...C.text);
        const pFecha = p.fecha || "sin fecha";
        const pOp = p.operador ? ` — Operador: ${p.operador}` : "";
        const pVol = p.volumenAdoptadoL || (p.volumenM3 ? Math.round(p.volumenM3 * 1000) : null);
        const pVolStr = pVol ? ` — Vol: ${pVol} L` : "";
        doc.text(tx(`Pastón #${pi + 1} — ${pFecha}${pOp}${pVolStr}`), margin, y);
        y += 5;

        // Measurements table
        const measRows = [];
        const asentDiseno = resultado?.asentamientoNominalCm ?? snapshot?.consistenciaValor;
        if (p.asentamientoMedido != null) {
          const diff = asentDiseno != null ? Number(p.asentamientoMedido) - Number(asentDiseno) : null;
          const ok = diff != null ? Math.abs(diff) <= 2.0 : null;
          measRows.push([
            "Asentamiento",
            asentDiseno != null ? `${formatNumber(asentDiseno, 1)} cm` : "—",
            `${formatNumber(p.asentamientoMedido, 1)} cm`,
            diff != null ? `${diff > 0 ? "+" : ""}${formatNumber(diff, 1)} cm ${ok ? "[OK]" : "[!]"}` : "—",
          ]);
        }
        if (p.puvMedido != null) {
          const puvDiseno = resultado?.puvKgM3;
          const diff = puvDiseno != null ? Number(p.puvMedido) - puvDiseno : null;
          measRows.push([
            "PUV",
            puvDiseno != null ? `${formatNumber(puvDiseno, 0)} kg/m³` : "—",
            `${formatNumber(p.puvMedido, 0)} kg/m³`,
            diff != null ? `${diff > 0 ? "+" : ""}${formatNumber(diff, 0)} kg/m³` : "—",
          ]);
        }
        if (p.aireMedido != null) {
          const aireDiseno = resultado?.airePct;
          const diff = aireDiseno != null ? Number(p.aireMedido) - aireDiseno : null;
          measRows.push([
            "Aire",
            aireDiseno != null ? `${formatNumber(aireDiseno, 1)}%` : "—",
            `${formatNumber(p.aireMedido, 1)}%`,
            diff != null ? `${diff > 0 ? "+" : ""}${formatNumber(diff, 1)}%` : "—",
          ]);
        }
        if (p.temperaturaHormigon != null) {
          measRows.push(["Temp. hormigón", "—", `${formatNumber(p.temperaturaHormigon, 1)} °C`, "—"]);
        }
        if (p.temperaturaAmbiente != null) {
          measRows.push(["Temp. ambiente", "—", `${formatNumber(p.temperaturaAmbiente, 1)} °C`, "—"]);
        }

        if (measRows.length > 0) {
          doc.autoTable({
            startY: y,
            head: [["Parámetro", "Diseño", "Medido", "Diferencia"]],
            body: measRows,
            margin: { left: margin, right: margin },
            styles: { fontSize: 7.5, cellPadding: 1.8 },
            headStyles: { fillColor: C.secondary, textColor: C.white, fontSize: 7.5 },
            columnStyles: { 0: { cellWidth: 42 }, 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" }, 3: { halign: "right" } },
            theme: "plain",
            alternateRowStyles: { fillColor: C.light },
          });
          y = doc.lastAutoTable.finalY + 4;
        }

        // Aspecto + probetas
        if (p.aspecto || p.probetasMoldeadas || p.identificacionProbetas) {
          doc.setFont("Helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(...C.muted);
          const parts = [];
          if (p.aspecto) parts.push(`Aspecto: ${p.aspecto}`);
          if (p.probetasMoldeadas) parts.push(`Probetas: ${p.probetasMoldeadas}${p.tipoProbeta ? ` (${p.tipoProbeta})` : ""}`);
          if (p.identificacionProbetas) parts.push(`ID: ${p.identificacionProbetas}`);
          doc.text(tx(parts.join("  │  ")), margin, y);
          y += 3.5;
        }

        // Observaciones
        if (p.observaciones) {
          doc.setFont("Helvetica", "italic");
          doc.setFontSize(7.5);
          doc.setTextColor(...C.muted);
          const obsWrapped = doc.splitTextToSize(tx(p.observaciones), contentW - 4);
          doc.text(obsWrapped, margin + 2, y);
          y += obsWrapped.length * 3.2 + 2;
        }

        // ── Fase 2B: mediciones seriadas (slump loss) + gráfico ──
        // Si el pastón trae mediciones seriadas, las mostramos con una tabla
        // compacta y un mini-gráfico jsPDF de slump vs tiempo, coloreado por
        // etapa (planta/transporte/obra).
        const meds = Array.isArray(p.mediciones) ? p.mediciones : [];
        if (meds.length > 0) {
          y = checkBreak(doc, y, pageH, margin, 16);
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(7.5);
          doc.setTextColor(...C.text);
          doc.text(tx("Mediciones seriadas (pérdida de asentamiento)"), margin, y);
          y += 4;

          const medsSorted = [...meds].sort((a, b) => {
            if ((a.ordenSecuencia || 0) !== (b.ordenSecuencia || 0)) return (a.ordenSecuencia || 0) - (b.ordenSecuencia || 0);
            return new Date(a.fechaHora || 0).getTime() - new Date(b.fechaHora || 0).getTime();
          });
          const fmtHoraMed = (v) => {
            if (!v) return "—";
            const d = new Date(v);
            if (isNaN(d.getTime())) return String(v);
            return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit" });
          };

          doc.autoTable({
            startY: y,
            head: [["#", "Etapa", "Hora", "Etiqueta", "Asent. (mm)", "T° H°", "T° amb.", "Observación"]],
            body: medsSorted.map(m => [
              String(m.ordenSecuencia || "—"),
              m.etapa || "—",
              fmtHoraMed(m.fechaHora),
              m.etiqueta || "—",
              m.asentamientoMm != null ? formatNumber(m.asentamientoMm, 0) : "—",
              m.temperaturaHormigonC != null ? `${formatNumber(m.temperaturaHormigonC, 1)}°` : "—",
              m.temperaturaAmbienteC != null ? `${formatNumber(m.temperaturaAmbienteC, 1)}°` : "—",
              m.observacion || "—",
            ]),
            margin: { left: margin, right: margin },
            styles: { fontSize: 6.8, cellPadding: 1 },
            headStyles: { fillColor: C.secondary, textColor: C.white, fontSize: 7 },
            columnStyles: {
              0: { cellWidth: 7, halign: "center" },
              1: { cellWidth: 16 },
              2: { cellWidth: 12 },
              3: { cellWidth: 28 },
              4: { cellWidth: 16, halign: "right" },
              5: { cellWidth: 12, halign: "right" },
              6: { cellWidth: 12, halign: "right" },
              7: { cellWidth: "auto" },
            },
            theme: "grid",
          });
          y = doc.lastAutoTable.finalY + 3;

          // Mini-gráfico slump vs tiempo
          const puntos = medsSorted
            .filter(m => m.asentamientoMm != null && m.fechaHora)
            .map(m => ({
              t: new Date(m.fechaHora).getTime(),
              slump: Number(m.asentamientoMm),
              etapa: m.etapa || "PLANTA",
            }));
          if (puntos.length >= 2) {
            y = checkBreak(doc, y, pageH, margin, 80);
            const chartW = contentW, chartH = 65;
            const padL = 18, padR = 6, padT = 5, padB = 18;
            const x0 = margin, y0 = y;
            doc.setFillColor(245, 247, 250);
            doc.rect(x0, y0, chartW, chartH, "F");
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.2);
            doc.line(x0 + padL, y0 + padT, x0 + padL, y0 + chartH - padB);
            doc.line(x0 + padL, y0 + chartH - padB, x0 + chartW - padR, y0 + chartH - padB);

            const tMin = puntos[0].t;
            const tMax = puntos[puntos.length - 1].t;
            const sMax = Math.max(...puntos.map(pp => pp.slump), 220);
            const sx = (t) => x0 + padL + ((t - tMin) / Math.max(1, tMax - tMin)) * (chartW - padL - padR);
            const sy = (s) => y0 + chartH - padB - (s / sMax) * (chartH - padT - padB);

            doc.setTextColor(120, 120, 120);
            doc.setFontSize(6);
            [0, 50, 100, 150, 200].filter(s => s <= sMax).forEach(s => {
              const ty = sy(s);
              doc.line(x0 + padL - 1, ty, x0 + padL, ty);
              doc.text(String(s), x0 + padL - 2, ty + 1.2, { align: "right" });
            });
            const fmtHoraShort = (ts) => new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

            doc.setDrawColor(59, 130, 246);
            doc.setLineWidth(0.5);
            for (let i = 1; i < puntos.length; i++) {
              doc.line(sx(puntos[i - 1].t), sy(puntos[i - 1].slump), sx(puntos[i].t), sy(puntos[i].slump));
            }
            const colorByEtapa = { PLANTA: [245, 158, 11], TRANSPORTE: [6, 182, 212], OBRA: [16, 185, 129] };
            for (const pt of puntos) {
              const col = colorByEtapa[pt.etapa] || [100, 100, 100];
              doc.setFillColor(col[0], col[1], col[2]);
              doc.circle(sx(pt.t), sy(pt.slump), 1.2, "F");
            }
            // Ticks X con hora de cada medición (rotados 45° para evitar solapes)
            doc.setFontSize(5.5);
            doc.setTextColor(100, 100, 100);
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.15);
            puntos.forEach(pt => {
              const tx = sx(pt.t);
              const ty = y0 + chartH - padB;
              doc.line(tx, ty, tx, ty + 1.2);
              doc.text(fmtHoraShort(pt.t), tx, ty + 3, { angle: 45 });
            });
            doc.setFontSize(6);
            doc.setTextColor(120, 120, 120);
            doc.setFontSize(7);
            doc.setTextColor(...C.muted);
            doc.text(tx("Asentamiento (mm) vs tiempo"), x0 + chartW / 2, y0 + padT - 0.5, { align: "center" });

            const legendY = y0 + chartH + 4;
            let lx = x0 + padL;
            const etapasPresentes = new Set(puntos.map(p => p.etapa));
            [
              { key: "PLANTA", label: "Planta", col: [245, 158, 11] },
              { key: "TRANSPORTE", label: "Transporte", col: [6, 182, 212] },
              { key: "OBRA", label: "Obra", col: [16, 185, 129] },
            ].filter(l => etapasPresentes.has(l.key)).forEach(l => {
              doc.setFillColor(l.col[0], l.col[1], l.col[2]);
              doc.circle(lx + 1.5, legendY - 1, 1.2, "F");
              doc.setTextColor(...C.text);
              doc.text(l.label, lx + 4, legendY);
              lx += 28;
            });
            y = legendY + 4;
            doc.setTextColor(...C.text);
          }

          // ── Totales de agregados (acciones trazables) y retenidos (componentes) ──
          //
          // P0.6 — SINGLE SOURCE OF TRUTH para "agua agregada" y "aditivos
          // agregados". Antes había dos paths que leían de fuentes distintas
          // (mediciones legacy vs redosificaciones), produciendo contradicción
          // entre la sección Q ("Reconciliación: Agregado +10 L") y el balance
          // ("Agua agregada (acciones) —"). Ahora ambas leen de la misma fuente:
          // las redosificaciones/acciones filtradas por pastonRefId.
          let aguaAgrTotal = 0, aguaRetTotal = 0;
          const aditivosAgr = {}, aditivosRet = {};
          const aditivosDosif = {}; // dosificado teórico consolidado por nombre (sin unidad)

          // (1) Agregados desde acciones trazables (RedosificacionObra) del pastón
          const accionesPaston = (Array.isArray(snapshot?.redosificaciones) ? snapshot.redosificaciones : [])
            .filter(a => a.pastonRefId === p.idPastonPrueba);
          for (const a of accionesPaston) {
            const tipo = a.tipoAccion || 'ADITIVO';
            const cant = a.cantidad != null ? Number(a.cantidad) : (a.dosis != null ? Number(a.dosis) : 0);
            if (cant <= 0) continue;
            if (tipo === 'AGUA') {
              aguaAgrTotal += cant;
            } else if (tipo === 'ADITIVO' || tipo === 'FIBRA' || tipo === 'OTRO') {
              const nombre = a.aditivo?.marca || a.aditivo?.nombre || a.fibra?.marca || a.nombreMaterial || `Material #${a.idAditivo || a.idFibra || '?'}`;
              const unidad = a.unidad || 'cc';
              const k = `${nombre} (${unidad})`;
              aditivosAgr[k] = (aditivosAgr[k] || 0) + cant;
            }
          }

          // Fallback: si no hay acciones, leer de mediciones legacy (datos viejos
          // pre-unificación). Las nuevas mediciones ya no guardan agua agregada.
          if (accionesPaston.length === 0) {
            for (const m of medsSorted) {
              if (m.aguaAgregadaLts != null) aguaAgrTotal += Number(m.aguaAgregadaLts);
              let lista = m.aditivosAgregadosJson;
              if (typeof lista === "string") { try { lista = JSON.parse(lista); } catch { lista = null; } }
              if (Array.isArray(lista) && lista.length > 0) {
                for (const ad of lista) {
                  if (ad?.nombre && ad?.cantidad != null) {
                    const k = `${ad.nombre} (${ad.unidad || 'cc'})`;
                    aditivosAgr[k] = (aditivosAgr[k] || 0) + Number(ad.cantidad);
                  }
                }
              } else if (m.aditivoAgregadoNombre && m.aditivoAgregadoCantidad != null) {
                const k = `${m.aditivoAgregadoNombre} (${m.aditivoAgregadoUnidad || 'cc'})`;
                aditivosAgr[k] = (aditivosAgr[k] || 0) + Number(m.aditivoAgregadoCantidad);
              }
            }
          }

          // (2) Retenidos + dosificado desde pastón.componentes
          let compList = p.componentes;
          if (typeof compList === "string") { try { compList = JSON.parse(compList); } catch { compList = null; } }
          if (Array.isArray(compList)) {
            for (const c of compList) {
              if (c?.tipo === 'ADITIVO' && c.componente) {
                const k = `${c.componente} (${c.unidad || 'cc'})`;
                // Consolidar dosificado (un mismo aditivo puede estar en varios slots)
                if (c.cantidadScaled != null) {
                  aditivosDosif[k] = (aditivosDosif[k] || 0) + Number(c.cantidadScaled);
                }
                if (c.retenido != null && Number(c.retenido) > 0) {
                  aditivosRet[k] = (aditivosRet[k] || 0) + Number(c.retenido);
                }
              } else if (c?.tipo === 'AGUA' && c.retenido != null && Number(c.retenido) > 0) {
                aguaRetTotal += Number(c.retenido);
              }
            }
          }
          const hayReconciliacion = aguaAgrTotal > 0 || aguaRetTotal > 0 ||
            Object.keys(aditivosAgr).length > 0 || Object.keys(aditivosRet).length > 0;

          if (hayReconciliacion) {
            y = checkBreak(doc, y, pageH, margin, 28);
            doc.setFont("Helvetica", "bold");
            doc.setFontSize(7.5);
            doc.setTextColor(...C.primary);
            doc.text(tx("Reconciliación de agregados y retenidos"), margin, y);
            y += 3;
            doc.setFont("Helvetica", "italic");
            doc.setFontSize(6.5);
            doc.setTextColor(...C.muted);
            doc.text(tx("Fórmula: Cargado al mixer = Dosificado - Retenido + Agregado (todos los valores en positivo)"), margin, y);
            y += 4;

            // Dosificación teórica: referencia de agua + aditivos sobre el volumen del pastón
            const volM3 = Number(p.volumenM3 || (p.volumenAdoptadoL ? p.volumenAdoptadoL / 1000 : 0));
            const aguaDosifLts = resultado?.aguaLtsM3 != null ? Number(resultado.aguaLtsM3) * volM3 : null;

            const rec = [];
            if (aguaDosifLts != null || aguaAgrTotal > 0 || aguaRetTotal > 0) {
              const cargadoReal = (aguaDosifLts ?? 0) - aguaRetTotal + aguaAgrTotal;
              rec.push([
                tx("Agua"),
                aguaDosifLts != null ? `${formatNumber(aguaDosifLts, 1)} L` : "\u2014",
                aguaRetTotal > 0 ? `${formatNumber(aguaRetTotal, 1)} L` : "\u2014",
                aguaAgrTotal > 0 ? `${formatNumber(aguaAgrTotal, 1)} L` : "\u2014",
                `${formatNumber(cargadoReal, 1)} L`,
              ]);
            }
            // P1.10 last mile — reconciliar aditivos con matcheo por NOMBRE
            // normalizado (ignora unidad). Antes la key era `${nombre} (${unidad})`
            // y si los componentes del pastón usaban `%` y las acciones usaban `cc`,
            // el mismo aditivo aparecía como dos filas distintas: una con Dosificado
            // y otra con "—" + Retenido/Agregado → cargadoReal salía negativo.
            const stripUnidad = (k) => String(k || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
            const consolidar = (obj) => {
              const out = {};
              const unidades = {};
              for (const [k, v] of Object.entries(obj)) {
                const base = stripUnidad(k);
                if (!base) continue;
                out[base] = (out[base] || 0) + v;
                // Preservar la primera unidad vista para display
                const u = (k.match(/\(([^)]+)\)\s*$/) || [])[1];
                if (u && !unidades[base]) unidades[base] = u;
              }
              return { out, unidades };
            };
            const { out: dosifN, unidades: uniD } = consolidar(aditivosDosif);
            const { out: retN, unidades: uniR } = consolidar(aditivosRet);
            const { out: agrN, unidades: uniA } = consolidar(aditivosAgr);
            const aditivosTodos = new Set([...Object.keys(dosifN), ...Object.keys(retN), ...Object.keys(agrN)]);
            for (const base of aditivosTodos) {
              const dosif = dosifN[base] || 0;
              const agr = agrN[base] || 0;
              const ret = retN[base] || 0;
              const unidad = uniD[base] || uniA[base] || uniR[base] || '';
              // Nombre display: capitalizar primer char
              const nombreDisplay = base.charAt(0).toUpperCase() + base.slice(1);
              const label = unidad ? `${nombreDisplay} (${unidad})` : nombreDisplay;

              // Si no hay dosificado teórico pero hay retenido o agregado, el
              // "Cargado al mixer" no debe ser negativo (confundiría al lector).
              // En ese caso reportamos el delta real: -ret + agr y marcamos con nota.
              let cargadoReal;
              let observacion = '';
              if (dosif === 0 && (ret > 0 || agr > 0)) {
                cargadoReal = -ret + agr;
                observacion = ' *';
              } else {
                cargadoReal = dosif - ret + agr;
              }

              rec.push([
                tx(label),
                dosif > 0 ? formatNumber(dosif, dosif < 10 ? 2 : 1) : "\u2014",
                ret > 0 ? formatNumber(ret, ret < 10 ? 2 : 1) : "\u2014",
                agr > 0 ? formatNumber(agr, agr < 10 ? 2 : 1) : "\u2014",
                `${formatNumber(cargadoReal, Math.abs(cargadoReal) < 10 ? 2 : 1)}${observacion}`,
              ]);
            }
            // Nota al pie si algún aditivo no tenía dosificación teórica
            const tieneIncompletos = rec.some((r) => r[4] && String(r[4]).endsWith('*'));

            doc.autoTable({
              startY: y,
              head: [[tx("Insumo"), tx("Dosificado"), tx("Retenido"), tx("Agregado"), tx("Cargado al mixer")]],
              body: rec,
              margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
              styles: { fontSize: 7, cellPadding: 1.5 },
              headStyles: { fillColor: C.secondary, textColor: C.white, fontSize: 7 },
              columnStyles: {
                0: { cellWidth: 45, fontStyle: "bold" },
                1: { halign: "right" },
                2: { halign: "right", textColor: [217, 119, 6] },
                3: { halign: "right", textColor: [22, 163, 74] },
                4: { halign: "right", fontStyle: "bold" },
              },
              theme: "grid",
              rowPageBreak: "avoid",
            });
            y = doc.lastAutoTable.finalY + 3;
            // P1.10 — nota al pie si hay aditivos sin dosificación teórica declarada
            if (tieneIncompletos) {
              doc.setFont("Helvetica", "italic");
              doc.setFontSize(6.5);
              doc.setTextColor(...C.muted);
              doc.text(
                tx("* Aditivo sin dosificación teórica en este pastón. Cargado al mixer = Agregado − Retenido (sin base dosificada). Verificar si debería figurar en el diseño."),
                margin,
                y
              );
              y += 4;
              doc.setTextColor(...C.text);
            }
          }
        }

        // Veredicto de prueba
        if (p.veredicto) {
          y = checkBreak(doc, y, pageH, margin, 12);
          const verdColor = p.veredicto === 'APROBADO' ? C.green : p.veredicto === 'RECHAZADO' ? C.danger : [243, 156, 18];
          doc.setFillColor(...verdColor);
          const verdLabel = p.veredicto === 'APROBADO' ? 'PRUEBA APROBADA' : p.veredicto === 'RECHAZADO' ? 'PRUEBA RECHAZADA' : 'OBSERVADO';
          doc.roundedRect(margin, y - 1, 40, 5, 1, 1, 'F');
          doc.setFontSize(7);
          doc.setFont('Helvetica', 'bold');
          doc.setTextColor(255, 255, 255);
          doc.text(verdLabel, margin + 20, y + 2.5, { align: 'center' });
          // Evaluator + date
          doc.setFont('Helvetica', 'normal');
          doc.setTextColor(...C.text);
          const verdMeta = [p.evaluadoPor, p.veredictoEmitidoPor && p.veredictoEmitidoPor !== p.evaluadoPor ? `Veredicto: ${p.veredictoEmitidoPor}` : null, p.fechaVeredicto ? new Date(p.fechaVeredicto).toLocaleDateString('es-AR') : null].filter(Boolean).join(' — ');
          if (verdMeta) doc.text(tx(verdMeta), margin + 42, y + 2.5);
          y += 6;
          // General observations
          if (p.observacionesGenerales) {
            doc.setFont('Helvetica', 'italic');
            doc.setFontSize(7);
            doc.setTextColor(...C.muted);
            const genObs = doc.splitTextToSize(tx(p.observacionesGenerales), contentW - 4);
            doc.text(genObs, margin + 2, y);
            y += genObs.length * 3 + 2;
          }
        }

        y += 3;
      }

      // Correcciones summary
      if (vaK?.correcciones_aplicadas?.length > 0) {
        y = checkBreak(doc, y, pageH, margin, 20);
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...C.text);
        doc.text(tx("Correcciones realizadas durante etapa de prueba:"), margin, y);
        y += 5;
        doc.setFont("Helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...C.muted);
        for (const corr of vaK.correcciones_aplicadas) {
          const corrLine = `Tras pastón #${corr.tras_paston}: ${corr.observaciones || "—"}`;
          const corrWrapped = doc.splitTextToSize(tx(corrLine), contentW - 6);
          doc.text(corrWrapped, margin + 3, y);
          y += corrWrapped.length * 3.2 + 1.5;
        }
        y += 2;
      }

      // Conclusion
      y = checkBreak(doc, y, pageH, margin, 15);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.text);
      const conclusionLine = `Conclusión: Dosificación verificada experimentalmente en ${pastonesList.length} bachada(s) de prueba.`;
      doc.text(tx(conclusionLine), margin, y);
      y += 4;
      if (vaK?.observaciones_generales) {
        doc.setFont("Helvetica", "normal");
        doc.setTextColor(...C.muted);
        const obsGen = doc.splitTextToSize(tx(vaK.observaciones_generales), contentW);
        doc.text(obsGen, margin, y);
        y += obsGen.length * 3.2 + 2;
      }
      y += 4;
    }
  }

  // ── Aviso legal (estado-dependent disclaimer) ───────────────────────────────
  {
    const disclaimerEstado = snapshot?.estado || "BORRADOR";
    const motorVer = traz?.motorVersion || resultado?.motorVersion;

    // El salto de página se decide DESPUÉS de conocer la altura real del
    // bloque (evita una página casi en blanco cuando el aviso entra al pie
    // de la página anterior).
    let disclaimerLines = [];
    if (disclaimerEstado === "BORRADOR") {
      disclaimerLines = [
        "Este documento es un BORRADOR de diseño de dosificación. No ha sido revisado ni aprobado para su uso en producción.",
        "",
        `Los valores calculados son estimaciones teóricas generadas por el Motor ${motorVer || 'HormiQual'}. ` +
        "Requieren validación experimental mediante bachadas de prueba y ensayos de resistencia antes de su adopción.",
        "",
        "Este informe no reemplaza el criterio profesional de un especialista competente ni los ensayos de laboratorio requeridos por las normas vigentes.",
      ];
    } else if (disclaimerEstado === "A_PRUEBA") {
      const va = snapshot?.valoresAdoptados;
      const nPastones = va?.pastones_realizados || 0;
      disclaimerLines = [
        "Este documento corresponde a un diseño de dosificación EN ETAPA DE PRUEBA.",
      ];
      if (nPastones > 0) {
        disclaimerLines.push("");
        disclaimerLines.push(`Pastones realizados: ${nPastones}`);
        if (va?.correcciones_aplicadas?.length > 0) {
          disclaimerLines.push(`Correcciones aplicadas: ${va.correcciones_aplicadas.length}`);
        }
      }
      disclaimerLines.push("");
      disclaimerLines.push(
        "Los valores mostrados incluyen las correcciones realizadas durante la etapa de prueba. " +
        "Requieren aprobación del responsable técnico."
      );
    } else if (disclaimerEstado === "PENDIENTE_REVISION") {
      disclaimerLines = [
        "Este documento está PENDIENTE DE REVISIÓN por el responsable técnico. No ha sido aprobado para su uso en producción.",
      ];
    } else if (disclaimerEstado === "APROBADO" || disclaimerEstado === "EN_PRODUCCION") {
      disclaimerLines = [
        "Este diseño de dosificación fue verificado experimentalmente y aprobado para su uso en producción " +
        "por el responsable técnico.",
        "",
        "Los valores indicados son los adoptados tras la verificación experimental. " +
        "La adecuación de esta dosificación a las condiciones específicas de cada obra es responsabilidad " +
        "del director técnico de la planta elaboradora.",
      ];
      if (snapshot?.aprobadoPor) {
        const fa = snapshot?.fechaAprobacion
          ? new Date(snapshot.fechaAprobacion).toLocaleDateString("es-AR")
          : "\u2014";
        disclaimerLines.push("");
        disclaimerLines.push(`Aprobado por: ${snapshot.aprobadoPor} \u2014 ${fa}`);
      }
      const hashFull = snapshot?.hashIntegridad;
      if (hashFull) {
        disclaimerLines.push(`Hash de integridad: ${hashFull.substring(0, 12)}`);
      }
    } else if (disclaimerEstado === "SUSPENDIDO") {
      const fechaSusp = snapshot?.fechaSuspension
        ? new Date(snapshot.fechaSuspension).toLocaleDateString("es-AR")
        : "\u2014";
      const motivoSusp = snapshot?.motivoSuspension || "\u2014";
      disclaimerLines = [
        `Este diseño de dosificación se encuentra SUSPENDIDO desde el ${fechaSusp}.`,
        `Motivo: ${motivoSusp}`,
        "No debe utilizarse en producción hasta que sea reactivado por el responsable técnico.",
      ];
    } else if (disclaimerEstado === "ARCHIVADO") {
      disclaimerLines = [
        "Este diseño de dosificación está ARCHIVADO y no se encuentra vigente.",
        "Se conserva como registro histórico.",
      ];
    } else {
      disclaimerLines = [
        "Los valores calculados son estimaciones de diseño sujetas a verificación experimental.",
      ];
    }

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    const disclaimerText = tx(disclaimerLines.join("\n"));
    const wrappedDisclaimer = doc.splitTextToSize(disclaimerText, contentW);
    // Altura real: separador(5) + título(5) + cuerpo + pad(4) + motor(6) + 2.
    const _discH = 5 + 5 + wrappedDisclaimer.length * 3.2 + 4 + (motorVer ? 6 : 0) + 2;
    y = checkBreak(doc, y, pageH, margin, _discH);

    doc.setDrawColor(...C.muted);
    doc.setLineWidth(0.15);
    doc.line(margin, y, pageW - margin, y);
    y += 5;
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...C.text);
    // Continúa la numeración de secciones (A, B, … K → L…) para que el Aviso
    // legal y los anexos queden identificables/citables (smoke: post-K sin letra).
    doc.text(tx(dynTitle("Aviso legal")), margin, y);
    y += 5;

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    // Izquierda (NO justify): el Aviso legal tiene líneas vacías de
    // separación de párrafo → align:'justify' producía Tw=Infinity y
    // fragmentaba el texto ("dede", kerning explotado). Regresión detectada
    // por smoke. Texto legal alineado a la izquierda es lo estándar.
    doc.text(wrappedDisclaimer, margin, y);
    y += wrappedDisclaimer.length * 3.2 + 4;

    if (motorVer) {
      doc.setFontSize(6.5);
      doc.text(tx(`Motor: ${motorVer}`), margin, y);
      y += 6;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Análisis de eficiencia de aditivos (opcional, antes de anexos)
  // ═══════════════════════════════════════════════════════════════════════════

  if (showSection('analisisEficiencia') && analisisEficiencia) {
    y = checkBreak(doc, y, pageH, margin, 40);
    y = sectionHeader(doc, dynTitle(tx("Análisis de eficiencia de aditivos")), margin, y, contentW);

    doc.setTextColor(...C.text);

    // Resumen
    const res = analisisEficiencia.resumen || {};
    const summaryRows = [];
    if (res.slumpInicial != null) summaryRows.push(["Asentamiento inicial", `${res.slumpInicial} cm`]);
    if (res.slumpFinal != null) summaryRows.push(["Asentamiento final", `${res.slumpFinal} cm`]);
    if (res.deltaSlumpTotal != null) summaryRows.push([tx("Variación total"), `${res.deltaSlumpTotal > 0 ? '+' : ''}${res.deltaSlumpTotal} cm`]);
    if (res.tiempoTotalMin != null) summaryRows.push(["Tiempo total", `${res.tiempoTotalMin} min`]);
    if (res.velocidadPerdidaActivaCmHora != null) summaryRows.push([tx("Velocidad de pérdida activa"), `${res.velocidadPerdidaActivaCmHora} cm/h`]);
    if (res.decaimientoNetoPromedioCmHora != null) summaryRows.push([tx("Decaimiento neto promedio"), `${res.decaimientoNetoPromedioCmHora} cm/h`]);
    if (res.cantAcciones != null) summaryRows.push(["Acciones de agregado", String(res.cantAcciones)]);

    if (summaryRows.length > 0) {
      doc.autoTable({
        startY: y, margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
        body: summaryRows, theme: "plain",
        styles: { fontSize: 7.5, cellPadding: 1.2 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
        rowPageBreak: "avoid",
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // Rendimiento por material
    if (res.rendimientoPromedioPorMaterial && Object.keys(res.rendimientoPromedioPorMaterial).length > 0) {
      y = checkBreak(doc, y, pageH, margin, 20);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.text(tx("Rendimiento promedio por material"), margin, y);
      y += 4;

      const rendRows = Object.entries(res.rendimientoPromedioPorMaterial).map(([mat, data]) => [
        mat, `${data.promedio} ${data.unidad}`, `${data.observaciones} ${data.observaciones === 1 ? tx('acción') : tx('acciones')}`,
      ]);
      doc.autoTable({
        startY: y, margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
        head: [["Material", "Rendimiento", "Datos"]],
        body: rendRows, theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 1.5 },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
        rowPageBreak: "avoid",
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // Detalle de acciones con efecto medido
    const conEfecto = (analisisEficiencia.accionesEficiencia || []).filter(e => e.deltaSlumpMm != null || e.deltaAirePct != null);
    if (conEfecto.length > 0) {
      y = checkBreak(doc, y, pageH, margin, 15 + conEfecto.length * 5);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.text(tx("Detalle de acciones con efecto medido"), margin, y);
      y += 4;

      doc.autoTable({
        startY: y, margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
        head: [["Material", "Cantidad", "Etapa", "Slump antes", tx("Slump después"), "Delta", "Rendimiento"]],
        body: conEfecto.map(e => [
          e.material,
          `${e.cantidad} ${e.unidad}`,
          e.etapa,
          e.slumpAntesMm != null ? `${(e.slumpAntesMm / 10).toFixed(1)} cm` : '—',
          e.slumpDespuesMm != null ? `${(e.slumpDespuesMm / 10).toFixed(1)} cm` : '—',
          e.deltaSlumpCm != null ? `${e.deltaSlumpCm > 0 ? '+' : ''}${e.deltaSlumpCm} cm` : '—',
          e.rendimientoLabel || '—',
        ]),
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 1.2 },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
        rowPageBreak: "avoid",
      });
      y = doc.lastAutoTable.finalY + 6;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Balance de materiales (opcional, antes de anexos)
  // ═══════════════════════════════════════════════════════════════════════════

  if (showSection('balanceMateriales') && analisisEficiencia?.balanceAgua) {
    const ba = analisisEficiencia.balanceAgua;
    y = checkBreak(doc, y, pageH, margin, 40);
    y = sectionHeader(doc, dynTitle(tx("Balance de materiales")), margin, y, contentW);

    doc.setTextColor(...C.text);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(8);
    doc.text(tx("Balance de agua y relación a/c"), margin, y);
    y += 4;

    const baRows = [
      ["Agua dosificada", `${ba.aguaDosificada} ${ba.unidad}`],
      ["Agua retenida", ba.aguaRetenida > 0 ? `${ba.aguaRetenida} ${ba.unidad}` : '—'],
      ["Agua cargada", `${ba.aguaCargada} ${ba.unidad}`],
      [tx("Agua agregada (acciones)"), ba.aguaAgregada > 0 ? `+${ba.aguaAgregada} ${ba.unidad}` : '—'],
      ["Agua real total", `${ba.aguaReal} ${ba.unidad}`],
    ];
    if (ba.acDosificada != null) baRows.push([tx("Relación a/c dosificada"), formatNumber(ba.acDosificada, 2)]);
    if (ba.acReal != null) baRows.push([tx("Relación a/c real"), formatNumber(ba.acReal, 2)]);
    if (ba.deltaAc != null) baRows.push([tx("Diferencia a/c"), `${ba.deltaAc > 0 ? '+' : ''}${formatNumber(ba.deltaAc, 3)} ${ba.acOk ? '[OK]' : tx('[ATENCIÓN]')}`]);

    doc.autoTable({
      startY: y, margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
      body: baRows, theme: "plain",
      styles: { fontSize: 7.5, cellPadding: 1.2 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 55 } },
      rowPageBreak: "avoid",
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SECTION J — Anexo Técnico (optional)
  // ══════════════════════════════════════════════════════════════════════════════
  if (includeAnexo) {
    const sections = buildDosificacionTraceSections(snapshot, { includeGlossary: includeGlosario });

    // Las advertencias ya se muestran en la Sección "Advertencias técnicas"
    // del cuerpo (lettered). Antes el Anexo repetía la misma lista como
    // "Advertencias y validaciones" → el informe mostraba las mismas
    // advertencias dos veces. Se excluye el stage "warnings" del Anexo
    // (también en includeFullTrace) para evitar el duplicado.
    const targetKeys = ["entradas", "agua", "ac", "cemento", "aditivos", "agregados", "resultado-final", "fuentes-calculo"];
    const anexoSections = (includeFullTrace ? sections : sections.filter((s) => targetKeys.includes(s.key)))
      .filter((s) => s.key !== "warnings");

    // El Anexo arranca en página nueva SOLO si queda poco espacio útil en la
    // actual. Antes hacía addPage() incondicional → el Aviso legal (corto)
    // dejaba la página anterior ~65% en blanco. Si hay lugar, el Anexo
    // continúa en la misma página (el bookmark apunta a donde arranque).
    if (y > pageH * 0.55) {
      doc.addPage();
      y = 18;
    } else {
      // Continúa en la misma página: separador + margen para que el título
      // del Anexo no quede pegado al Aviso legal anterior.
      y += 8;
      doc.setDrawColor(...C.muted);
      doc.setLineWidth(0.15);
      doc.line(margin, y, pageW - margin, y);
      y += 8;
    }
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...C.text);
    doc.text(tx(dynTitle("Anexo Técnico \u2014 Trazabilidad completa del cálculo")), margin, y);
    let anexoBookmark = null;
    try {
      anexoBookmark = doc.outline.add(null, "Anexo Técnico", { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
    } catch (_) { /* outline not supported */ }
    y += 10;

    anexoSections.forEach((section) => {
      // Decisión 2026-05-28 (auditor-pdf 2026-05-28): el sub-bloque
      // "Verificaciones CIRSOC 200:2024 (T.4.3, T.4.4)" del Anexo Técnico
      // incluye filas "Resultado: CUMPLE/NO CUMPLE" generadas por el
      // backend ([dosificacionTraceSections.js:739-752]). En DESCRIPTIVO
      // filtramos esas filas para no filtrar veredicto al Anexo (que
      // de otro modo escapa al guard de la sección H del cuerpo).
      let _sectionRows = section.rows;
      if (_modoNorm === 'DESCRIPTIVO' && section.key === 'verificaciones-cirsoc' && Array.isArray(_sectionRows)) {
        _sectionRows = _sectionRows.filter(r => {
          const label = Array.isArray(r) && r[0] ? String(r[0]).trim().toLowerCase() : '';
          return label !== 'resultado';
        });
      }
      y = checkBreak(doc, y, pageH, margin, 35);

      doc.setFillColor(...C.primary);
      doc.roundedRect(margin, y, contentW, 7, 1.2, 1.2, "F");
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...C.white);
      doc.text(tx(section.title), margin + 3, y + 4.8);
      try {
        doc.outline.add(anexoBookmark, tx(section.title), { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
      } catch (_) { /* outline not supported */ }
      y += 10;

      doc.setTextColor(...C.text);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(8);

      _sectionRows?.forEach(([label, value]) => {
        y = checkBreak(doc, y, pageH, margin, 12);
        doc.setFont("Helvetica", "bold");
        const labelLines = doc.splitTextToSize(tx(label), 48);
        doc.text(labelLines, margin + 2, y);
        doc.setFont("Helvetica", "normal");
        const valLines = doc.splitTextToSize(tx(String(value || "-")), contentW - 56);
        doc.text(valLines, margin + 52, y);
        y += Math.max(labelLines.length, valLines.length, 1) * 4.2;
      });

      section.lines?.forEach((line) => {
        y = checkBreak(doc, y, pageH, margin, 12);
        const isInfoNote = section.stageType === "warnings" && /^\[info:/i.test(line);
        if (section.stageType === "warnings") doc.setTextColor(...(isInfoNote ? C.blue : C.amber));
        // Strip internal [tag] prefixes for clean PDF output
        const lineClean = section.stageType === "warnings" ? line.replace(/^\[[\w\s\-\.:áéíóúñü]+\]\s*/i, "") : line;
        const bullet = isInfoNote ? 'i' : '-';
        const lines = doc.splitTextToSize(tx(`${bullet} ${lineClean}`), contentW - 6);
        doc.text(lines, margin + 2, y);
        doc.setTextColor(...C.text);
        y += lines.length * 3.6 + 0.5;
      });

      // Render correcciones como tabla si existe el campo estructurado
      if (Array.isArray(section.correccionesData) && section.correccionesData.length > 0) {
        y += 2;
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(...C.text);
        doc.text(tx("Correcciones por aditivos"), margin + 2, y);
        y += 3;
        doc.autoTable({
          startY: y,
          head: [["Aditivo", tx("Efecto"), tx("Agua antes"), tx("Agua después"), tx("Reducción"), tx("Observación")]],
          body: section.correccionesData.map(c => [c.aditivo, c.efecto, c.aguaAntes, c.aguaDespues, c.reduccion, c.nota || '\u2014']),
          margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
          theme: "grid",
          styles: { fontSize: 7, cellPadding: 1.5 },
          headStyles: { fillColor: C.secondary, textColor: C.white, fontSize: 7 },
          columnStyles: {
            0: { cellWidth: 38, fontStyle: "bold" },
            2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" },
          },
          rowPageBreak: "avoid",
        });
        y = doc.lastAutoTable.finalY + 4;
      }

      if (section.stageType === "aditivos" && section.aditivosDetalle?.length > 0) {
        const adBody = section.aditivosDetalle.map((ad) => {
          let corrDetail = "-";
          if (ad.correccion) {
            const c = ad.correccion;
            if (c.informativo) {
              corrDetail = tx("Informativo \u2014 sin incidencia en agua");
            } else if (c.modo === "AHORRO_AGUA" && c.aguaAntes != null) {
              corrDetail = tx(`${formatNumber(c.aguaAntes, 1)} -> ${formatNumber(c.aguaDespues, 1)} L/m³ (-${formatNumber(c.reduccionPct, 1)}%)`);
            } else if (c.modo === "AUMENTO_ASENTAMIENTO") {
              corrDetail = c.incrementoAsentamientoMm != null
                ? tx(`+${c.incrementoAsentamientoMm} mm asentamiento estimado`)
                : tx(c.nota || tx("Efecto reológico"));
            } else if (c.nota) {
              corrDetail = tx(c.nota);
            }
          }
          const refNorm = MODO_EFECTO_REF_NORMATIVA[ad.modoEfecto] || "";
          return [
            tx(aditivoShortName(ad.label) || "-"),
            tx(ad.modoEfetoLabel || "-"),
            ad.dosis != null ? `${formatNumber(ad.dosis, 2)} ${tx(ad.unidadLabel || UNIDAD_DOSIS_LABELS[ad.unidad] || ad.unidad || (esHRDC ? "% sobre cemento" : ""))}`.trim() : "-",
            ad.kgM3 != null ? tx(`${formatNumber(ad.kgM3, 3)} kg/m³`) : "-",
            corrDetail,
            tx(refNorm || "-"),
          ];
        });
        // Reservar espacio para que el header + filas no se partan en 2
        // páginas (el smoke vio el header repetido con solo 2 filas).
        y = checkBreak(doc, y, pageH, margin, 12 + adBody.length * 10);
        doc.autoTable({
          startY: y,
          head: [["Aditivo", "Modo de efecto", "Dosis", tx("kg/m³"), tx("Corrección aplicada"), "Ref. normativa"]],
          body: adBody,
          margin: { left: margin, right: margin },
          styles: { fontSize: 7, cellPadding: 1.8, overflow: "linebreak" },
          headStyles: { fillColor: C.secondary, textColor: C.white },
          alternateRowStyles: { fillColor: C.light },
          rowPageBreak: "avoid",
          columnStyles: {
            0: { cellWidth: 32 },
            1: { cellWidth: 26 },
            2: { cellWidth: 20, halign: "center" },
            3: { cellWidth: 18, halign: "center" },
            4: { cellWidth: "auto" },
            5: { cellWidth: 36, fontSize: 6.5 },
          },
        });
        y = doc.lastAutoTable.finalY + 4;
      }

      if (section.stageType === "fuentes" && section.fuentesCalculo?.length > 0) {
        // Split fuentesCalculo into thematic sub-tables for readability
        const fuenteCategories = [
          { label: "Agua y relación a/c", match: (p) => /agua|a\/c|asentamiento|relaci/i.test(p) },
          { label: "Cemento", match: (p) => /cemento|cementante/i.test(p) },
          { label: "Agregados", match: (p) => /agregado|tmn|mf|módulo|forma|granul/i.test(p) },
          { label: "Aditivos", match: (p) => /aditivo/i.test(p) },
          { label: "Parámetros generales", match: () => true }, // catch-all
        ];
        const categorized = fuenteCategories.map(cat => ({
          ...cat,
          items: [],
        }));
        const assigned = new Set();
        for (const f of section.fuentesCalculo) {
          for (const cat of categorized) {
            if (!assigned.has(f) && cat.match(f.parametro || "")) {
              cat.items.push(f);
              assigned.add(f);
              break;
            }
          }
        }

        // Detect if design uses a mezcla (to fix origin for forma/MF)
        const _hasMezclaFuente = section.fuentesCalculo.some((x) => x.origenTipo === 'MEZCLA');
        const _mezclaNombreRaw = section.fuentesCalculo.find((x) => x.origenTipo === 'MEZCLA')?.origenRef || null;
        // Append codigo to ensure traceability throughout the document
        const _mezclaNombre = _mezclaNombreRaw && mezclaCodigo && !_mezclaNombreRaw.includes(mezclaCodigo)
          ? `${_mezclaNombreRaw} (${mezclaCodigo})`
          : _mezclaNombreRaw;

        const fuenteRowMapper = (f) => {
          let valor = f.valor;
          if (valor == null || valor === "") valor = "-";
          else if (typeof valor === "number") valor = formatNumber(valor);
          else valor = tx(String(valor));
          if (f.parametro === "Forma del agregado") valor = tx(FORMA_LABELS[valor] || valor);

          // Fix origin for forma/MF stored with old "Usuario" label
          let origenTipo = f.origenTipo;
          let regla = f.regla;
          let origenRef = f.origenRef;
          if (_hasMezclaFuente && f.origenTipo === 'INPUT_USUARIO') {
            if (f.parametro === "Forma del agregado") {
              origenTipo = 'MEZCLA';
              origenRef = origenRef || _mezclaNombre;
              regla = 'Derivada de la clasificación de los agregados gruesos (ensayos granulométricos)';
            } else if (f.parametro && f.parametro.includes("dulo de finura")) {
              origenTipo = 'MEZCLA';
              origenRef = origenRef || _mezclaNombre;
              regla = 'Tomado del cálculo granulométrico de la mezcla seleccionada';
            }
          }

          const origenLabel = tx(ORIGEN_TIPO_LABELS[origenTipo] || origenTipo || "-");
          return [
            tx(f.parametro || "-"),
            tx(polishTraceText(String(valor))),
            tx(origenRef || "-"),
            origenLabel,
            tx(polishTraceText(translateRegla(regla))),
            tx(polishTraceText(f.observacion || "-")),
          ];
        };
        const fuenteColStyles = {
          0: { cellWidth: 32 },
          1: { cellWidth: 18 },
          2: { cellWidth: 26 },
          3: { cellWidth: 18 },
          4: { cellWidth: "auto" },
          5: { cellWidth: 28 },
        };

        for (const cat of categorized) {
          if (cat.items.length === 0) continue;
          y = checkBreak(doc, y, pageH, margin, 20);
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(7.5);
          doc.setTextColor(...C.secondary);
          doc.text(tx(cat.label), margin + 2, y);
          y += 4;
          doc.autoTable({
            startY: y,
            head: [[tx("Parámetro"), "Valor", "Origen", "Tipo origen", "Regla aplicada", tx("Observación")]],
            body: cat.items.map(fuenteRowMapper),
            margin: { left: margin, right: margin },
            styles: { fontSize: 6.5, cellPadding: 1.6, overflow: "linebreak" },
            headStyles: { fillColor: C.primary, textColor: C.white },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: fuenteColStyles,
            rowPageBreak: "avoid",
          });
          y = doc.lastAutoTable.finalY + 4;
        }
      } else if (section.table) {
        doc.autoTable({
          startY: y,
          head: [section.table.headers.map(tx)],
          body: section.table.rows.map((row) => row.map(tx)),
          margin: { left: margin, right: margin },
          styles: { fontSize: 7.5, cellPadding: 2 },
          headStyles: { fillColor: C.secondary, textColor: C.white },
          alternateRowStyles: { fillColor: C.light },
        });
        y = doc.lastAutoTable.finalY + 4;
      } else {
        y += 2;
      }
    });

    // ── Anexo: Trabajabilidad (modelo original vs adaptaciones) ──
    const trabTraz = traz?.trabajabilidad;
    // Fallback: get TMN and offset from resultado or snapshot if not in trazabilidad
    if (trabTraz && !trabTraz.tmnMm) {
      trabTraz.tmnMm = snapshot?.resultado?.tmnMm || snapshot?.tmnMm || null;
    }
    if (trabTraz && trabTraz.offsetTmn == null && trabTraz.tmnMm) {
      // Calculate offset inline
      const _offsets = [{tmn:9.5,o:5},{tmn:13.2,o:3.2},{tmn:19,o:0},{tmn:26.5,o:-2.5},{tmn:37.5,o:-5},{tmn:50,o:-6.8}];
      const _exact = _offsets.find(x => Math.abs(x.tmn - trabTraz.tmnMm) < 0.5);
      trabTraz.offsetTmn = _exact ? _exact.o : 0;
    }
    if (trabTraz) {
      y = checkBreak(doc, y, pageH, margin, 60);
      doc.setFillColor(...C.primary);
      doc.roundedRect(margin, y, contentW, 7, 1.2, 1.2, 'F');
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...C.white);
      doc.text(tx('Trabajabilidad \u2014 Modelo original vs Adaptaciones HormiQual'), margin + 3, y + 4.8);
      y += 10;
      doc.setTextColor(...C.text);
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);

      const trabRows = [
        ['Modelo original', 'Ken Day (2006) / Shilstone (1990)'],
        [tx('F\u00f3rmula FdA'), 'FdA = SE + Cc - 7,5 + 0,25 x (Aire - 1)   (Cc = cemento_kg_m3 / 42,6)'],
        ['Alcance original', tx('Dm\u00e1x 19\u201320 mm')],
        ['Rangos originales', 'FdA 22-25: 50-90 mm | 25-27: 80-100 mm | 27-31: >= 200 mm'],
        ['', ''],
        [tx('Adaptaci\u00f3n (a)'), tx('Correcci\u00f3n por TMN: offset te\u00f3rico (curvas Fuller)')],
        ['TMN mezcla', `${trabTraz.tmnMm || '—'} mm`],
        ['Offset aplicado', `${trabTraz.offsetTmn != null ? (trabTraz.offsetTmn > 0 ? '+' : '') + formatNumber(trabTraz.offsetTmn, 1, true) : '—'}`],
        ['', ''],
        [tx('Adaptaci\u00f3n (b)'), 'Rangos de asentamiento modernos (policarboxilato)'],
        ['Estructural', '80\u2013120 mm'],
        [tx('Bombeable est\u00e1ndar'), '120\u2013150 mm'],
        ['Bombeable fluido', '140\u2013180 mm'],
        ['Fluido superplastificado', '180\u2013220 mm'],
        ['', ''],
        [tx('Estado validaci\u00f3n'), 'PENDIENTE \u2014 Requiere datos de pastones de prueba'],
      ];
      trabRows.forEach(([label, value]) => {
        if (!label && !value) { y += 2; return; }
        y = checkBreak(doc, y, pageH, margin, 8);
        doc.setFont('Helvetica', label.startsWith('Adaptaci') ? 'bold' : 'normal');
        doc.text(label, margin + 2, y);
        doc.setFont('Helvetica', 'normal');
        doc.text(String(value || ''), margin + 52, y);
        y += 4;
      });
      y += 4;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ANEXO MATERIALES — Granulometrías y caracterizaciones de agregados
  // ══════════════════════════════════════════════════════════════════════════════
  if (includeAnexoMateriales && materialesData) {
    const agItems = traz?.agregadosDistribucion?.items || [];
    const agregadosConData = agItems.filter(ag => ag.idAgregado && materialesData[ag.idAgregado]);

    if (agregadosConData.length > 0) {
      doc.addPage();
      y = 18;
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...C.text);
      doc.text(tx("Anexo \u2014 Materiales granulares: granulometrías y caracterización"), margin, y);
      try {
        doc.outline.add(null, "Anexo Materiales", { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
      } catch (_) { /* outline not supported */ }
      y += 4;
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      doc.text(tx("Datos del último ensayo vigente de cada fracción que integra la mezcla granular."), margin, y);
      y += 8;

      agregadosConData.forEach((ag, agIdx) => {
        const caract = materialesData[ag.idAgregado];
        if (!caract) return;

        // ── Aggregate sub-header ──
        y = checkBreak(doc, y, pageH, margin, 50);
        if (agIdx > 0) y += 4;

        doc.setFillColor(...C.secondary);
        doc.roundedRect(margin, y, contentW, 7, 1.2, 1.2, "F");
        doc.setFont("Helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...C.white);
        doc.text(tx(`${agIdx + 1}. ${ag.nombre}`), margin + 3, y + 4.8);
        const pctLabel = ag.proporcionNormalizada != null ? `${formatNumber(ag.proporcionNormalizada, 1)}%` : "";
        if (pctLabel) {
          doc.setFontSize(8);
          doc.text(pctLabel, pageW - margin - 3, y + 4.8, { align: "right" });
        }
        y += 10;

        // ── Characterization table ──
        const caractRows = [];
        const addRow = (label, data, fmt) => {
          if (!data) return;
          const val = fmt ? fmt(data.valor) : formatNumber(data.valor);
          const fecha = data.fechaEnsayo ? new Date(data.fechaEnsayo).toLocaleDateString("es-AR") : "-";
          const estado = data.estado === "VENCIDO" ? "Vencido" : "Vigente";
          caractRows.push([tx(label), val, fecha, estado]);
        };

        addRow("TMN (mm)", caract.tmnMm, v => formatNumber(v, 1));
        addRow("Módulo de finura", caract.moduloFinura, v => formatNumber(v, 2));
        addRow("Dens. rel. ap. SSS", caract.densidadRelativaAparenteSSS, v => formatNumber(v, 3));
        addRow("Dens. rel. ap. seca", caract.densidadRelativaAparenteSeca, v => formatNumber(v, 3));
        addRow("Dens. relativa real", caract.densidadRelativaReal, v => formatNumber(v, 3));
        addRow("Absorción (%)", caract.absorcionPct, v => formatParamValue('absorcion', v));
        addRow("Desgaste LA (%)", caract.desgasteLAPct, v => formatNumber(v, 1));
        addRow("Lajosidad (%)", caract.lajosidadPct, v => formatNumber(v, 1));
        addRow("Elongacion (%)", caract.elongacionPct, v => formatNumber(v, 1));
        addRow("Pasa N. 200 (%)", caract.pasa200Pct, v => formatNumber(v, 2));

        if (caractRows.length > 0) {
          y = checkBreak(doc, y, pageH, margin, 20);
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(...C.primary);
          doc.text(tx("Caracterización"), margin + 1, y);
          y += 4;

          doc.autoTable({
            startY: y,
            head: [[tx("Propiedad"), "Valor", "Fecha ensayo", "Estado"]],
            body: caractRows,
            margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
            styles: { fontSize: 7.5, cellPadding: 1.8 },
            headStyles: { fillColor: C.primary, textColor: C.white },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: {
              0: { cellWidth: 40, fontStyle: "bold" },
              1: { cellWidth: 25, halign: "right" },
              2: { cellWidth: 25 },
              3: { cellWidth: 20 },
            },
          });
          y = doc.lastAutoTable.finalY + 5;
        }

        // ── Granulometría table ──
        const granu = caract.granulometria;
        const tamices = granu?.valor?.tamices;
        if (tamices && tamices.length > 0) {
          y = checkBreak(doc, y, pageH, margin, 25);
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(...C.primary);
          const granuFecha = granu.fechaEnsayo ? new Date(granu.fechaEnsayo).toLocaleDateString("es-AR") : "";
          const granuEstado = granu.estado === "VENCIDO" ? " (vencido)" : "";
          doc.text(tx(`Granulometría${granuFecha ? ` \u2014 ${granuFecha}${granuEstado}` : ""}`), margin + 1, y);
          y += 4;

          // Sort tamices by size descending
          const sorted = [...tamices].sort((a, b) => (b.tamanio || b.tamiz || 0) - (a.tamanio || a.tamiz || 0));

          const tamHead = [tx("Tamiz (mm)"), tx("% Ret. parcial"), tx("% Ret. acum."), tx("% Pasante")];
          const tamBody = sorted.map(t => {
            const size = t.tamanio ?? t.tamiz ?? "-";
            const retParcial = t.retenidoParcialPct ?? t.pctRetenido ?? "-";
            const retAcum = t.retenidoAcumPct ?? t.pctRetenidoAcumulado ?? "-";
            const pasante = t.pasantePct ?? t.pctPasante ?? "-";
            return [
              typeof size === "number" ? formatNumber(size, size < 1 ? 3 : 1) : String(size),
              typeof retParcial === "number" ? formatNumber(retParcial, 1) : String(retParcial),
              typeof retAcum === "number" ? formatNumber(retAcum, 1) : String(retAcum),
              typeof pasante === "number" ? formatNumber(pasante, 1) : String(pasante),
            ];
          });

          doc.autoTable({
            startY: y,
            head: [tamHead],
            body: tamBody,
            margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
            styles: { fontSize: 7, cellPadding: 1.5, halign: "center" },
            headStyles: { fillColor: C.secondary, textColor: C.white },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: {
              0: { halign: "left", fontStyle: "bold", cellWidth: 25 },
            },
          });
          y = doc.lastAutoTable.finalY + 5;
        }

        // ── Dosification data for this aggregate ──
        const dosifRow = [];
        if (ag.kgM3 != null) dosifRow.push([tx("Dosificación"), tx(`${formatNumber(ag.kgM3, 1)} kg/m³`)]);
        if (ag.densidad != null) dosifRow.push([tx("Densidad usada en cálculo"), formatNumber(ag.densidad, 3)]);
        if (ag.absorcionPct != null) dosifRow.push([tx("Absorción usada en cálculo"), `${formatParamValue('absorcion', ag.absorcionPct)}%`]);
        if (ag.densidadOrigen) dosifRow.push([tx("Origen densidad"), tx(ag.densidadOrigen === "ENSAYO_AGREGADO" ? "Ensayo" : "Ficha técnica")]);
        if (ag.absorcionOrigen) dosifRow.push([tx("Origen absorción"), tx(ag.absorcionOrigen === "ENSAYO_AGREGADO" ? "Ensayo" : "Ficha técnica")]);

        if (dosifRow.length > 0) {
          y = checkBreak(doc, y, pageH, margin, 15);
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(...C.primary);
          doc.text(tx("Datos usados en la dosificación"), margin + 1, y);
          y += 4;

          doc.autoTable({
            startY: y,
            body: dosifRow,
            margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
            styles: { fontSize: 7.5, cellPadding: 1.5 },
            alternateRowStyles: { fillColor: C.light },
            columnStyles: {
              0: { fontStyle: "bold", cellWidth: 50 },
            },
            theme: "plain",
          });
          y = doc.lastAutoTable.finalY + 3;
        }
      });

      // Footnote
      y = checkBreak(doc, y, pageH, margin, 12);
      y += 3;
      doc.setDrawColor(...C.muted);
      doc.setLineWidth(0.15);
      doc.line(margin, y, pageW - margin, y);
      y += 4;
      doc.setFont("Helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(...C.muted);
      doc.text(tx("Los datos corresponden al último ensayo registrado de cada tipo al momento de generar el informe."), margin, y);
      y += 3;
      doc.text(tx("Verifique la vigencia de los ensayos en el módulo de calidad antes de usar esta información en producción."), margin, y);
      y += 6;
    }
  }

  // ── APPENDIX — Documentaci\u00f3n de trabajabilidad (si se calcul\u00f3) ──────────
  if (trab) {
    doc.addPage();
    y = 16;
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...C.primary);
    doc.text(tx('Ap\u00e9ndice \u2014 Evaluaci\u00f3n de trabajabilidad'), margin, y);
    if (doc.outline) doc.outline.add(null, 'Apéndice — Trabajabilidad', { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
    y += 6;

    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(tx('Documentaci\u00f3n de los indicadores y m\u00e9todos utilizados en la secci\u00f3n I del informe.'), margin, y);
    y += 6;

    const appendixSections = [
      { title: 'Factor de Grosor (FdG)', text: 'Proporci\u00f3n de la fracci\u00f3n gruesa (retenida en 9,5 mm) respecto al total retenido en 2,36 mm. FdG = (% Ret. Acum. 9,5 mm / % Ret. Acum. 2,36 mm) x 100. Valores altos indican mezcla dominada por gruesos; valores bajos, abundancia de material intermedio. Rango t\u00edpico: 40-80%.' },
      { title: 'Factor de Trabajabilidad (FdT)', text: 'FdT (Factor de Trabajabilidad, Shilstone 1990) = % Pasante 2,36 mm + 2,5 x (Cc - 5,0), donde Cc = cementante (kg/m³) / 42,6. El divisor 42,6 kg corresponde a bolsas de 94 lb del modelo original de Ken Day (2006). El valor Cc = 5,0 es la referencia central (~213 kg/m³ de cemento). La corrección por Cc incorpora el efecto del contenido de pasta sobre la trabajabilidad: sin ella, mezclas ricas en cemento aparecen en Zona V (muy gruesa) aunque tengan suficiente pasta. Sin cementante, FdT = % Pasante 2,36 mm (solo esqueleto árido). Rango típico: 28-44%.' },
      { title: 'Superficie Específica (SE)', text: 'Estimación de la superficie total de las partículas por unidad de masa. SE = Suma(% retenido fracción x factor SE) / 100. Los factores crecen exponencialmente con la finura: pequeños cambios en la fracción fina tienen gran impacto. Rango típico: 15-35.' },
      { title: 'Factor de Aptitud (FdA) \u2014 Ken Day (2006)', text: 'FdA = SE + Cc - 7,5 + 0,25 x (Aire - 1), donde Cc = cementante (kg/m³) / 42,6 (bolsas de 94 lb, Day 2006). Integra la granulometría (SE) con el contenido de pasta (Cc) y el aire. Constante -7,5: calibración Day para Dmax 19 mm. Factor 0,25: efecto lubricante del aire. Rangos corregidos por TMN: <16 inutilizable; 16-20 áspera; 20-22 pisos; 22-24 estructural (80-120 mm); 24-26 bombeable (120-150 mm); 26-28 bombeable fluido (140-180 mm); 28-31 fluido superplast. (180-220 mm); >31 exceso de finos.' },
      { title: 'Gráfico de Shilstone', text: 'Representa FdT vs FdG en 5 zonas: Zona II (Deseable) es la banda diagonal central con buen equilibrio. Zona I (Mal Graduado) tiene exceso de gruesos y déficit de intermedios con riesgo de segregación. Zona III (Óptima para Dmax<=12,5 mm). Zona IV (Muy Fino) con exceso de finos, mayor demanda de agua y retracción. Zona V (Muy Grueso) con déficit de fino, mezcla áspera.' },
      { title: 'Coherencia FdA vs asentamiento', text: 'El sistema compara el asentamiento estimado por el FdA contra el objetivo de dise\u00f1o. Si hay discrepancia, sugiere ajustar la proporci\u00f3n de finos, el cementante o la dosis de aditivo.' },
      { title: 'Limitaciones', text: 'La tabla FdA-asentamiento fue calibrada para Dmax 19-20 mm (Ken Day). Para otros TMN los rangos son orientativos. El gr\u00e1fico de Shilstone s\u00ed es independiente del TMN. Estos indicadores no reemplazan el past\u00f3n de prueba. Factores no contemplados: forma y textura de part\u00edculas, arcillas, temperatura, tiempo de transporte, compatibilidad cemento-aditivo.' },
    ];

    doc.setTextColor(...C.text);
    for (const sec of appendixSections) {
      if (y > pageH - 20) { doc.addPage(); y = margin + 5; }
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(tx(sec.title), margin + 2, y);
      y += 3.5;
      doc.setFont('Helvetica', 'normal');
      doc.setFontSize(7);
      const lines = doc.splitTextToSize(tx(sec.text), contentW - 4);
      for (const line of lines) {
        if (y > pageH - 8) { doc.addPage(); y = margin + 5; }
        doc.text(line, margin + 2, y);
        y += 3;
      }
      y += 2;
    }

    // References
    if (y > pageH - 15) { doc.addPage(); y = margin + 5; }
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('Referencias', margin + 2, y);
    y += 3.5;
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.muted);
    const refs = [
      'Shilstone, J.M. (1990). "Concrete Mixture Optimization." Concrete International, Vol. 12, N. 6, pp. 33-39. ACI.',
      'Day, K.W. (2006). Concrete Mix Design, Quality Control and Specification. 3ra ed., Taylor & Francis.',
    ];
    for (const ref of refs) {
      doc.text(tx(ref), margin + 2, y);
      y += 3;
    }
    doc.setTextColor(...C.text);
  }

  // ── ANEXO — Granulometrías individuales de los agregados ──────────────────
  // Renders one mini-table per aggregate with the full sieve curve, plus test date / sample ID.
  // This allows full traceability of values like the % p300 used in the pulverulento check.
  {
    const agregadosConCurva = (resultado?.agregados || []).filter(
      (ag) => Array.isArray(ag.granulometriaPuntos) && ag.granulometriaPuntos.length > 0
    );
    if (agregadosConCurva.length > 0) {
      doc.addPage();
      y = 16;
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...C.primary);
      doc.text(tx('Anexo \u2014 Granulometrias individuales de los agregados'), margin, y);
      if (doc.outline) {
        try { doc.outline.add(null, 'Anexo — Granulometrias individuales', { pageNumber: doc.internal.getCurrentPageInfo().pageNumber }); } catch { /* ignore */ }
      }
      y += 6;

      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      doc.text(tx('Curvas granulométricas individuales utilizadas para construir la mezcla combinada y los cálculos de pulverulento, módulo de finura y TMN.'), margin, y);
      y += 6;
      doc.setTextColor(...C.text);

      // Build alias map (F1, F2, G1, G2 ...) consistent with the rest of the report
      let finoIdx = 1, gruesoIdx = 1, otroIdx = 1;
      const aliasOf = (ag) => {
        const tipo = (ag.tipo || '').toLowerCase();
        if (tipo.includes('fino') || /arena/i.test(ag.nombre || '')) return `F${finoIdx++}`;
        if (tipo.includes('grueso') || /grava|piedra|ripio/i.test(ag.nombre || '')) return `G${gruesoIdx++}`;
        return `A${otroIdx++}`;
      };

      // Format date as dd/mm/yyyy if it's an ISO string
      const fmtFecha = (raw) => {
        if (!raw) return null;
        const s = String(raw);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        return s;
      };

      for (const ag of agregadosConCurva) {
        const alias = aliasOf(ag);
        // Header for this aggregate
        y = checkBreak(doc, y, pageH, margin, 30);
        doc.setFont('Helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...C.secondary);
        doc.text(tx(`${ag.nombre || 'Agregado sin nombre'} (${alias})`), margin, y);
        y += 4;

        const fechaTxt = fmtFecha(ag.granulometriaFecha) || '\u2014';
        const ensayoTxt = ag.granulometriaEnsayoId != null ? `#${ag.granulometriaEnsayoId}` : '\u2014';
        const sinDato = !ag.granulometriaFecha && ag.granulometriaEnsayoId == null;
        doc.setFont('Helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...C.muted);
        doc.text(tx(`Ensayo: ${fechaTxt}   |   Muestra: ${ensayoTxt}${sinDato ? '   (Dato no registrado)' : ''}`), margin, y);
        y += 4;
        doc.setTextColor(...C.text);

        // Sort sieves descending (large → small) for the typical granulometry display
        const puntos = [...ag.granulometriaPuntos]
          .filter((p) => p.aberturaMm != null && p.pasaPct != null)
          .sort((a, b) => b.aberturaMm - a.aberturaMm);

        const granoBody = puntos.map((p) => {
          const tamizLabel = p.tamiz || (p.aberturaMm < 1
            ? `${formatNumber(p.aberturaMm * 1000, 0)} um`
            : `${formatNumber(p.aberturaMm, p.aberturaMm < 10 ? 2 : 1)} mm`);
          return [tx(tamizLabel), `${formatNumber(p.pasaPct, 1)} %`];
        });

        doc.autoTable({
          startY: y,
          head: [[tx('Tamiz'), tx('% Pasa')]],
          body: granoBody,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 1.2, textColor: C.text },
          headStyles: { fillColor: C.headerBg || C.secondary, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
          alternateRowStyles: { fillColor: C.lightBg || [248, 248, 248] },
          margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
          columnStyles: { 0: { cellWidth: 32 }, 1: { halign: 'right', cellWidth: 28 } },
          tableWidth: 60,
        });
        y = doc.lastAutoTable.finalY + 6;
      }

      // Footer note
      y = checkBreak(doc, y, pageH, margin, 10);
      doc.setFont('Helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(...C.muted);
      doc.text(tx('Las curvas corresponden al ultimo ensayo vigente registrado para cada agregado. Verifique vigencia antes de usar en produccion.'), margin, y);
      y += 4;
      doc.setTextColor(...C.text);
    }
  }

  // ── SECTION — Historial del diseño (optional) ──────────────────────────────
  if (includeHistorial && historialData?.length > 0) {
    doc.addPage();
    y = 16;

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...C.primary);
    doc.text(tx("Historial del diseño"), margin, y);
    if (doc.outline) {
      doc.outline.add(null, "Historial del diseño", { pageNumber: doc.internal.getCurrentPageInfo().pageNumber });
    }
    y += 8;

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(tx("Registro cronológico de eventos del ciclo de vida de este diseño."), margin, y);
    y += 6;

    const TIPO_EVENTO_LABELS = {
      creacion: "Creación", modificacion: "Modificación", calculo: "Cálculo",
      cambio_estado: "Cambio de estado", nueva_version: "Nueva versión",
      aprobacion: "Aprobación", rechazo: "Rechazo", suspension: "Suspensión",
      reactivacion: "Reactivación", archivado: "Archivado",
    };
    const ESTADO_LABELS_PDF = {
      BORRADOR: "Borrador", A_PRUEBA: "A prueba", PENDIENTE_REVISION: "Pend. revisión",
      APROBADO: "Aprobado", SUSPENDIDO: "Suspendido", ARCHIVADO: "Archivado",
    };

    const histRows = historialData.map(ev => {
      const fecha = ev.createdAt ? new Date(ev.createdAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
      const tipo = TIPO_EVENTO_LABELS[ev.tipoEvento] || ev.tipoEvento || "Cambio";
      const transicion = ev.estadoAnterior && ev.estadoNuevo
        ? `${ESTADO_LABELS_PDF[ev.estadoAnterior] || ev.estadoAnterior} -> ${ESTADO_LABELS_PDF[ev.estadoNuevo] || ev.estadoNuevo}`
        : ev.estadoNuevo ? (ESTADO_LABELS_PDF[ev.estadoNuevo] || ev.estadoNuevo) : "-";
      return [fecha, tipo, transicion, ev.usuario || "-", ev.motivo || "-"];
    });

    doc.autoTable({
      startY: y,
      head: [["Fecha", "Evento", "Estado", "Usuario", "Motivo"].map(h => tx(h))],
      body: histRows,
      theme: "grid",
      styles: { font: "Helvetica", fontSize: 7, cellPadding: 2, textColor: C.dark },
      headStyles: { fillColor: C.primary, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 26 },
        2: { cellWidth: 34 },
        3: { cellWidth: 28 },
        4: { cellWidth: "auto" },
      },
      margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ── Footers & headers ────────────────────────────────────────────────────────
  const dosReportId = generateReportId("DOS");
  const dosifEstado = snapshot?.estado || "BORRADOR";
  const dosifVersion = snapshot?.version || 1;
  const versionSuffix = ` v${dosifVersion}`;
  const reportIdWithVersion = dosReportId + versionSuffix;

  // Estado + versión + hash in footer
  const estadoLabel = {
    BORRADOR: "BORRADOR", A_PRUEBA: "A PRUEBA", PENDIENTE_REVISION: "PENDIENTE REVISION",
    APROBADO: "APROBADO", SUSPENDIDO: "SUSPENDIDO", ARCHIVADO: "ARCHIVADO",
  }[dosifEstado] || dosifEstado;

  const hashCorto = snapshot?.hashIntegridad ? snapshot.hashIntegridad.substring(0, 12) : null;
  const codigoStr = snapshot?.codigo ? ` | ${snapshot.codigo}` : '';
  const hashStr = hashCorto ? ` | #${hashCorto}` : '';
  const footerReportId = `${reportIdWithVersion} | ${estadoLabel}${codigoStr}${hashStr}`;

  addFooter(doc, margin, { reportId: footerReportId, reportTitle: reportTitle, reportDate: fmtDate(), estado: dosifEstado });

  // ── Watermarks by estado ──────────────────────────────────────────────────────
  const watermarkText = {
    BORRADOR: "BORRADOR - DOCUMENTO SIN VALIDEZ",
    A_PRUEBA: "A PRUEBA - VALIDEZ EXPERIMENTAL",
    PENDIENTE_REVISION: "PENDIENTE DE REVISION",
    SUSPENDIDO: "SUSPENDIDO - NO USAR",
    ARCHIVADO: "ARCHIVADO - VERSION NO VIGENTE",
  }[dosifEstado] || null;

  if (watermarkText) {
    const watermarkColor = {
      BORRADOR: [180, 180, 180],
      A_PRUEBA: [243, 156, 18],
      PENDIENTE_REVISION: [230, 126, 34],
      SUSPENDIDO: [231, 76, 60],
      ARCHIVADO: [120, 120, 120],
    }[dosifEstado] || [180, 180, 180];

    // Dividir el texto largo en dos líneas para que el rotado no exceda la página
    const watermarkLines = watermarkText.includes(' - ')
      ? watermarkText.split(' - ')
      : [watermarkText];
    // Ajustar tamaño según texto más largo
    const maxLen = Math.max(...watermarkLines.map(l => l.length));
    const fontSize = maxLen > 18 ? 28 : maxLen > 12 ? 36 : 42;

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.12 }));
      doc.setFontSize(fontSize);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(...watermarkColor);
      // P2.8 — el watermark se cortaba en el margen superior porque jsPDF usa
      // baseline 'alphabetic' por default; al rotar 45° el texto sale empujado
      // hacia arriba. `baseline: 'middle'` centra el texto sobre su punto de
      // anclaje, así (cx, cy) es el centro REAL del watermark.
      const cx = pageW / 2;
      const cy = pageH / 2;
      const textOpts = { align: "center", angle: 45, baseline: "middle" };
      if (watermarkLines.length === 2) {
        // Dos líneas: una arriba y otra abajo del centro (separación medida
        // perpendicular al ángulo de rotación, ~5.5 mm en la vertical)
        const lineSpacing = fontSize * 0.35; // mm — más ajustado
        doc.text(tx(watermarkLines[0]), cx, cy - lineSpacing, textOpts);
        doc.text(tx(watermarkLines[1]), cx, cy + lineSpacing, textOpts);
      } else {
        doc.text(tx(watermarkLines[0]), cx, cy, textOpts);
      }
      doc.restoreGraphicsState();
    }
  }

  // Approval info is shown in the header (lines 456-463). No additional stamp needed.

  // ── Save ──────────────────────────────────────────────────────────────────────
  const fileName = snapshot?.isDraft
    ? `diseno_dosificacion_borrador_${fmtDateFile()}.pdf`
    : `dosificacion_${slug(reportTitle)}_${fmtDateFile()}.pdf`;
  // CU8: en modo 'doc' devolvemos el jsPDF sin descargar (el caller hace
  // doc.output('bloburl') para el preview embebido). Default 'save' = histórico.
  if (outputMode === 'doc') return doc;
  doc.save(fileName);
}
