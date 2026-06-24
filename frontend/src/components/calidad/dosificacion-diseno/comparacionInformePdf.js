import jsPDF from "jspdf";
import "jspdf-autotable";

const C = {
  primary: [18, 52, 86],
  secondary: [66, 81, 99],
  light: [245, 247, 250],
  text: [31, 41, 55],
  muted: [107, 114, 128],
  white: [255, 255, 255],
  green: [21, 128, 61],
  red: [220, 38, 38],
};

const FOOTER_RESERVE = 18;
const METODO_LABELS = { HORMIQUAL: "HormiQual 1.0", ICPA: "HormiQual", ACI_211: "HormiQual" };
const ESTADO_LABELS = {
  BORRADOR: "Borrador", A_PRUEBA: "A prueba", PENDIENTE_REVISION: "Pendiente revision",
  APROBADO: "Aprobado", SUSPENDIDO: "Suspendido", ARCHIVADO: "Archivado",
  VALIDADO: "Aprobado", EN_PRODUCCION: "Aprobado", OBSOLETO: "Archivado",
};

function tx(str) {
  if (str == null) return "";
  return String(str)
    .replace(/³/g, "3")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, " - ")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/[\u0100-\uFFFF]/g, (ch) => {
      const nfd = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return nfd.length ? nfd : "?";
    });
}

function fmtDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateFile() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function generateReportId(prefix = 'CMP') {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rnd = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}

const ESTADOS_APROBADOS = new Set(['APROBADO', 'EN_PRODUCCION', 'VALIDADO']);

// M6 — formatter local intencional. La SSoT del proyecto está en
// `src/lib/format/index.js` (`formatNumber`), pero este PDF usa una
// representación más simple (.toFixed) para los deltas comparativos donde
// la precisión absoluta importa más que el separador de miles. Si en el
// futuro se quiere unificar el look-and-feel con el informe principal,
// migrar acá usando `formatNumber(v, { precision: d })`.
function formatNum(v, d = 1) {
  if (v == null) return "-";
  return Number(v).toFixed(d);
}

