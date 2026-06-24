import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { getCategoriaPdfPresentation } from '../../../lib/compliance/pdfPresentation';
import { formatDate, sanitizePdfText } from '../../../lib/format';

const C = {
  primary: [31, 97, 141], secondary: [52, 73, 94], accent: [39, 174, 96],
  danger: [192, 57, 43], warning: [243, 156, 18], lightBg: [245, 247, 250],
  white: [255, 255, 255], text: [44, 62, 80], muted: [127, 140, 141],
};

// R7 (auditoría 01-calidad): `new Date('2026-03-31')` interpreta UTC; en zona
// AR (-3) imprimía 30/03/2026. `formatDate` central usa el helper compartido
// que evita el corrimiento.
const fmtDate = (d) => formatDate(d);
function fmtNum(v, d = 2) { return v != null ? Number(v).toFixed(d) : '—'; }
// R8 (auditoría 01-calidad): la función `tx()` local solo limpiaba `³` y
// dejaba pasar otros caracteres no Latin-1 (≤, ≥, ², subíndices químicos)
// que rompen el render Helvetica. Migrado a `sanitizePdfText` central.
const tx = (s) => sanitizePdfText(s);

/**
 * Informe de resistencia por período.
 *
 * @param {Object} opts
 * @param {string} opts.empresa
 * @param {string} opts.planta
 * @param {string} opts.periodo — "Marzo 2026" or "01/03/2026 - 31/03/2026"
 * @param {Array} opts.tiposHormigon — [{ tipo, fcObjective, muestras, probetas, fcm, s, cv, fck, cumple, edades: [{ edad, n, fcm, s }] }]
 *   - `cumple` puede ser `boolean` (legacy: f'ck >= f'c) o un `ComplianceResult`
 *     canónico. Ambos shapes los acepta `getCategoriaPdfPresentation` (Prompt 3 C9.1).
 * @param {Object} opts.resumenGlobal — { totalMuestras, totalProbetas, fcmGlobal, sGlobal, cumplimientoPct }
 * @param {Array} opts.alertas — [{ tipo, mensaje, severidad }]
 * @param {string} opts.responsable
 */
