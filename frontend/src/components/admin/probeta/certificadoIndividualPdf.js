/**
 * N-04 (auditoría 08, Bloque 7) — Certificado individual de ensayo
 * a compresión para una probeta cilíndrica.
 *
 * Entregable a cliente. Cita IRAM 1546:2013 (procedimiento de ensayo) y
 * referencia el factor H/D + tipo de rotura (Bloque 3).
 *
 * Usa los helpers centralizados `sanitizePdfText` y `formatDate`
 * (auditoría 08 M-PDF-04 / M-PDF-05) para evitar bugs de encoding y de
 * timezone. NO embebe DejaVu (PDF compacto para impresión).
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { sanitizePdfText, formatDate, formatNumber } from '../../../lib/format';
import { drawPdfHeader } from '../../../lib/format/pdfHeader';
import { registerDejavuOnDoc } from '../../../lib/format/dejavuFont';
import { formatCargaPolicy } from '../../../lib/ensayos/ensayoResistenciaCalc';

const tx = (s) => sanitizePdfText(s);

// R8 (revisor-civil 2026-05-08): labels alineados a Figura 2 IRAM 1546:2013.
const TIPO_ROTURA_LABEL = {
  CONO:           'Tipo 1 — Conos bien formados',
  CONO_CORTANTE:  'Tipo 2 — Cono + fisuras verticales',
  COLUMNAR:       'Tipo 3 — Columnar',
  DIAGONAL:       'Tipo 4 — Diagonal',
  CORTANTE:       'Tipo 5 — Cortante',
  OTRO:           'Tipo 6 — Otro',
};

/**
 * Genera el certificado individual.
 *
 * @param {object} probeta   Datos completos de la probeta + ensayo + muestra.
 *   Debe incluir: nombre, codigo, ensayo (con peso, altura, diametro,
 *   factorCorreccionHD, tipoRotura, resistencia, fechaEnsayo, edadEnsayo,
 *   operarioEnsayo, prensa), muestra (con fecha, cliente, obra, planta,
 *   tipoHormigon, dosificacion, despacho).
 * @param {object} configEmpresa  Config del tenant (nombre, dirección, logo).
 * @returns {{ buffer: Uint8Array, filename: string }}
 */