function formatCurrency(v) {
  if (v == null) return "-";
  return `$${Number(v).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

function checkBreak(doc, y, pageH, margin, needed = 35) {
  if (y + needed > pageH - FOOTER_RESERVE) {
    doc.addPage();
    return margin + 10;
  }
  return y;
}

function addFooter(doc, reportDate) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const pages = doc.internal.getNumberOfPages();
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.text(`Generado: ${reportDate}`, 14, pageH - 6);
    doc.text(`Pagina ${i} de ${pages}`, pageW - 14, pageH - 6, { align: "right" });
  }
}

/**
 * Generate comparison PDF (INFORME-06).
 *
 * @param {Object} opts
 * @param {Array}  opts.designs
 * @param {Array}  opts.labels
 * @param {Object} opts.costosMap
 * @param {Object} opts.conclusiones
 * @param {string} [opts.modoEvaluacion='DESCRIPTIVO'] — Decisión 2026-05-28.
 *   Default DESCRIPTIVO: lista los datos comparativos de las dosificaciones
 *   sin emitir valoración normativa. 'NORMATIVO' para contraste contra la
 *   matriz CIRSOC/IRAM completa. Acepta aliases viejos PRESTACIONAL/
 *   PRESCRIPTIVO (back-compat).
 */
export async function generarComparacionPdf({ designs, labels, costosMap, conclusiones, modoEvaluacion = 'DESCRIPTIVO' }) {
  const _modoUpper = String(modoEvaluacion).toUpperCase();
  const _modoNorm = (_modoUpper === 'NORMATIVO' || _modoUpper === 'PRESCRIPTIVO')
    ? 'NORMATIVO'
    : 'DESCRIPTIVO';

  const doc = new jsPDF("p", "mm", "a4");
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 16;

  // R8 — Identificador único del informe + fecha
  const reportId = generateReportId();

  // Title
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...C.primary);
  doc.text(tx("Comparacion de dosificaciones"), margin, y);
  y += 6;

  doc.setFont("Helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(tx(`${designs.length} disenos comparados | ${fmtDate()}`), margin, y);
  doc.setFontSize(7.5);
  doc.text(tx(`Informe: ${reportId}`), pageW - margin, y, { align: "right" });
  y += 5;

  // R8 — Hashes de integridad de cada diseño comparado (trazabilidad post-generación)
  const hashesLine = designs
    .map((d, i) => {
      const h = d.hashIntegridad || d.hashDatosJson || null;
      const lab = labels[i] || `#${d.id}`;
      return h ? `${lab}: ${String(h).substring(0, 8)}` : `${lab}: sin hash`;
    })
    .join("  |  ");
  doc.setFontSize(7);
  doc.text(tx(`Hashes: ${hashesLine}`), margin, y);
  y += 5;

  // R9 — Advertencia si alguno de los diseños no está en estado aprobado
  const noAprobados = designs.filter(d => !ESTADOS_APROBADOS.has(String(d.estado || '').toUpperCase()));
  if (noAprobados.length > 0) {
    const labs = noAprobados.map((d, i) => {
      const idx = designs.indexOf(d);
      const lab = labels[idx] || `#${d.id}`;
      const est = ESTADO_LABELS[d.estado] || d.estado || 'sin estado';
      return `${lab} (${est})`;
    }).join(", ");
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(217, 119, 6);
    doc.rect(margin, y, pageW - 2 * margin, 9, 'FD');
    doc.setFontSize(8);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text(tx('ATENCION: comparacion incluye diseños no aprobados'), margin + 3, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(tx(`Diseños no aprobados: ${labs}. No usar este informe como base de decisiones de produccion.`),
      margin + 3, y + 7.5);
    y += 12;
    doc.setTextColor(...C.text);
  }

  // Banner del modo del documento (decisión 2026-05-28).
  // Patrón: splitTextToSize + altura dinámica (lección PR1).
  {
    const bannerInnerPad = 3;
    const bannerInnerW = (pageW - 2 * margin) - 2 * bannerInnerPad;
    const titleH = 3.5;
    const lineH = 3.4;
    const padBottom = 1.5;
    let titleText, descText, fillRGB, strokeRGB, textRGB;
    if (_modoNorm === 'NORMATIVO') {
      titleText = 'VERIFICACION NORMATIVA ESTRICTA';
      descText = 'Comparativo evaluado contra la matriz CIRSOC 200:2024 + serie IRAM completa, sin filtros del plan de control de calidad de la planta productora. Apto para auditorias externas y contraste tecnico.';
      fillRGB = [255, 243, 205];
      strokeRGB = [220, 170, 50];
      textRGB = [133, 100, 4];
    } else {
      titleText = 'INFORME COMPARATIVO DESCRIPTIVO';
      descText = 'Documento descriptivo. Lista los parametros calculados de las dosificaciones comparadas sin emitir valoracion normativa. Para verificacion contra CIRSOC 200:2024 + IRAM generar el documento en modo Normativo.';
      fillRGB = [232, 244, 250];
      strokeRGB = [180, 210, 230];
      textRGB = [60, 90, 120];
    }
    doc.setFontSize(7);
    doc.setFont('Helvetica', 'normal');
    const descLines = doc.splitTextToSize(tx(descText), bannerInnerW);
    const bannerH = 1.5 + titleH + descLines.length * lineH + padBottom;
    doc.setFillColor(...fillRGB);
    doc.setDrawColor(...strokeRGB);
    doc.rect(margin, y, pageW - 2 * margin, bannerH, 'FD');
    doc.setFontSize(7.5);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(...textRGB);
    doc.text(tx(titleText), margin + bannerInnerPad, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(descLines, margin + bannerInnerPad, y + 4 + titleH);
    y += bannerH + 2;
  }
  doc.setTextColor(...C.text);
  // Aire extra entre el banner del modo y el primer título de sección.
  // Ajuste 2026-05-28: antes era `y += 1` (mínimo); el "1. Identificación"
  // quedaba pegado al banner. Subimos a 6 mm para dejar respiro visual.
  y += 6;

  // Section 1: Identification
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.primary);
  doc.text(tx("1. Identificacion"), margin, y);
  y += 5;

  const idHead = ["", ...labels];
  const idRows = [
    ["Nombre", ...designs.map(d => tx(d.nombre || `#${d.id}`))],
    ["Version", ...designs.map(d => `v${d.version || 1}`)],
    ["Estado", ...designs.map(d => tx(ESTADO_LABELS[d.estado] || d.estado))],
    ["Metodo", ...designs.map(d => tx(METODO_LABELS[d.metodo] || d.metodo))],
    ["Planta", ...designs.map(d => tx(d.planta?.nombre || "-"))],
    ["Cemento", ...designs.map(d => tx(d.cemento?.nombreComercial || "-"))],
  ];

  doc.autoTable({
    startY: y,
    head: [idHead],
    body: idRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 30 } },
    theme: "grid",
    margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Section 2: Target parameters
  y = checkBreak(doc, y, pageH, margin, 40);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.primary);
  doc.text(tx("2. Parametros objetivo"), margin, y);
  y += 5;

  const paramHead = ["", ...labels];
  if (designs.length === 2) paramHead.push(tx("Delta"));

  const paramFields = [
    { label: "f'ck (MPa)", key: "resistenciaMpa" },
    { label: "Asentamiento (mm)", key: "asentamientoMm" },
    { label: "TMN (mm)", key: "tmnMm" },
  ];

  const paramRows = paramFields.map(pf => {
    const vals = designs.map(d => (d.parametrosObjetivoJson || {})[pf.key]);
    const row = [pf.label, ...vals.map(v => formatNum(v))];
    if (designs.length === 2 && vals[0] != null && vals[1] != null) {
      const diff = vals[1] - vals[0];
      row.push(Math.abs(diff) < 0.01 ? "=" : `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}`);
    } else if (designs.length === 2) {
      row.push("-");
    }
    return row;
  });

  doc.autoTable({
    startY: y,
    head: [paramHead],
    body: paramRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
    theme: "grid",
    margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Section 3: Dosification result
  y = checkBreak(doc, y, pageH, margin, 60);
  doc.setFont("Helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...C.primary);
  doc.text(tx("3. Dosificacion resultante"), margin, y);
  y += 5;

  const dosHead = ["", ...labels];
  if (designs.length === 2) { dosHead.push(tx("Delta")); dosHead.push(tx("Delta%")); }

  const fixedRows = [
    { label: "Agua (L/m3)", key: "aguaLtsM3" },
    { label: "a/c", key: "ac" },
    { label: "Cemento (kg/m3)", key: "cementoKgM3" },
  ];

  // Collect aggregate names
  const allAggs = new Set();
  designs.forEach(d => ((d.resultadoJson || {}).agregados || []).forEach(a => allAggs.add(a.nombre)));

  const dosRows = [];

  fixedRows.forEach(fr => {
    const vals = designs.map(d => (d.resultadoJson || {})[fr.key]);
    const row = [fr.label, ...vals.map(v => formatNum(v, fr.key === "ac" ? 2 : 1))];
    if (designs.length === 2 && vals[0] != null && vals[1] != null) {
      const diff = vals[1] - vals[0];
      const pct = vals[0] !== 0 ? (diff / vals[0]) * 100 : 0;
      row.push(`${diff >= 0 ? "+" : ""}${diff.toFixed(fr.key === "ac" ? 2 : 1)}`);
      row.push(`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
    } else if (designs.length === 2) {
      row.push("-"); row.push("-");
    }
    dosRows.push(row);
  });

  allAggs.forEach(name => {
    const vals = designs.map(d => {
      const ag = ((d.resultadoJson || {}).agregados || []).find(a => a.nombre === name);
      return ag?.kgM3 ?? null;
    });
    const row = [tx(name + " (kg)"), ...vals.map(v => formatNum(v, 0))];
    if (designs.length === 2 && vals[0] != null && vals[1] != null) {
      const diff = vals[1] - vals[0];
      const pct = vals[0] !== 0 ? (diff / vals[0]) * 100 : 0;
      row.push(`${diff >= 0 ? "+" : ""}${diff.toFixed(0)}`);
      row.push(`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
    } else if (designs.length === 2) {
      row.push("-"); row.push("-");
    }
    dosRows.push(row);
  });

  // PUV
  const puvVals = designs.map(d => (d.resultadoJson || {}).puvTeorico);
  const puvRow = ["PUV (kg/m3)", ...puvVals.map(v => formatNum(v, 0))];
  if (designs.length === 2 && puvVals[0] != null && puvVals[1] != null) {
    const diff = puvVals[1] - puvVals[0];
    const pct = puvVals[0] !== 0 ? (diff / puvVals[0]) * 100 : 0;
    puvRow.push(`${diff >= 0 ? "+" : ""}${diff.toFixed(0)}`);
    puvRow.push(`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
  } else if (designs.length === 2) {
    puvRow.push("-"); puvRow.push("-");
  }
  dosRows.push(puvRow);

  doc.autoTable({
    startY: y,
    head: [dosHead],
    body: dosRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
    theme: "grid",
    margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ── Section 3b: Gráfico radar comparativo ──
  // Decisión 2026-05-28: el PDF incluye el mismo radar que se ve en la
  // pantalla de comparación. Se dibuja directamente con jsPDF (sin
  // canvas ni SVG) replicando el cómputo de RADAR_NORM. Los valores son
  // un índice visual cualitativo (NO normativo), igual que en la página.
  if (designs.length >= 2) {
    const RADAR_NORM = {
      resistenciaMaxMpa: 60,
      costoBaselineArs: 30000,
      acRangoMin: 0.30,
      acRangoMax: 0.70,
      asentamientoMaxMm: 200,
      cementoRangoMin: 200,
      cementoRangoMax: 500,
    };
    const axesLabels = ["Resistencia", "Economia", "Durabilidad", "Trabajabilidad", "Sustentabilidad"];
    const N = RADAR_NORM;
    const acRange = N.acRangoMax - N.acRangoMin;
    const cementoRange = N.cementoRangoMax - N.cementoRangoMin;
    const clip = (v) => Math.max(0, Math.min(100, v));

    const datasets = designs.map((d, i) => {
      const r = d.resultadoJson || {};
      const params = d.parametrosObjetivoJson || {};
      const costos = costosMap?.[d.id];
      return {
        label: labels[i] || `Diseño ${String.fromCharCode(65 + i)}`,
        values: [
          clip(((r.fcm || params.resistenciaMpa || 30) / N.resistenciaMaxMpa) * 100),
          costos?.totalMateriales ? clip((N.costoBaselineArs / costos.totalMateriales) * 100) : 50,
          r.ac ? clip(((N.acRangoMax - r.ac) / acRange) * 100) : 50,
          params.asentamientoMm ? clip((params.asentamientoMm / N.asentamientoMaxMm) * 100) : 50,
          r.cementoKgM3 ? clip(((N.cementoRangoMax - r.cementoKgM3) / cementoRange) * 100) : 50,
        ],
      };
    });

    // Paleta para hasta 4 diseños (azul, rojo, verde, naranja).
    const palette = [
      { stroke: [37, 99, 235],  fill: [37, 99, 235, 0.18] },
      { stroke: [220, 53, 69],  fill: [220, 53, 69, 0.18] },
      { stroke: [22, 163, 74],  fill: [22, 163, 74, 0.18] },
      { stroke: [253, 126, 20], fill: [253, 126, 20, 0.18] },
    ];

    // Layout del bloque (título + gráfico + leyenda + nota al pie).
    const blockH = 100;
    y = checkBreak(doc, y, pageH, margin, blockH + 4);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.primary);
    doc.text(tx("Grafico radar comparativo"), margin, y);
    y += 5;

    // Geometría del radar.
    const cx = pageW / 2;
    const radius = 32;
    const cy = y + radius + 8;
    const nAxes = 5;
    const angleAt = (i) => -Math.PI / 2 + i * (2 * Math.PI / nAxes);
    const pointAt = (i, v) => ({
      x: cx + Math.cos(angleAt(i)) * radius * (v / 100),
      y: cy + Math.sin(angleAt(i)) * radius * (v / 100),
    });

    // Grilla concéntrica (pentágonos a 20, 40, 60, 80, 100%).
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.15);
    for (const pct of [20, 40, 60, 80, 100]) {
      const poly = [];
      for (let i = 0; i < nAxes; i++) poly.push(pointAt(i, pct));
      for (let i = 0; i < nAxes; i++) {
        const a = poly[i]; const b = poly[(i + 1) % nAxes];
        doc.line(a.x, a.y, b.x, b.y);
      }
    }

    // Spokes (radios desde el centro a cada vértice del 100%).
    for (let i = 0; i < nAxes; i++) {
      const p = pointAt(i, 100);
      doc.line(cx, cy, p.x, p.y);
    }

    // Etiquetas de ejes (afuera de la grilla).
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    for (let i = 0; i < nAxes; i++) {
      const lp = {
        x: cx + Math.cos(angleAt(i)) * (radius + 4),
        y: cy + Math.sin(angleAt(i)) * (radius + 4),
      };
      // Alineación por cuadrante para no pisar la grilla.
      const ang = angleAt(i);
      let align = 'center';
      if (Math.cos(ang) > 0.3)  align = 'left';
      if (Math.cos(ang) < -0.3) align = 'right';
      doc.text(tx(axesLabels[i]), lp.x, lp.y + (Math.sin(ang) > 0 ? 2.5 : 0), { align });
    }

    // Polígonos por diseño (relleno semi-transparente + borde).
    datasets.forEach((ds, idx) => {
      const c = palette[idx % palette.length];
      const pts = ds.values.map((v, i) => pointAt(i, v));
      // Triangulación simple para emular relleno con jsPDF (sin alpha):
      // dibujamos el polígono con color fuerte y sin relleno; el efecto
      // visual del radar viene del solapamiento de los bordes coloreados
      // y los puntos. (jsPDF no soporta opacidad sin saveGraphicsState;
      // omitimos el fill para máxima compatibilidad.)
      doc.setDrawColor(c.stroke[0], c.stroke[1], c.stroke[2]);
      doc.setLineWidth(0.6);
      for (let i = 0; i < nAxes; i++) {
        const a = pts[i]; const b = pts[(i + 1) % nAxes];
        doc.line(a.x, a.y, b.x, b.y);
      }
      // Puntos de datos.
      doc.setFillColor(c.stroke[0], c.stroke[1], c.stroke[2]);
      for (const p of pts) {
        doc.circle(p.x, p.y, 0.9, 'F');
      }
    });

    // Leyenda debajo del gráfico.
    const legendY = cy + radius + 12;
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    const legendItemW = Math.min(60, (contentW - 6) / datasets.length);
    const legendStartX = cx - (datasets.length * legendItemW) / 2 + legendItemW / 2;
    datasets.forEach((ds, idx) => {
      const c = palette[idx % palette.length];
      const lx = legendStartX + idx * legendItemW;
      doc.setFillColor(c.stroke[0], c.stroke[1], c.stroke[2]);
      doc.rect(lx - 12, legendY - 2.4, 4, 2.4, 'F');
      doc.setTextColor(...C.text);
      doc.text(tx(ds.label), lx - 6, legendY);
    });

    // Nota al pie aclarando que es un índice cualitativo.
    const noteY = legendY + 6;
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(6.5);
    doc.setTextColor(...C.muted);
    const noteText = tx('Indice visual cualitativo (NO normativo). Los ejes estan normalizados con rangos de referencia empiricos para hormigones convencionales; util para comparar disenos entre si, no para evaluar cumplimiento. Ver verificaciones CIRSOC en el informe individual de cada diseno.');
    const noteLines = doc.splitTextToSize(noteText, contentW - 4);
    doc.text(noteLines, margin + 2, noteY);
    y = noteY + noteLines.length * 3 + 4;
  }

  // Section 4: Costs
  if (costosMap && Object.keys(costosMap).length > 0) {
    y = checkBreak(doc, y, pageH, margin, 30);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.primary);
    doc.text(tx("4. Costos"), margin, y);
    y += 5;

    const costHead = ["", ...labels];
    if (designs.length === 2) { costHead.push(tx("Delta")); costHead.push(tx("Delta%")); }

    const costFields = [
      { label: "Costo materiales", key: "totalMateriales" },
      { label: "Costo con flete", key: "totalConFlete" },
    ];

    const costRows = costFields.map(cf => {
      const vals = designs.map(d => costosMap[d.id]?.[cf.key]);
      const row = [cf.label, ...vals.map(v => formatCurrency(v))];
      if (designs.length === 2 && vals[0] != null && vals[1] != null) {
        const diff = vals[1] - vals[0];
        const pct = vals[0] !== 0 ? (diff / vals[0]) * 100 : 0;
        row.push(formatCurrency(diff));
        row.push(`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`);
      } else if (designs.length === 2) {
        row.push("-"); row.push("-");
      }
      return row;
    });

    doc.autoTable({
      startY: y,
      head: [costHead],
      body: costRows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 40 } },
      theme: "grid",
      margin: { left: margin, right: margin, bottom: FOOTER_RESERVE + 2 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Conclusions
  if (conclusiones && conclusiones.length > 0) {
    y = checkBreak(doc, y, pageH, margin, 30);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...C.primary);
    doc.text(tx("Conclusiones"), margin, y);
    y += 5;

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.text);

    conclusiones.forEach((c, i) => {
      y = checkBreak(doc, y, pageH, margin, 10);
      const lines = doc.splitTextToSize(tx(`${i + 1}. ${c}`), contentW - 5);
      doc.text(lines, margin + 3, y);
      y += lines.length * 4 + 2;
    });

    y += 3;
    doc.setFont("Helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(tx("Las conclusiones son factuales y no constituyen una recomendacion."), margin, y);
    y += 8;
  }

  // Disclaimer
  y = checkBreak(doc, y, pageH, margin, 15);
  doc.setDrawColor(...C.muted);
  doc.setLineWidth(0.15);
  doc.line(margin, y, pageW - margin, y);
  y += 4;
  doc.setFont("Helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text(tx("Este informe comparativo es una herramienta de apoyo y no reemplaza el criterio profesional."), margin, y);
  y += 6;

  // Footer
  addFooter(doc, fmtDate());

  // Save
  doc.save(`comparacion_dosificaciones_${fmtDateFile()}.pdf`);
}
