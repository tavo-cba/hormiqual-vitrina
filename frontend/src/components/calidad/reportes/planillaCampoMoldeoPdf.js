import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { sanitizePdfText } from '../../../lib/format';

/**
 * N-02 (auditoría 08, Bloque 18) — Planilla de campo / moldeo en blanco.
 *
 * PDF A4 imprimible para que el operario complete a mano cuando no hay
 * tablet o conexión en obra. Cuando vuelva a la planta digitaliza los
 * datos en `EnsayoForm`/`MuestraForm`.
 *
 * Diseño:
 *  - Encabezado con logo opcional + título + número de planilla (tenant
 *    puede pre-imprimir un correlativo).
 *  - Bloques: Identificación del despacho, Condiciones climáticas,
 *    Mediciones de fresco, Identificación de probetas, Observaciones,
 *    Firma del operario.
 *  - Rayas guía y casillas para escritura clara.
 *  - Por defecto 1 planilla por hoja A4. Si `opts.dosPorHoja` es true,
 *    duplicamos en una hoja A4 partida horizontalmente para ahorrar papel.
 */

const tx = (s) => sanitizePdfText(s);

// Layout helpers (A4 portrait: 210 × 297 mm).
const MARGIN_X = 12;
const MARGIN_Y = 14;

function drawHeader(doc, opts, yStart) {
  const { logoBase64, plantaNombre, tenantNombre } = opts || {};
  let y = yStart;
  const pageW = doc.internal.pageSize.getWidth();

  // Geometría: logo a la izquierda, cuadro de N°/Fecha (60 mm) a la derecha.
  // El título se centra en el espacio LIBRE entre ambos para evitar el
  // solapamiento que reportó el user (el centro de la página caía dentro
  // del cuadro de la derecha y rompía el título).
  const LOGO_W = 22;
  const BOX_W = 60;
  const logoEndX = MARGIN_X + (logoBase64 ? LOGO_W + 4 : 0);
  const boxStartX = pageW - MARGIN_X - BOX_W;
  const tituloCenterX = (logoEndX + boxStartX) / 2;

  if (logoBase64) {
    try { doc.addImage(logoBase64, 'PNG', MARGIN_X, y, LOGO_W, 18); } catch { /* ignore */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(tx('PLANILLA DE CAMPO'), tituloCenterX, y + 6, { align: 'center' });
  doc.setFontSize(11);
  doc.text(tx('Moldeo de probetas'), tituloCenterX, y + 12, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(tx(`${tenantNombre || ''}${plantaNombre ? ' — ' + plantaNombre : ''}`), tituloCenterX, y + 17, { align: 'center' });

  // Cuadro de N° de planilla + fecha (derecha).
  doc.setDrawColor(120);
  doc.setLineWidth(0.3);
  doc.rect(boxStartX, y, BOX_W, 18);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(tx('N° Planilla:'), boxStartX + 2, y + 5);
  doc.text(tx('Fecha:'), boxStartX + 2, y + 12);
  doc.line(boxStartX + 25, y + 5, boxStartX + BOX_W - 2, y + 5);
  doc.line(boxStartX + 25, y + 12, boxStartX + BOX_W - 2, y + 12);

  return y + 22;
}

function drawSectionTitle(doc, y, label) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(230, 240, 250);
  doc.rect(MARGIN_X, y, pageW - 2 * MARGIN_X, 5, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(31, 97, 141);
  doc.text(tx(label), MARGIN_X + 2, y + 3.6);
  doc.setTextColor(0);
  return y + 7;
}

function drawField(doc, x, y, w, h, label) {
  doc.setDrawColor(150);
  doc.setLineWidth(0.2);
  doc.rect(x, y, w, h);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110);
  doc.text(tx(label), x + 1, y + 2.5);
  doc.setTextColor(0);
}

function drawIdentificacionBlock(doc, yStart) {
  let y = drawSectionTitle(doc, yStart, '1. IDENTIFICACIÓN DEL DESPACHO');
  const pageW = doc.internal.pageSize.getWidth();
  const colW = (pageW - 2 * MARGIN_X) / 2;
  const rowH = 9;

  drawField(doc, MARGIN_X, y, colW, rowH, 'Cliente');
  drawField(doc, MARGIN_X + colW, y, colW, rowH, 'Obra');
  y += rowH;
  drawField(doc, MARGIN_X, y, colW, rowH, 'Remito N°');
  drawField(doc, MARGIN_X + colW, y, colW, rowH, 'Tipo de hormigón (H-XX)');
  y += rowH;
  drawField(doc, MARGIN_X, y, colW / 2, rowH, 'Volumen (m³)');
  drawField(doc, MARGIN_X + colW / 2, y, colW / 2, rowH, 'Hora moldeo');
  drawField(doc, MARGIN_X + colW, y, colW, rowH, 'Operario / Laboratorista');
  y += rowH;
  return y + 2;
}

function drawCondicionesBlock(doc, yStart) {
  let y = drawSectionTitle(doc, yStart, '2. CONDICIONES AMBIENTALES');
  const pageW = doc.internal.pageSize.getWidth();
  const colW = (pageW - 2 * MARGIN_X) / 4;
  const rowH = 9;

  drawField(doc, MARGIN_X, y, colW, rowH, 'Temp. ambiente (°C)');
  drawField(doc, MARGIN_X + colW, y, colW, rowH, 'Humedad relativa (%)');
  drawField(doc, MARGIN_X + 2 * colW, y, colW, rowH, 'Viento');
  drawField(doc, MARGIN_X + 3 * colW, y, colW, rowH, 'Tiempo (sol/nublado/lluvia)');
  return y + rowH + 2;
}

function drawFrescoBlock(doc, yStart) {
  let y = drawSectionTitle(doc, yStart, '3. MEDICIONES DE HORMIGÓN FRESCO (IRAM 1536/1602/1602-2)');
  const pageW = doc.internal.pageSize.getWidth();
  const colW = (pageW - 2 * MARGIN_X) / 3;
  const rowH = 9;

  drawField(doc, MARGIN_X, y, colW, rowH, 'Asentamiento (cm) — cono Abrams');
  drawField(doc, MARGIN_X + colW, y, colW, rowH, 'Temp. del hormigón (°C)');
  drawField(doc, MARGIN_X + 2 * colW, y, colW, rowH, 'Aire incorporado (%)');
  y += rowH;
  drawField(doc, MARGIN_X, y, colW, rowH, 'Peso unitario (kg/m³)');
  drawField(doc, MARGIN_X + colW, y, colW, rowH, 'Modalidad muestreo (canilla / boca / mixer)');
  drawField(doc, MARGIN_X + 2 * colW, y, colW, rowH, 'Hora medición fresco');
  return y + rowH + 2;
}

function drawProbetasBlock(doc, yStart) {
  let y = drawSectionTitle(doc, yStart, '4. PROBETAS MOLDEADAS');
  const pageW = doc.internal.pageSize.getWidth();
  const startX = MARGIN_X;
  const cols = [
    { label: 'N°',                w: 10 },
    { label: 'Identificación',     w: 35 },
    { label: 'Tipo (10×20 / 15×30)', w: 25 },
    { label: 'Edad rotura (días)',  w: 22 },
    { label: 'Fecha rotura',        w: 28 },
    { label: 'Pileta / Ubicación',  w: 30 },
    { label: 'Observaciones',       w: pageW - 2 * MARGIN_X - (10 + 35 + 25 + 22 + 28 + 30) },
  ];
  const rowH = 7;
  const headH = 6;

  // Header row.
  let x = startX;
  doc.setFillColor(240, 240, 240);
  doc.rect(startX, y, pageW - 2 * MARGIN_X, headH, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60);
  for (const c of cols) {
    doc.rect(x, y, c.w, headH);
    doc.text(tx(c.label), x + 1, y + 4);
    x += c.w;
  }
  doc.setTextColor(0);
  y += headH;

  // 6 filas en blanco (típico: 6 probetas por moldeo, 2×7d + 2×28d + 2 reserva).
  doc.setFont('helvetica', 'normal');
  for (let i = 0; i < 6; i++) {
    let xx = startX;
    for (const c of cols) {
      doc.rect(xx, y, c.w, rowH);
      if (c.label === 'N°') {
        doc.setTextColor(150);
        doc.text(tx(String(i + 1)), xx + 1, y + 5);
        doc.setTextColor(0);
      }
      xx += c.w;
    }
    y += rowH;
  }
  return y + 2;
}

function drawObservacionesBlock(doc, yStart) {
  let y = drawSectionTitle(doc, yStart, '5. OBSERVACIONES');
  const pageW = doc.internal.pageSize.getWidth();
  const w = pageW - 2 * MARGIN_X;
  const lineH = 5;
  doc.setDrawColor(180);
  doc.setLineWidth(0.15);
  for (let i = 0; i < 4; i++) {
    doc.line(MARGIN_X, y + lineH, MARGIN_X + w, y + lineH);
    y += lineH;
  }
  return y + 2;
}

function drawFirmasBlock(doc, yStart) {
  let y = drawSectionTitle(doc, yStart, '6. FIRMAS');
  const pageW = doc.internal.pageSize.getWidth();
  const colW = (pageW - 2 * MARGIN_X) / 3;
  const rowH = 18;

  doc.setDrawColor(150);
  doc.rect(MARGIN_X, y, colW, rowH);
  doc.rect(MARGIN_X + colW, y, colW, rowH);
  doc.rect(MARGIN_X + 2 * colW, y, colW, rowH);
  doc.setFontSize(7);
  doc.setTextColor(110);
  doc.text(tx('Operario / Laboratorista'),         MARGIN_X + 1,           y + rowH - 2);
  doc.text(tx('Recibió en obra'),                  MARGIN_X + colW + 1,    y + rowH - 2);
  doc.text(tx('Verificó (Resp. Calidad)'),         MARGIN_X + 2 * colW + 1, y + rowH - 2);
  doc.setTextColor(0);
  return y + rowH + 2;
}

function drawFooter(doc) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(
    tx('Generado por HormiQual — planilla en blanco para completar a mano. Archivar el original y digitalizar los datos.'),
    pageW / 2,
    pageH - 6,
    { align: 'center' }
  );
  doc.setTextColor(0);
}

/**
 * Genera el PDF y lo abre / descarga según el caller decide.
 *
 * @param {object} opts
 * @param {string} [opts.tenantNombre]
 * @param {string} [opts.plantaNombre]
 * @param {string} [opts.logoBase64]   Base64 PNG del logo (opcional)
 * @returns {jsPDF}
 */
export function generarPlanillaCampoMoldeoPdf(opts = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = MARGIN_Y;
  y = drawHeader(doc, opts, y);
  y = drawIdentificacionBlock(doc, y);
  y = drawCondicionesBlock(doc, y);
  y = drawFrescoBlock(doc, y);
  y = drawProbetasBlock(doc, y);
  y = drawObservacionesBlock(doc, y);
  y = drawFirmasBlock(doc, y);
  drawFooter(doc);

  return doc;
}

export function downloadPlanillaCampoMoldeo(opts = {}, filename = 'planilla-campo-moldeo.pdf') {
  const doc = generarPlanillaCampoMoldeoPdf(opts);
  doc.save(filename);
}
