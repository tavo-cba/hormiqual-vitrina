import jsPDF from "jspdf";
import "jspdf-autotable";

/**
 * Genera PDF de Receta de Obra — formato planta (una sola página A4).
 * Tipografía grande, colores por tipo de componente, legible a distancia.
 */

// Colores por tipo de componente (borde izquierdo)
const TIPO_COLORS = {
  agua:    [33, 150, 243],   // #2196F3 azul
  cemento: [96, 125, 139],   // #607D8B gris
  arena:   [255, 193, 7],    // #FFC107 amarillo
  ripio:   [255, 152, 0],    // #FF9800 naranja
  aditivo: [76, 175, 80],    // #4CAF50 verde
};

const C = {
  primary:  [18, 52, 86],
  text:     [31, 41, 55],
  muted:    [107, 114, 128],
  light:    [245, 247, 250],
  white:    [255, 255, 255],
  line:     [200, 200, 200],
};

const fmtNum = (v, dec = 1) =>
  v != null ? Number(v).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";

const roundBachada = (val) =>
  Math.abs(val) > 100 ? Math.round(val) : Math.round(val * 10) / 10;

/**
 * Sanitiza strings para jsPDF default (Helvetica, Latin-1). Caracteres > U+00FF
 * se descomponen al carácter base (NFD) o se reemplazan por '?'. Idempotente.
 */
function tx(str) {
  if (str == null) return "";
  return String(str)
    .replace(/³/g, "3")
    .replace(/–/g, "-")
    .replace(/—/g, " - ")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    // Fix audit 2026-05-28 (auditor-pdf test93/test94): caracteres Unicode
    // fuera de Latin-1 que no descomponen vía NFD → producen glifos
    // corruptos (!', ") en jsPDF default. Mapeo explícito antes del bloque
    // genérico para flecha derecha y signo menos tipográfico.
    .replace(/→/g, "->")
    .replace(/−/g, "-")
    .replace(/×/g, "x")
    .replace(/[Ā-￿]/g, (ch) => {
      const nfd = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      return nfd.length ? nfd : "?";
    });
}

async function fetchLogoBase64(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url, { mode: "cors" });
    const blob = await resp.blob();
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

/**
 * Mapea el `tipo` canónico del modelo (AF/AG/AGREGADO_FINO/AGREGADO_GRUESO/...)
 * o subtipo a la categoría visual ('arena' o 'ripio') usada por el PDF.
 * Devuelve null si no se puede determinar.
 */
function tipoVisualDesdeModelo(tipoCanonico, subtipo) {
  const t = String(tipoCanonico || "").toUpperCase();
  if (["AF", "AGREGADO_FINO", "FINO", "ARENA"].includes(t)) return "arena";
  if (["AG", "AGREGADO_GRUESO", "GRUESO"].includes(t)) return "ripio";
  const s = String(subtipo || "").toUpperCase();
  if (["ARENA_NATURAL", "ARENA_TRITURACION", "MEZCLA"].includes(s)) return "arena";
  if (["CANTO_RODADO", "PIEDRA_PARTIDA", "TRITURADO_NATURAL", "TRITURADO_ARTIFICIAL"].includes(s)) return "ripio";
  return null;
}

/**
 * Classify component type. Prefiere `tipoCanonico`/`subtipo` del modelo;
 * cae a heurística por nombre solo cuando el modelo no informa el tipo.
 */
function inferTipo(nombre, esAgua, esCemento, esAditivo, { tipoCanonico = null, subtipo = null } = {}) {
  if (esAgua) return "agua";
  if (esCemento) return "cemento";
  if (esAditivo) return "aditivo";
  const desdeModelo = tipoVisualDesdeModelo(tipoCanonico, subtipo);
  if (desdeModelo) return desdeModelo;
  // Fallback heurístico por nombre (legacy — datos sin `tipo` canónico)
  const lower = (nombre || "").toLowerCase();
  if (lower.includes("arena") || lower.includes("fino")) return "arena";
  if (lower.includes("ripio") || lower.includes("grava") || lower.includes("grueso")) return "ripio";
  return "cemento"; // default
}

/**
 * @param {Object} opts
 * @param {string} opts.nombreDosif - e.g. "H-30 OPS Pisos (v2)"
 * @param {string} opts.codigoDosif - e.g. "DOS-KXGWL1-IHP.v2"
 * @param {string} opts.planta - plant name
 * @param {string} opts.empresa - company name
 * @param {number} opts.volumenBachada - batch volume m³
 * @param {string} opts.fechaMedicion - "10/03/2026"
 * @param {string} opts.medidoPor - operator name
 * @param {Object} opts.resultado - dosificación resultado
 * @param {Object} opts.correccion - { aguaObra, deltaAguaTotal, aguaDiseno, items[] }
 * @param {Object[]} opts.humedades - [{nombre, humedadPct}]
 * @param {string} opts.estado - dosificación state for watermark
 * @param {string} opts.logoUrl - company logo URL
 * @param {Object[]} [opts.adiciones] - opcional, [{ label, ... }] con nombre
 *   comercial de cada adición mineral (índice paralelo a adicion1/adicion2 del
 *   resultado). Si no se provee, se rotula como "ADICIÓN 1" / "ADICIÓN 2".
 * @param {string} [opts.modoEvaluacion='PRESTACIONAL'] - PR9.3 — modo de
 *   evaluación heredado de la dosificación origen. Default PRESTACIONAL.
 */
