import jsPDF from 'jspdf';
import 'jspdf-autotable';
// M-PDF-04 + M-PDF-05 fix (auditoría 08, Bloque 9): este archivo tenía
// helpers locales `fmtDate` y `tx` que no manejaban correctamente caracteres
// fuera de ASCII (tildes, ñ, °, ², σ, etc.) ni el desfase UTC al parsear
// fechas ISO en GMT-3. Migrado a los helpers centralizados de
// `lib/format/index.js` (alineado con `informeResistenciaPdf.js` y
// `certificadoCumplimientoPdf.js` que ya migraron en sesiones previas).
import { sanitizePdfText, formatDate, formatNumber } from '../../../lib/format';
import { formatCargaPolicy } from '../../../lib/ensayos/ensayoResistenciaCalc';

const C = {
  primary: [31, 97, 141], secondary: [52, 73, 94], accent: [39, 174, 96],
  danger: [192, 57, 43], lightBg: [245, 247, 250], white: [255, 255, 255],
  text: [44, 62, 80], muted: [127, 140, 141], headerBg: [31, 97, 141],
};

const fmtDate = (d) => formatDate(d);
const fmtNum = (v, d = 2) => (v == null ? '—' : formatNumber(Number(v), { precision: d }));
const tx = (s) => sanitizePdfText(s);

/**
 * Generate an official test certificate (acta de ensayo) for one or more probetas.
 *
 * @param {Object} opts
 * @param {Array} opts.probetas — array of { probeta, ensayo, muestra, despacho }
 * @param {string} opts.empresa — company name
 * @param {string} opts.planta — plant name
 * @param {string} opts.laboratorio — lab name
 * @param {string} opts.responsable — responsible person
 * @param {string} opts.logoUrl — logo base64 or URL
 * @param {string} opts.tipoHormigon — concrete type (e.g. "H-30")
 * @param {string} opts.obra — project name (optional)
 * @param {string} opts.cliente — client name (optional)
 */