export function generarInformeResistenciaPdf(opts) {
  const {
    empresa, planta, periodo, tiposHormigon = [], resumenGlobal = {}, alertas = [], responsable,
    // PR9.3 — Modo de evaluación dual (PRESTACIONAL | PRESCRIPTIVO).
    // Default PRESTACIONAL: catálogo del tenant soberano. PRESCRIPTIVO se
    // usa para auditorías externas con verificación normativa estricta.
    modoEvaluacion = 'PRESTACIONAL',
  } = opts;
  const _modoNorm = String(modoEvaluacion).toUpperCase() === 'PRESCRIPTIVO'
    ? 'PRESCRIPTIVO'
    : 'PRESTACIONAL';

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = 0;

  const addFooter = (pn, tp) => {
    doc.setFontSize(6); doc.setTextColor(...C.muted);
    doc.text(tx(`${empresa || ''} — Informe de resistencia — ${periodo || ''}`), margin, pageH - 8);
    doc.text(`Página ${pn}/${tp}`, pageW - margin, pageH - 8, { align: 'right' });
  };

  // ── Header ──
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, pageW, 28, 'F');
  doc.setFont('Helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...C.white);
  doc.text('INFORME DE RESISTENCIA A COMPRESIÓN', margin + 2, 12);
  doc.setFont('Helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(200, 220, 240);
  doc.text(tx(`${planta || empresa || ''} — Período: ${periodo || ''}`), margin + 2, 19);
  doc.text(fmtDate(new Date()), pageW - margin, 12, { align: 'right' });
  y = 33;

  // PR9.3 — Banner del modo de evaluación (post-header).
  if (_modoNorm === 'PRESCRIPTIVO') {
    doc.setFillColor(255, 243, 205);
    doc.setDrawColor(220, 170, 50);
    doc.rect(margin, y, pageW - 2 * margin, 9, 'FD');
    doc.setFontSize(8);
    doc.setFont('Helvetica', 'bold');
    doc.setTextColor(133, 100, 4);
    doc.text(tx('VERIFICACIÓN NORMATIVA ESTRICTA'), margin + 3, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(tx('Aplica todas las exigencias de CIRSOC 200:2024 e IRAM. Puede señalar verificaciones más amplias que las del plan de control de calidad habitual de la planta.'),
      margin + 3, y + 7.5);
    y += 12;
  } else {
    doc.setFillColor(232, 244, 250);
    doc.setDrawColor(180, 210, 230);
    doc.rect(margin, y, pageW - 2 * margin, 6, 'FD');
    doc.setFontSize(7);
    doc.setFont('Helvetica', 'normal');
    doc.setTextColor(60, 90, 120);
    doc.text(tx('Evaluación según el plan de control de calidad de la planta productora.'),
      margin + 3, y + 4);
    y += 9;
  }
  doc.setTextColor(...C.text);

  // ── Resumen ejecutivo ──
  doc.setFont('Helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C.primary);
  doc.text('1. Resumen ejecutivo', margin, y); y += 6;

  const kpiData = [
    ['Total muestras', String(resumenGlobal.totalMuestras || 0)],
    ['Total probetas', String(resumenGlobal.totalProbetas || 0)],
    ['Tipos de hormigón', String(tiposHormigon.length)],
    ['Cumplimiento global', `${fmtNum(resumenGlobal.cumplimientoPct || 0, 0)}%`],
  ];
  doc.autoTable({
    startY: y, body: kpiData, theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2.5, textColor: C.text },
    columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold' }, 1: { fontStyle: 'bold', halign: 'right', cellWidth: 30 } },
    margin: { left: margin, right: pageW / 2 },
  });
  y = doc.lastAutoTable.finalY + 3;

  // M20 (auditoría 01-calidad): el KPI "Cumplimiento global" antes era un % sin
  // criterio explícito en el resumen. Se agrega cita CIRSOC para que el lector
  // sepa contra qué se compara cada lote (f'ck ≥ f'c con f'ck al fractil 10%
  // según §6 / Ec. 6-1). El detalle metodológico completo sigue en la sección
  // "Nota metodológica" más abajo.
  doc.setFont('Helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  const criterioTxt = tx(
    'Criterio de cumplimiento del lote: f\'ck >= f\'c especificada, con f\'ck = f\'cm - 1,28 sigma (CIRSOC 200-2024 Sec. 6, Ec. 6-1, fractil 10%).'
  );
  const criterioLines = doc.splitTextToSize(criterioTxt, pageW - margin * 2 - 4);
  doc.text(criterioLines, margin, y);
  y += criterioLines.length * 3 + 4;
  doc.setFont('Helvetica', 'normal');
  doc.setTextColor(...C.text);

  // Alertas
  if (alertas.length > 0) {
    for (const al of alertas.slice(0, 5)) {
      const color = al.severidad === 'error' ? C.danger : al.severidad === 'warning' ? C.warning : C.muted;
      doc.setFont('Helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...color);
      doc.text(tx(`• ${al.mensaje}`), margin + 2, y); y += 4;
    }
    y += 3;
  }

  // ── Detalle por tipo de hormigón ──
  doc.setFont('Helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...C.primary);
  doc.text('2. Detalle por tipo de hormigón', margin, y); y += 6;

  for (const tipo of tiposHormigon) {
    if (y > pageH - 50) { doc.addPage(); y = margin + 5; }

    // Subtítulo
    // Veredicto canónico (Prompt 3 C9.1): el helper acepta `tipo.cumple` como
    // boolean legacy o ComplianceResult, y devuelve color RGB + label canónico
    // ("APTO" / "NO APTO" / "APTO CON OBSERVACIONES" / "APTITUD CONDICIONADA"
    // / "EVALUACIÓN INCOMPLETA").
    const veredicto = getCategoriaPdfPresentation(tipo.cumple);
    doc.setFont('Helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.secondary);
    doc.text(tx(`${tipo.tipo} — Objetivo: ${tipo.fcObjective || '—'} MPa`), margin, y);
    doc.setTextColor(...veredicto.color);
    doc.text(veredicto.label, pageW - margin, y, { align: 'right' });
    y += 5;

    // Stats table
    const statsBody = [
      ['Muestras', String(tipo.muestras || 0), 'Probetas', String(tipo.probetas || 0)],
      ['f\'cm (MPa)', fmtNum(tipo.fcm, 2), 's (MPa)', fmtNum(tipo.s, 2)],
      ['CV (%)', fmtNum(tipo.cv, 1), 'f\'ck (MPa)', fmtNum(tipo.fck, 2)],
    ];
    doc.autoTable({
      startY: y, body: statsBody, theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2, textColor: C.text, lineColor: [220, 220, 220], lineWidth: 0.2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 30 }, 1: { halign: 'right', cellWidth: 25 }, 2: { fontStyle: 'bold', cellWidth: 30 }, 3: { halign: 'right', cellWidth: 25 } },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 3;

    // By age breakdown
    if (tipo.edades?.length > 0) {
      doc.autoTable({
        startY: y,
        head: [['Edad (días)', 'n', 'f\'cm (MPa)', 's (MPa)', 'CV (%)']],
        body: tipo.edades.map(e => [String(e.edad), String(e.n), fmtNum(e.fcm, 2), fmtNum(e.s, 2), fmtNum(e.cv, 1)]),
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 1.5, textColor: C.text, halign: 'center', lineColor: [220, 220, 220], lineWidth: 0.2 },
        headStyles: { fillColor: C.secondary, textColor: C.white, fontSize: 7 },
        margin: { left: margin + 10, right: margin + 10 },
      });
      y = doc.lastAutoTable.finalY + 5;
    } else {
      y += 3;
    }
  }

  // ── Nota metodológica ──
  if (y > pageH - 30) { doc.addPage(); y = margin + 5; }
  doc.setFont('Helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...C.primary);
  doc.text(tx(`${tiposHormigon.length > 0 ? '3' : '2'}. Nota metodológica`), margin, y); y += 5;
  doc.setFont('Helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.muted);
  const notas = [
    'f\'cm = resistencia media a compresión del lote.',
    'σ = desvío estándar muestral (n-1).',
    'CV = coeficiente de variación (σ/f\'cm × 100).',
    'f\'ck = f\'cm - 1,28 × σ (estimador al fractil 10%, criterio de aceptación CIRSOC 200-2024 §6, Ec. 6-1).',
    'Cumplimiento del lote: f\'ck ≥ f\'c especificada (CIRSOC 200-2024 §6).',
    'Nota: el factor k=1,28 corresponde al 10% de casos defectuosos admitidos (CIRSOC 200-2024 / CIRSOC 201:2005 / IRAM 1666:2020 Tabla A.3). El criterio histórico al 5% con k=1,65 (CIRSOC 201:1982) está derogado para hormigón estructural.',
    'Resultados válidos según calibración de equipos vigente al momento del ensayo.',
  ];
  for (const nota of notas) { doc.text(tx(`• ${nota}`), margin + 2, y); y += 3.5; }

  // ── Firma ──
  y = Math.max(y + 10, pageH - 40);
  doc.setDrawColor(...C.muted); doc.setLineWidth(0.3);
  doc.line(margin + 10, y, margin + 70, y);
  doc.setFontSize(7); doc.setTextColor(...C.muted);
  doc.text(tx(responsable || 'Responsable de calidad'), margin + 40, y + 4, { align: 'center' });

  // Footers
  const tp = doc.internal.getNumberOfPages();
  for (let i = 1; i <= tp; i++) { doc.setPage(i); addFooter(i, tp); }

  const fn = `informe_resistencia_${(planta || 'planta').replace(/\s/g, '_')}_${(periodo || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  doc.save(fn);
}
