import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { sanitizePdfText, formatDate } from '../../../lib/format';

/**
 * N-01 (auditoría 08, Bloque 19 + sesión 2026-05-09) — Etiquetas adhesivas
 * con QR para identificación de probetas en pileta.
 *
 * Workflow (definido con el usuario):
 *
 *   1. Al moldear una muestra, el operario imprime el lote de etiquetas.
 *   2. Después del desmolde (24-48h), pega la etiqueta sobre la cara
 *      lateral de la probeta seca. BACKUP obligatorio: marcador permanente
 *      con el `nombre` corto en la cara opuesta (CIRSOC §6.1.6 exige
 *      identificación inequívoca y los laboratorios certificados ISO 17025
 *      requieren redundancia ante pérdida de etiqueta).
 *   3. La probeta va a pileta de curado (agua de cal saturada, 23±2°C).
 *   4. Al día de rotura, el operario escanea el QR → la app abre directo
 *      el formulario de ensayo (smart redirect en ProbetaQrRedirect.jsx).
 *
 * Materiales recomendados (ver docs/calidad/etiquetado-probetas.md):
 *  - Modo A4: papel adhesivo común, recortar a mano. Sirve para validar
 *    el flujo y obras ocasionales. No aguanta inmersión prolongada.
 *  - Modo térmica: rollo de etiquetas de poliéster industrial (Brady B-7541
 *    o equivalente) en impresora Zebra ZD220 / Brady BMP21+. Aguanta 6+
 *    meses en agua de cal sin despegarse.
 *
 * Layout de cada etiqueta (60×40 mm, formato Avery L7163 o similar):
 *
 *   ┌──────────────────────────────────┐
 *   │ ┌──────┐  L42P3                  │  ← QR (28×28 mm) + nombre probeta
 *   │ │ QR   │  H-25 / 28d             │
 *   │ │      │  Moldeo: 11/04/2026     │
 *   │ └──────┘  Rotura: 09/05/2026     │
 *   │ Cliente · Obra · Planta          │
 *   └──────────────────────────────────┘
 *
 * Modos de salida:
 *  - 'a4'      → A4 portrait con grilla 3×7 = 21 etiquetas/hoja (default).
 *  - 'termica' → Una etiqueta por página, formato 60×40mm, para impresora
 *                térmica de rollo continuo.
 */

const tx = (s) => sanitizePdfText(s);

// Layout A4 — grilla conservadora 3×7 = 21 etiquetas/hoja con margen para
// recorte manual sin papel Avery especializado.
const A4_LAYOUT = {
  cols: 3,
  rows: 7,
  marginX: 8,
  marginY: 12,
  gutterX: 4,
  gutterY: 4,
};

// Layout térmica — etiqueta única 60×40mm por página. Coincide con rollos
// estándar de Zebra ZD220 / Brady BMP21+ (60×40 mm es el tamaño más común
// para identificación industrial; admite QR de hasta 32×32 mm).
const TERMICA_TAG_W = 60;  // mm
const TERMICA_TAG_H = 40;  // mm
const TERMICA_PADDING = 2; // mm interno

function calcA4Layout(doc) {
  const { cols, rows, marginX, marginY, gutterX, gutterY } = A4_LAYOUT;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const usableW = pageW - 2 * marginX - gutterX * (cols - 1);
  const usableH = pageH - 2 * marginY - gutterY * (rows - 1);
  return { pageW, pageH, tagW: usableW / cols, tagH: usableH / rows };
}

async function qrDataUrl(text) {
  // M (medium) error correction permite recuperar hasta 15% del QR si está
  // borroso o salpicado de agua de pileta.
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 200,
  });
}