export async function generarActaEnsayoProbetaPdf(opts) {
  const {
    probetas = [], empresa, planta, laboratorio, responsable,
    logoUrl, tipoHormigon, obra, cliente, nroActa,
    // P-V-03 (Bloque 21): política de unidad de carga del tenant.
    politicaUnidadCarga = 'ORIGINAL',
  } = opts;

  if (probetas.length === 0) throw new Error('No hay probetas para generar el acta.');

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 0;

  // ── Footer ──
  const addFooter = (pageNum, totalPages) => {
    doc.setFontSize(6);
    doc.setTextColor(...C.muted);
    doc.text(tx(`${empresa || ''} — ${laboratorio || ''}`), margin, pageH - 8);
    doc.text(`Página ${pageNum} de ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' });
    doc.text(tx(`Generado: ${fmtDate(new Date())}`), pageW / 2, pageH - 8, { align: 'center' });
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(margin, pageH - 11, pageW - margin, pageH - 11);
  };

  // ── Header ──
  doc.setFillColor(...C.headerBg);
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...C.white);
  doc.text('ACTA DE ENSAYO DE RESISTENCIA A COMPRESIÓN', margin + 2, 13);
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 220, 240);
  doc.text(tx(`IRAM 1546 / IRAM 1709`), margin + 2, 20);
  if (nroActa) doc.text(tx(`Acta Nº ${nroActa}`), pageW - margin, 13, { align: 'right' });
  doc.text(fmtDate(new Date()), pageW - margin, 20, { align: 'right' });
  y = 35;

  // ── Identificación ──
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...C.primary);
  doc.text('1. Identificación', margin, y);
  y += 5;

  const idRows = [];
  if (empresa) idRows.push(['Empresa', empresa]);
  if (planta) idRows.push(['Planta', planta]);
  if (laboratorio) idRows.push(['Laboratorio', laboratorio]);
  if (tipoHormigon) idRows.push(['Tipo de hormigón', tipoHormigon]);
  if (obra) idRows.push(['Obra / Destino', obra]);
  if (cliente) idRows.push(['Cliente', cliente]);
  if (responsable) idRows.push(['Responsable', responsable]);

  // Get muestra/despacho info from first probeta
  const firstP = probetas[0];
  const muestra = firstP?.muestra;
  const despacho = firstP?.despacho;
  if (muestra?.nombre) idRows.push(['Muestra', muestra.nombre]);
  if (despacho?.fecha) idRows.push(['Fecha despacho', fmtDate(despacho.fecha)]);
  if (despacho?.remito) idRows.push(['Remito', despacho.remito]);

  if (idRows.length > 0) {
    doc.autoTable({
      startY: y,
      body: idRows,
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 1.5, textColor: C.text },
      columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold', textColor: C.secondary } },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 5;
  }

  // ── Resultados de ensayo ──
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...C.primary);
  doc.text('2. Resultados de ensayo', margin, y);
  y += 5;

  // P-V-03: header de carga adapta su rótulo a la política. Para 'AMBAS' va
  // genérico "Carga" porque cada celda lleva ambas unidades.
  const cargaHeader = politicaUnidadCarga === 'SI_KN'
    ? 'Carga\n(kN)'
    : politicaUnidadCarga === 'AMBAS'
      ? 'Carga\n(kN / tonf)'
      : 'Carga';
  const head = [['Probeta', 'Edad\n(días)', 'Fecha\nensayo', 'Peso\n(g)', 'Altura\n(mm)', 'Diámetro\n(mm)', cargaHeader, 'Resistencia\n(MPa)', 'Operario']];
  const body = probetas.map(p => {
    const e = p.ensayo || {};
    const prob = p.probeta || {};
    const unidadOrig = e.unidadCarga || e.prensa?.unidadMedida?.unidad || 'kN';
    return [
      prob.nombre || prob.codigo || `#${prob.idProbeta || ''}`,
      e.edadEnsayo != null ? String(e.edadEnsayo) : '—',
      fmtDate(e.fechaEnsayo),
      e.peso != null ? fmtNum(e.peso, 1) : '—',
      e.altura != null ? fmtNum(e.altura, 2) : '—',
      e.diametro != null ? fmtNum(e.diametro, 2) : '—',
      e.cargaAplicada != null
        ? formatCargaPolicy(e.cargaAplicada, unidadOrig, politicaUnidadCarga)
        : '—',
      e.resistencia != null ? fmtNum(e.resistencia, 2) : '—',
      p.operario || e.operarioNombre || '—',
    ];
  });

  doc.autoTable({
    startY: y,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2, halign: 'center' },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 7 },
    margin: { left: margin, right: margin },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
  });
  y = doc.lastAutoTable.finalY + 5;

  // ── Estadísticas ──
  if (probetas.length >= 2) {
    const resistencias = probetas.map(p => p.ensayo?.resistencia).filter(r => r != null).map(Number);
    if (resistencias.length >= 2) {
      const n = resistencias.length;
      const media = resistencias.reduce((s, v) => s + v, 0) / n;
      const varianza = resistencias.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1);
      const desvio = Math.sqrt(varianza);
      const cv = media > 0 ? (desvio / media) * 100 : 0;

      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...C.primary);
      doc.text('3. Estadísticas', margin, y);
      y += 5;

      const statsBody = [
        ['Cantidad de probetas', String(n)],
        ['Resistencia media (f\'cm)', `${fmtNum(media, 2)} MPa`],
        ['Desvío estándar (S)', `${fmtNum(desvio, 2)} MPa`],
        ['Coeficiente de variación (CV)', `${fmtNum(cv, 1)} %`],
      ];

      // f'ck si hay target
      if (tipoHormigon) {
        const targetMatch = tipoHormigon.match(/H[- ]?(\d+)/i);
        const target = targetMatch ? Number(targetMatch[1]) : null;
        if (target) {
          const fck = media - 1.28 * desvio;
          const cumple = fck >= target;
          statsBody.push([`f'ck estimado (f'cm - 1.28×S)`, `${fmtNum(fck, 2)} MPa`]);
          statsBody.push([`Cumple ${tipoHormigon} (≥ ${target} MPa)`, cumple ? 'SÍ' : 'NO']);
        }
      }

      doc.autoTable({
        startY: y,
        body: statsBody,
        theme: 'plain',
        styles: { fontSize: 8, cellPadding: 2, textColor: C.text },
        columnStyles: { 0: { cellWidth: 65, fontStyle: 'bold' }, 1: { fontStyle: 'bold', halign: 'right' } },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 5;
    }
  }

  // ── Observaciones ──
  const obsTexts = probetas.map(p => p.ensayo?.observaciones).filter(Boolean);
  if (obsTexts.length > 0) {
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.primary);
    doc.text(tx(`${probetas.length >= 2 ? '4' : '3'}. Observaciones`), margin, y);
    y += 5;
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.text);
    for (const obs of obsTexts) {
      const lines = doc.splitTextToSize(tx(obs), contentW - 4);
      doc.text(lines, margin + 2, y);
      y += lines.length * 3.5 + 2;
    }
    y += 3;
  }

  // ── Firma ──
  if (y > pageH - 50) { doc.addPage(); y = margin + 5; }
  y = Math.max(y, pageH - 45);

  doc.setDrawColor(...C.muted);
  doc.setLineWidth(0.3);
  // Firma izquierda
  doc.line(margin + 10, y, margin + 70, y);
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text('Responsable de ensayo', margin + 40, y + 4, { align: 'center' });
  // Firma derecha
  doc.line(pageW - margin - 70, y, pageW - margin - 10, y);
  doc.text('Responsable de laboratorio', pageW - margin - 40, y + 4, { align: 'center' });

  // ── Disclaimer ──
  y += 10;
  doc.setFont('Helvetica', 'italic');
  doc.setFontSize(6);
  doc.setTextColor(...C.muted);
  doc.text(tx('Este documento ha sido generado automáticamente por el sistema HormiQual. Los resultados reflejan los datos ingresados al momento del ensayo.'), margin, y);
  doc.text(tx('La validez de los resultados queda sujeta a la calibración de equipos y al cumplimiento de los procedimientos normalizados de ensayo.'), margin, y + 3);

  // Add footers
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(i, totalPages);
  }

  // Save
  const muestraNombre = muestra?.nombre || 'probetas';
  const fileName = `acta_ensayo_${muestraNombre.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}