export async function generarRecetaObraPdf(opts) {
  const {
    nombreDosif,
    codigoDosif,
    planta,
    empresa,
    volumenBachada,
    fechaMedicion,
    medidoPor,
    resultado,
    correccion,
    humedades,
    estado,
    logoUrl,
    adiciones,
    modoEvaluacion = 'DESCRIPTIVO',
  } = opts;
  // Decisión 2026-05-28: la receta hereda el modo de la dosificación
  // origen. Default DESCRIPTIVO. Acepta aliases viejos por back-compat.
  const _modoUpper = String(modoEvaluacion).toUpperCase();
  const _modoNorm = (_modoUpper === 'NORMATIVO' || _modoUpper === 'PRESCRIPTIVO')
    ? 'NORMATIVO'
    : 'DESCRIPTIVO';

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ── Watermark for non-approved states ──
  const needsWatermark = estado && !["APROBADO", "EN_PRODUCCION"].includes(estado);
  if (needsWatermark) {
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.08 }));
    doc.setFontSize(60);
    doc.setTextColor(200, 0, 0);
    doc.text(tx(estado.replace(/_/g, " ")), pageW / 2, pageH / 2, { align: "center", angle: 45 });
    doc.restoreGraphicsState();
  }

  // ── Logo ──
  const logoData = await fetchLogoBase64(logoUrl);
  if (logoData) {
    try { doc.addImage(logoData, "PNG", margin, y, 20, 20); } catch {}
  }

  // ── Header ──
  const headerX = logoData ? margin + 24 : margin;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...C.primary);
  doc.text("RECETA DE OBRA", headerX, y + 8);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.muted);
  doc.text(`Dosificación: ${nombreDosif || "—"}`, headerX, y + 15);
  if (codigoDosif) doc.text(`ID: ${codigoDosif}`, pageW - margin, y + 15, { align: "right" });

  y += 22;
  doc.setFontSize(9);
  doc.text(`Planta: ${planta || "—"}`, margin, y);
  doc.text(`Fecha: ${fechaMedicion || "—"}`, pageW / 2, y);
  doc.text(`Bachada: ${fmtNum(volumenBachada, 2)} m³`, pageW - margin, y, { align: "right" });

  y += 4;
  // Horizontal line
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  // Banner del modo de la receta (decisión 2026-05-28).
  // Hereda el modo de la dosificación origen. Patrón con wrap dinámico.
  {
    const bannerInnerPad = 3;
    const bannerInnerW = contentW - 2 * bannerInnerPad;
    const titleH = 3.5;
    const lineH = 3.4;
    const padBottom = 1.5;
    let titleText, descText, fillRGB, strokeRGB, textRGB;
    if (_modoNorm === 'NORMATIVO') {
      titleText = 'RECETA DERIVADA - MODO NORMATIVO';
      descText = 'Receta derivada de una dosificacion evaluada contra la matriz CIRSOC 200:2024 + serie IRAM completa. Los pesos por bachada son los del diseño verificado normativamente.';
      fillRGB = [255, 243, 205];
      strokeRGB = [220, 170, 50];
      textRGB = [133, 100, 4];
    } else {
      titleText = 'RECETA DE OBRA - DATOS PARA PRODUCCION';
      descText = 'Receta de obra descriptiva. Lista los pesos por bachada con la correccion por humedad aplicada. Para verificar la dosificacion contra CIRSOC 200:2024 + IRAM, generar el informe de la dosificacion en modo Normativo.';
      fillRGB = [232, 244, 250];
      strokeRGB = [180, 210, 230];
      textRGB = [60, 90, 120];
    }
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    const descLines = doc.splitTextToSize(descText, bannerInnerW);
    const bannerH = 1.5 + titleH + descLines.length * lineH + padBottom;
    doc.setFillColor(...fillRGB);
    doc.setDrawColor(...strokeRGB);
    doc.rect(margin, y, contentW, bannerH, 'FD');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...textRGB);
    doc.text(titleText, margin + bannerInnerPad, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(descLines, margin + bannerInnerPad, y + 4 + titleH);
    y += bannerH + 2;
  }
  doc.setTextColor(...C.text);
  y += 1;

  // ── Build component rows ──
  const vol = Number(volumenBachada);
  const rows = [];

  // Water
  rows.push({ nombre: "AGUA", cantidad: `${fmtNum(roundBachada(correccion.aguaObra * vol))} L`, tipo: "agua" });

  // Cement
  const cem = resultado.cementoTotalKgM3 ?? resultado.cementoKgM3;
  rows.push({ nombre: "CEMENTO", cantidad: `${fmtNum(roundBachada(cem * vol))} kg`, tipo: "cemento" });

  // Additions — usa nombre comercial cuando está disponible (R12)
  const adicionLabel = (idx, fallback) => {
    const item = Array.isArray(adiciones) ? adiciones[idx] : null;
    const nombre = item?.label || item?.nombreComercial || item?.nombre;
    return nombre ? tx(String(nombre).toUpperCase()) : fallback;
  };
  if (resultado.adicion1KgM3) rows.push({ nombre: adicionLabel(0, "ADICIÓN 1"), cantidad: `${fmtNum(roundBachada(resultado.adicion1KgM3 * vol))} kg`, tipo: "cemento" });
  if (resultado.adicion2KgM3) rows.push({ nombre: adicionLabel(1, "ADICIÓN 2"), cantidad: `${fmtNum(roundBachada(resultado.adicion2KgM3 * vol))} kg`, tipo: "cemento" });

  // Aggregates — prefiere `tipo`/`subtipo` del modelo; fallback heurístico
  // por nombre sólo si no está disponible (R13).
  correccion.items.filter(it => it.kgNatural != null).forEach(it => {
    const tipoModelo = tipoVisualDesdeModelo(it.tipo || it.tipoCanonico, it.subtipo || it.subtipoMaterial);
    let tipo = tipoModelo;
    if (!tipo) {
      const lower = (it.nombre || "").toLowerCase();
      tipo = lower.includes("arena") || lower.includes("fino") ? "arena" : "ripio";
    }
    rows.push({ nombre: it.nombre.toUpperCase(), cantidad: `${fmtNum(roundBachada(it.kgNatural * vol))} kg`, tipo });
  });

  // Additives
  (resultado.aditivos || []).forEach(a => {
    const kg = a.kgM3 != null ? Number(a.kgM3) : null;
    if (kg != null) {
      rows.push({ nombre: (a.label || "Aditivo").toUpperCase(), cantidad: `${fmtNum(roundBachada(kg * vol), 1)} kg`, tipo: "aditivo" });
    }
  });

  // ── Draw component rows (large type) ──
  const rowHeight = 10;
  const barWidth = 3;
  const nameX = margin + barWidth + 3;
  const cantidadX = pageW - margin - 2;

  rows.forEach((row) => {
    const color = TIPO_COLORS[row.tipo] || TIPO_COLORS.cemento;

    // Colored bar
    doc.setFillColor(...color);
    doc.rect(margin, y - 1, barWidth, rowHeight - 1, "F");

    // Component name
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...C.text);
    doc.text(row.nombre, nameX, y + 5);

    // Quantity (large, right-aligned)
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(row.cantidad, cantidadX, y + 6, { align: "right" });

    y += rowHeight;
  });

  y += 4;
  doc.setDrawColor(...C.line);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ── Humedades section ──
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...C.muted);

  const humLine = humedades
    .filter(h => h.humedadPct != null)
    .map(h => {
      const short = h.nombre.length > 20 ? h.nombre.substring(0, 18) + "…" : h.nombre;
      return `${short} ${fmtNum(h.humedadPct)}%`;
    })
    .join("  |  ");

  doc.text(`Humedades: ${humLine}`, margin, y);
  y += 5;
  doc.text(`Medido por: ${medidoPor || "________________"}`, margin, y);
  doc.text(`Fecha: ${fechaMedicion || "—"}`, pageW / 2, y);
  y += 7;

  // ── Correction summary ──
  // Fix audit 2026-05-28: estos 3 doc.text usaban template literals con
  // ³, → y − que no pasaban por tx() y producían glifos rotos en jsPDF
  // default. Envolvemos con tx() para que el sanitizer corra.
  doc.setFontSize(10);
  doc.setTextColor(...C.text);
  doc.text(tx(`Agua teórica: ${fmtNum(correccion.aguaDiseno)} L/m³`), margin, y);
  doc.text(tx(`→  Corregida: ${fmtNum(correccion.aguaObra)} L/m³`), margin + 60, y);
  y += 5;
  const deltaSign = correccion.deltaAguaTotal > 0 ? "−" : "+";
  const netoLabel = correccion.deltaAguaTotal > 0 ? "agregados neto húmedo" : correccion.deltaAguaTotal < 0 ? "agregados neto seco" : "sin corrección";
  doc.text(tx(`Corrección: ${deltaSign}${fmtNum(Math.abs(correccion.deltaAguaTotal))} L/m³ (${netoLabel})`), margin, y);

  y += 8;
  doc.setDrawColor(...C.line);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  // ── Footer ──
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(empresa || "", margin, y);
  doc.text("Válido solo para fecha y humedades indicadas.", margin, y + 4);
  doc.text("Medir humedades antes de cada jornada de producción.", margin, y + 8);

  // Page footer
  doc.setFontSize(7);
  doc.text(`Generado: ${new Date().toLocaleString("es-AR")}`, margin, pageH - 8);
  doc.text("Hormiqual — Receta de Obra", pageW - margin, pageH - 8, { align: "right" });

  // ── Save ──
  const filename = `Receta_${(nombreDosif || "dosif").replace(/[^a-zA-Z0-9]/g, "_")}_${fechaMedicion || "hoy"}.pdf`;
  doc.save(filename);
}