function drawTag(doc, x, y, w, h, probeta, qrUrl, { drawBorder = true } = {}) {
  if (drawBorder) {
    // Borde de la etiqueta (línea fina, casi imperceptible — sirve como
    // guía de corte cuando se imprime en papel A4 común).
    doc.setDrawColor(190);
    doc.setLineWidth(0.15);
    doc.rect(x, y, w, h);
  }

  // QR a la izquierda — cuadrado con lado ≈ h - 6 (margen interno).
  const qrSize = Math.min(h - 6, w * 0.45);
  const qrX = x + 2;
  const qrY = y + 2;
  if (qrUrl) {
    try { doc.addImage(qrUrl, 'PNG', qrX, qrY, qrSize, qrSize); } catch { /* ignore */ }
  }

  // Bloque de texto a la derecha del QR.
  const tx0 = qrX + qrSize + 2;
  const txW = w - (tx0 - x) - 2;
  let ty = y + 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(tx(probeta.nombre || probeta.codigo || `#${probeta.idProbeta}`), tx0, ty);
  ty += 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  if (probeta.tipoHormigon) {
    doc.text(tx(`${probeta.tipoHormigon} · ${probeta.diasRotura ?? '—'}d`), tx0, ty);
    ty += 3;
  }
  if (probeta.fechaConfeccion) {
    doc.text(tx(`Moldeo: ${formatDate(probeta.fechaConfeccion)}`), tx0, ty);
    ty += 3;
  }
  if (probeta.fechaRotura) {
    doc.text(tx(`Rotura: ${formatDate(probeta.fechaRotura)}`), tx0, ty);
    ty += 3;
  }
  if (probeta.fcMpa) {
    doc.text(tx(`f'c: ${probeta.fcMpa} MPa`), tx0, ty);
    ty += 3;
  }

  // Bloque inferior compacto: cliente / obra / planta.
  doc.setFontSize(6);
  doc.setTextColor(80);
  let footer = '';
  if (probeta.cliente) footer += probeta.cliente;
  if (probeta.obra)    footer += (footer ? ' · ' : '') + probeta.obra;
  if (probeta.planta)  footer += (footer ? ' · ' : '') + probeta.planta;
  if (footer) {
    const lines = doc.splitTextToSize(tx(footer), txW);
    doc.text(lines.slice(0, 2), tx0, y + h - 2.5);
  }
  doc.setTextColor(0);
}

/**
 * Genera el PDF de etiquetas QR para un set de probetas.
 *
 * @param {Array<object>} probetas  Cada item: { idProbeta, nombre, codigo,
 *   tipoHormigon, diasRotura, fechaConfeccion, fechaRotura, fcMpa,
 *   cliente, obra, planta }.
 * @param {object} opts
 * @param {string} [opts.baseUrl]     Base para el QR. Default = origen actual
 *   del navegador + `/p/` (subdominio del tenant que generó las etiquetas).
 *   La ruta `/p/:id` redirige a la pantalla de probetas con el dialog abierto.
 * @param {'a4'|'termica'} [opts.formato='a4']  Layout de salida.
 * @returns {Promise<jsPDF>}
 */
export async function generarEtiquetasProbetaQrPdf(probetas, opts = {}) {
  const defaultOrigin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://app.hormiqual.com';
  const baseUrl = opts.baseUrl ?? `${defaultOrigin}/p/`;
  const formato = opts.formato === 'termica' ? 'termica' : 'a4';

  // Pre-generar QRs en paralelo (la lib es async).
  const qrUrls = await Promise.all(
    (probetas || []).map((p) => qrDataUrl(`${baseUrl}${p.idProbeta}`))
  );

  if (formato === 'termica') {
    return renderTermica(probetas || [], qrUrls);
  }
  return renderA4(probetas || [], qrUrls);
}

function renderA4(probetas, qrUrls) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { tagW, tagH } = calcA4Layout(doc);
  const { cols, rows, marginX, marginY, gutterX, gutterY } = A4_LAYOUT;
  const tagsPerPage = cols * rows;

  let i = 0;
  for (const probeta of probetas) {
    const idxOnPage = i % tagsPerPage;
    if (i > 0 && idxOnPage === 0) doc.addPage();
    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x = marginX + col * (tagW + gutterX);
    const y = marginY + row * (tagH + gutterY);
    drawTag(doc, x, y, tagW, tagH, probeta, qrUrls[i]);
    i++;
  }
  return doc;
}

function renderTermica(probetas, qrUrls) {
  // Una etiqueta = una página de tamaño exacto 60×40mm. La impresora
  // térmica corta automáticamente entre páginas. Sin borde porque el
  // formato físico ya define el área.
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [TERMICA_TAG_H, TERMICA_TAG_W], // [shortSide, longSide] en landscape
  });

  let i = 0;
  for (const probeta of probetas) {
    if (i > 0) doc.addPage([TERMICA_TAG_H, TERMICA_TAG_W], 'landscape');
    drawTag(
      doc,
      TERMICA_PADDING,
      TERMICA_PADDING,
      TERMICA_TAG_W - 2 * TERMICA_PADDING,
      TERMICA_TAG_H - 2 * TERMICA_PADDING,
      probeta,
      qrUrls[i],
      { drawBorder: false },
    );
    i++;
  }
  return doc;
}

export async function downloadEtiquetasProbetaQr(probetas, opts = {}, filename = 'etiquetas-probetas.pdf') {
  const doc = await generarEtiquetasProbetaQrPdf(probetas, opts);
  doc.save(filename);
}