export async function generarCertificadoIndividualPdf(probeta, configEmpresa = {}) {
  if (!probeta || !probeta.ensayo) {
    throw new Error('La probeta no tiene ensayo cargado — no se puede emitir certificado.');
  }
  const ensayo = probeta.ensayo;
  const muestra = probeta.muestra ?? probeta.muestraTerceros ?? null;
  const dosif = muestra?.dosificacion ?? muestra?.despacho?.dosificacion ?? null;

  const cliente = muestra?.cliente ?? muestra?.despacho?.cliente ?? null;
  const obra = muestra?.obra ?? muestra?.despacho?.obra ?? null;
  const planta = muestra?.planta ?? muestra?.despacho?.planta ?? null;
  const tipoHormigon = muestra?.tipoHormigon?.tipoHormigon
    ?? dosif?.tipoHormigon?.tipoHormigon
    ?? muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon
    ?? '—';
  const fechaMoldeo = muestra?.fecha ?? muestra?.despacho?.fecha ?? null;
  const remito = muestra?.remito ?? muestra?.despacho?.remito ?? null;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  // DejaVu para que la capa de texto del PDF tenga las tildes/ñ correctamente
  // decodificadas (búsqueda, OCR, accesibilidad).
  try { await registerDejavuOnDoc(doc); } catch { /* fallback Helvetica */ }
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;

  /* ─── Encabezado unificado (logo + empresa + fecha) ─── */
  // Compatibilidad: el caller histórico pasaba `nombre`, ahora preferimos
  // `nombreEmpresa` (alineado con el resto). Adaptamos shape.
  const cfgNorm = {
    ...configEmpresa,
    nombreEmpresa: configEmpresa.nombreEmpresa ?? configEmpresa.nombre,
  };
  let y = await drawPdfHeader(doc, { configEmpresa: cfgNorm, margin });

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(tx('Certificado de ensayo de resistencia a compresión'), margin, y + 4);
  y += 9;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.text(tx('Probeta cilíndrica — IRAM 1546:2013'), margin, y);
  y += 6;
  doc.setFont('helvetica', 'normal');

  /* ─── Identificación de la probeta ─── */
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(tx('1. Identificación'), margin, y);
  y += 1;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [],
    body: [
      [tx('Identificador'), tx(`${probeta.nombre || `#${probeta.idProbeta}`} (id ${probeta.idProbeta})`)],
      [tx('Código'),        tx(probeta.codigo || '—')],
      [tx('Cliente'),       tx(cliente
        ? (cliente.tipoPersona === 'Física' ? cliente.nombre : cliente.razonSocial)
        : '—')],
      [tx('Obra'),          tx(obra?.nombre || '—')],
      [tx('Planta'),        tx(planta?.nombre || '—')],
      [tx('Remito'),        tx(remito || '—')],
      [tx('Tipo de hormigón'), tx(tipoHormigon)],
      [tx('Dosificación'),  tx(dosif?.nombre || '—')],
    ],
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    theme: 'plain',
  });
  y = doc.lastAutoTable.finalY + 5;

  /* ─── Datos de moldeo ─── */
  doc.setFont('helvetica', 'bold');
  doc.text(tx('2. Moldeo'), margin, y);
  y += 1;
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [],
    body: [
      [tx('Fecha de moldeo'), tx(formatDate(fechaMoldeo))],
      [tx('Edad de diseño'),  tx(probeta.edadDisenio ? `${probeta.edadDisenio} días` : `${probeta.diasRotura || '—'} días (no nominal)`)],
    ],
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    theme: 'plain',
  });
  y = doc.lastAutoTable.finalY + 5;

  /* ─── Datos del ensayo ─── */
  doc.setFont('helvetica', 'bold');
  doc.text(tx('3. Ensayo a compresión'), margin, y);
  y += 1;
  const factorHD = ensayo.factorCorreccionHD != null ? Number(ensayo.factorCorreccionHD) : 1.000;
  const tipoRotura = ensayo.tipoRotura
    ? (TIPO_ROTURA_LABEL[ensayo.tipoRotura] || ensayo.tipoRotura)
    : tx('No registrado');
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [],
    body: [
      [tx('Fecha de ensayo'),   tx(formatDate(ensayo.fechaEnsayo))],
      [tx('Hora'),              tx(ensayo.horaEnsayo || '—')],
      [tx('Edad real (días)'),  tx(`${ensayo.edadEnsayo}`)],
      [tx('Peso (g)'),          tx(formatNumber(ensayo.peso, { precision: 1 }))],
      [tx('Altura (mm)'),       tx(formatNumber(ensayo.altura, { precision: 2 }))],
      [tx('Diámetro (mm)'),     tx(formatNumber(ensayo.diametro, { precision: 2 }))],
      [tx('Relación H/D (IRAM 1524/1534)'), tx(formatNumber(ensayo.altura / ensayo.diametro, { precision: 3 }))],
      [tx('Tipo de rotura (IRAM 1546 §11)'), tx(tipoRotura)],
      [tx('Carga aplicada'),    tx(formatCargaPolicy(
        ensayo.cargaAplicada,
        ensayo.prensa?.unidadMedida?.unidad || 'kN',
        configEmpresa.politicaUnidadCarga ?? 'ORIGINAL'
      ))],
      [tx('Resistencia'),       tx(`${formatNumber(ensayo.resistencia, { precision: 2 })} MPa`)],
      [tx('Operario'),          tx(ensayo.operarioEnsayo
        ? `${ensayo.operarioEnsayo.apellido || ''}, ${ensayo.operarioEnsayo.nombre || ''}`.trim()
        : '—')],
      [tx('Prensa'),            tx(ensayo.prensa?.nombre || '—')],
    ],
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70 } },
    theme: 'plain',
  });
  y = doc.lastAutoTable.finalY + 8;

  /* ─── Resistencia destacada ─── */
  doc.setFillColor(230, 240, 250);
  doc.rect(margin, y, pageW - 2 * margin, 18, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(tx('Resistencia obtenida'), margin + 4, y + 7);
  doc.setFontSize(20);
  doc.setTextColor(20, 60, 130);
  doc.text(
    `${formatNumber(ensayo.resistencia, { precision: 2 })} MPa`,
    pageW - margin - 4,
    y + 12,
    { align: 'right' }
  );
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  // R5 (revisor-civil 2026-05-08): probetas moldeadas IRAM 1524/1534 con H/D=2
  // (sin factor de corrección). El factor de IRAM 1551 sólo aplica a testigos.
  doc.text(
    tx(`(probeta moldeada con H/D = ${formatNumber(ensayo.altura / ensayo.diametro, { precision: 3 })}, IRAM 1524/1534)`),
    margin + 4,
    y + 14
  );
  doc.setFont('helvetica', 'normal');
  y += 24;

  /* ─── Disclaimer + firmas ─── */
  doc.setFontSize(8);
  doc.text(tx(
    'Este certificado reporta el resultado de un ensayo individual sobre una probeta. ' +
    'La aceptación del lote se evalúa con un conjunto de probetas según los criterios de ' +
    'CIRSOC 200-2024 §6.2 (Métodos 1 y 2). Procedimiento de ensayo según IRAM 1546:2013.'
  ), margin, y, { maxWidth: pageW - 2 * margin });
  y += 12;

  // Firmas
  const firmaW = (pageW - 2 * margin - 10) / 2;
  doc.setFontSize(9);
  doc.line(margin, y + 18, margin + firmaW, y + 18);
  doc.text(tx('Operario laboratorio'), margin, y + 22);

  const xFirmaResp = margin + firmaW + 10;
  doc.line(xFirmaResp, y + 18, xFirmaResp + firmaW, y + 18);
  doc.text(tx('Responsable de Calidad'), xFirmaResp, y + 22);

  /* ─── Filename ─── */
  const fechaStr = formatDate(ensayo.fechaEnsayo).replace(/\//g, '-');
  const filename = `Certificado_${probeta.nombre || probeta.idProbeta}_${fechaStr}.pdf`;
  return { buffer: doc.output('arraybuffer'), filename, doc };
}

export default generarCertificadoIndividualPdf;
