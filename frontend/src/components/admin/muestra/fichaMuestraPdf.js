/**
 * N-06 (auditoría 08, Bloque 7) — Ficha de muestra: PDF entregable
 * con el resumen consolidado de un día de moldeo.
 *
 * Diferencia con N-04 (certificado individual): N-04 reporta UNA probeta
 * ya rota. N-06 reporta TODA la muestra (varias probetas en distintos
 * estados) + hormigón fresco + adjuntos. Útil cuando el cliente pide
 * "el resumen de la muestra del 15/04".
 *
 * Usa helpers centralizados `sanitizePdfText` y `formatDate`
 * (M-PDF-04, M-PDF-05).
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { sanitizePdfText, formatDate, formatNumber } from '../../../lib/format';
import { drawPdfHeader } from '../../../lib/format/pdfHeader';
import { registerDejavuOnDoc } from '../../../lib/format/dejavuFont';
import { ESTADO_PROBETA_LABEL, ESTADO_PROBETA } from '../../../lib/constants/estadoProbeta';

const tx = (s) => sanitizePdfText(s);

// R8 (revisor-civil 2026-05-08): labels alineados a Figura 2 IRAM 1546:2013.
const TIPO_ROTURA_LABEL = {
  CONO:           'Tipo 1',
  CONO_CORTANTE:  'Tipo 2',
  COLUMNAR:       'Tipo 3',
  DIAGONAL:       'Tipo 4',
  CORTANTE:       'Tipo 5',
  OTRO:           'Tipo 6',
};

// Alineación por columna de la tabla de probetas moldeadas (mismo orden que
// `head`/`body`). Se usa tanto en `columnStyles` (cuerpo) como en el hook
// `didParseCell` (encabezado), para que encabezado y celda de cada columna
// queden alineados igual sin depender de la precedencia de estilos de
// jspdf-autotable.
const PROBETA_COL_HALIGN = [
  'center', // #
  'left',   // Nombre
  'left',   // Código
  'center', // Edad rotura
  'center', // Fecha rotura
  'center', // Estado
  'right',  // Peso (g)
  'right',  // Altura (mm)
  'right',  // Diám. (mm)
  'right',  // Resistencia
  'right',  // H/D
  'left',   // Tipo rotura
];

const SEV_COLOR = {
  ok:       [40, 130, 60],
  warning:  [180, 130, 20],
  critical: [185, 28, 28],
};

const SEV_LABEL = {
  ok: 'OK',
  warning: 'Atención',
  critical: 'Crítico',
};

// Paleta — alineada con dosificacionInformePdf para coherencia visual entre
// documentos técnicos. `primary` es el azul oscuro del encabezado y bandas
// de sección; `sectionTone` un azul medio para los headers de las tablas.
const C = {
  primary:     [18, 52, 86],
  sectionTone: [56, 111, 194],
  white:       [255, 255, 255],
  text:        [0, 0, 0],
};

function clienteNombre(c) {
  if (!c) return '—';
  return c.tipoPersona === 'Física' ? c.nombre : (c.razonSocial || c.nombre);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Helpers de la Sección 6 — Evolución de resistencia.
 * Funciones puras: estadística simple por edad, estimación R28 (CEB-FIP), y
 * resolución de las líneas de referencia (f'c contractual / f'cm requerido).
 * ─────────────────────────────────────────────────────────────────────────── */

// Coeficiente CEB-FIP β(t) para s=0,25 (cemento clase N — endurecimiento
// normal). Permite estimar R28 a partir de la resistencia a una edad t<28:
// R28 ≈ R_t / β(t). Es orientativo; depende del cemento y curado real.
const _BETA_CEB_FIP_S = 0.25;
const _betaCEBFIP = (t) => Math.exp(_BETA_CEB_FIP_S * (1 - Math.sqrt(28 / t)));

// Agrupa probetas ensayadas (con resistencia válida) por días de rotura.
// Devuelve [{ edad, resistencias: [...], n, media, desvio, cv, min, max }].
function _resistenciasPorEdad(probetas) {
  const map = new Map();
  for (const p of probetas || []) {
    const r = p?.ensayo?.resistencia;
    const d = Number(p?.diasRotura);
    if (r == null || !Number.isFinite(Number(r)) || !Number.isFinite(d) || d <= 0) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(Number(r));
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([edad, arr]) => {
      const n = arr.length;
      const media = arr.reduce((s, v) => s + v, 0) / n;
      const desvio = n > 1 ? Math.sqrt(arr.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1)) : 0;
      const cv = media > 0 ? (desvio / media) * 100 : 0;
      return { edad, resistencias: arr, n, media, desvio, cv, min: Math.min(...arr), max: Math.max(...arr) };
    });
}

// Resuelve referencias para las líneas horizontales y la columna "vs".
// f'c contractual: tipoHormigon.fcMpa. f'cm requerido: dosificacion.fcm o
// calculado desde f'ce respetando tipoHormigonModoFce (CIRSOC §6.2.3):
//   - ESPECIFICADO (default): f'cm = f'ce + 1,65·S (k=1,65 aproximación
//     histórica argentina; el motor `icpaCalcEngine` Step 1 aplica esta misma
//     fórmula al diseñar la mezcla).
//   - OBJETIVO: f'cm = f'ce (el calculista ya aportó el sobrediseño afuera).
function _resolverReferenciasFc(m) {
  const fcContractual = Number(m?.tipoHormigon?.fcMpa) || null;
  const dosi = m?.dosificacion || null;
  let fcmRequerido = Number(dosi?.fcm) || null;
  if (!fcmRequerido && dosi) {
    const fce = Number(dosi.fce);
    const s = Number(dosi.desvioS);
    const modoFce = dosi.tipoHormigonModoFce === 'OBJETIVO' ? 'OBJETIVO' : 'ESPECIFICADO';
    if (Number.isFinite(fce) && fce > 0) {
      if (modoFce === 'OBJETIVO') {
        fcmRequerido = Math.round(fce * 10) / 10;
      } else if (Number.isFinite(s) && s > 0) {
        fcmRequerido = Math.round((fce + 1.65 * s) * 10) / 10;
      }
    }
  }
  return { fcContractual, fcmRequerido };
}

/**
 * Sección 6 — Evolución de resistencia.
 * Gráfico nativo (R vs √t) + tabla de relaciones por edad + interpretación.
 * Sólo se renderiza si hay ≥2 probetas ensayadas. Devuelve la nueva `y`; si
 * no se cumple el mínimo, devuelve la `y` recibida sin tocar el PDF.
 */
function _dibujarEvolucionResistencia(doc, m, ctx) {
  const { margin, contentW, pageH } = ctx;
  const probetas = Array.isArray(m?.probetas) ? m.probetas : [];
  const grupos = _resistenciasPorEdad(probetas);
  const totalEnsayadas = grupos.reduce((s, g) => s + g.n, 0);
  if (totalEnsayadas < 2) return ctx.y;
  let y = ctx.y;
  if (y + 100 > pageH - 30) { doc.addPage(); y = margin; }

  // El contador `sec` solo se incrementa si efectivamente se renderiza la
  // sección (evita huecos cuando archivos/evolución se omiten).
  const tituloSec = ctx.sec ? ctx.sec('Evolución de resistencia') : 'Evolución de resistencia';
  y = drawSectionTitle(doc, tituloSec, margin, y, contentW);

  /* ─── Referencias f'c (líneas horizontales en el gráfico) ─── */
  const { fcContractual, fcmRequerido } = _resolverReferenciasFc(m);
  // Detección de R28 ensayado y, si no, estimado por CEB-FIP β(t) (s=0,25).
  const g28 = grupos.find((g) => g.edad === 28);
  const r28Real = g28 ? g28.media : null;
  // Para la estimación se usa la edad < 28 con más probetas (desempate: la
  // más cercana a 28). Es la fuente más confiable.
  const candidatos = grupos.filter((g) => g.edad < 28).sort((a, b) => (b.n - a.n) || (b.edad - a.edad));
  const gEst = candidatos[0] || null;
  const r28Est = (!r28Real && gEst) ? gEst.media / _betaCEBFIP(gEst.edad) : null;
  const r28Ref = r28Real ?? r28Est ?? null;

  /* ─── Geometría del gráfico ─── */
  const chartH = 70;
  const padL = 14, padR = 22, padT = 6, padB = 12;
  const plotX0 = margin + padL;
  const plotY0 = y + padT;
  const plotW = contentW - padL - padR;
  const plotH = chartH - padT - padB;

  // Dominio X: hasta sqrt(max(28, maxEdadEnsayada)) con padding.
  const maxEdad = Math.max(28, ...grupos.map((g) => g.edad));
  const xMaxSqrt = Math.sqrt(maxEdad) * 1.05;
  const mapX = (t) => plotX0 + (Math.sqrt(Math.max(t, 0)) / xMaxSqrt) * plotW;

  // Dominio Y: cubre min/max + referencias + headroom.
  const todos = [];
  for (const g of grupos) todos.push(g.min, g.max);
  if (fcContractual) todos.push(fcContractual);
  if (fcmRequerido) todos.push(fcmRequerido);
  if (r28Est) todos.push(r28Est);
  const yLo = Math.min(...todos);
  const yHi = Math.max(...todos);
  const margenY = Math.max(2, (yHi - yLo) * 0.15);
  const yMin = Math.max(0, Math.floor((yLo - margenY) / 5) * 5);
  const yMax = Math.ceil((yHi + margenY) / 5) * 5;
  const mapY = (mpa) => plotY0 + plotH - ((mpa - yMin) / (yMax - yMin)) * plotH;

  /* ─── Fondo + ejes ─── */
  doc.setFillColor(252, 252, 254);
  doc.rect(plotX0, plotY0, plotW, plotH, 'F');
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.2);
  doc.rect(plotX0, plotY0, plotW, plotH, 'S');

  // Gridlines + ticks Y (5 marcas).
  doc.setFontSize(7);
  doc.setTextColor(110, 110, 110);
  doc.setDrawColor(225, 225, 230);
  const nTicksY = 5;
  for (let i = 0; i <= nTicksY; i++) {
    const v = yMin + ((yMax - yMin) * i) / nTicksY;
    const yy = mapY(v);
    doc.line(plotX0, yy, plotX0 + plotW, yy);
    doc.text(`${Math.round(v)}`, plotX0 - 1.5, yy + 1.2, { align: 'right' });
  }
  // Rótulo eje Y — rotado 90° (convención: lee de abajo hacia arriba),
  // alineado a la izquierda del eje y centrado verticalmente con el plot.
  // Posición fuera del área de ticks numéricos para que no se superponga.
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  const _lblY = tx('Resistencia [MPa]');
  const _lblYW = doc.getTextWidth(_lblY);
  doc.text(_lblY, margin + 2, plotY0 + plotH / 2 + _lblYW / 2, { angle: 90 });

  // Ticks X: en cada edad presente + 28 si no está + 1 si hay edades >1.
  const edadesTick = Array.from(new Set([
    ...grupos.map((g) => g.edad),
    ...(grupos.some((g) => g.edad === 28) ? [] : [28]),
  ])).sort((a, b) => a - b);
  doc.setDrawColor(225, 225, 230);
  for (const t of edadesTick) {
    const xx = mapX(t);
    doc.line(xx, plotY0, xx, plotY0 + plotH);
    doc.setTextColor(110, 110, 110);
    doc.text(`${t}d`, xx, plotY0 + plotH + 4, { align: 'center' });
  }
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  // √ (U+221A) no existe en WinAnsi: sanitizePdfText lo degrada a "V" → "Vt".
  // Rotulamos en lenguaje plano; las marcas en X ya hablan por sí solas (7d, 28d).
  doc.text(tx('Edad de rotura (días)'), plotX0 + plotW / 2, plotY0 + plotH + 9, { align: 'center' });

  /* ─── Líneas de referencia (f'c contractual / f'cm requerido) ─── */
  doc.setLineWidth(0.35);
  doc.setLineDashPattern([1.2, 0.9], 0);
  if (fcContractual && fcContractual >= yMin && fcContractual <= yMax) {
    doc.setDrawColor(56, 111, 194);
    const yy = mapY(fcContractual);
    doc.line(plotX0, yy, plotX0 + plotW, yy);
    doc.setTextColor(56, 111, 194);
    doc.text(tx(`f'c=${fcContractual}`), plotX0 + plotW + 1, yy + 1, { align: 'left' });
  }
  if (fcmRequerido && fcmRequerido >= yMin && fcmRequerido <= yMax) {
    doc.setDrawColor(40, 130, 60);
    const yy = mapY(fcmRequerido);
    doc.line(plotX0, yy, plotX0 + plotW, yy);
    doc.setTextColor(40, 130, 60);
    doc.text(tx(`f'cm=${fcmRequerido}`), plotX0 + plotW + 1, yy + 1, { align: 'left' });
  }
  doc.setLineDashPattern([], 0);

  /* ─── Datos: barras min-max, puntos por probeta, línea de medias ─── */
  doc.setLineWidth(0.4);
  doc.setDrawColor(70, 90, 130);
  for (const g of grupos) {
    if (g.n >= 2 && g.max > g.min) {
      const xx = mapX(g.edad);
      const yTop = mapY(g.max);
      const yBot = mapY(g.min);
      doc.line(xx, yTop, xx, yBot);
      doc.line(xx - 1.2, yTop, xx + 1.2, yTop);
      doc.line(xx - 1.2, yBot, xx + 1.2, yBot);
    }
  }
  // Puntos individuales (un círculo lleno por probeta).
  doc.setFillColor(18, 52, 86);
  for (const g of grupos) {
    const xx = mapX(g.edad);
    for (const r of g.resistencias) doc.circle(xx, mapY(r), 0.9, 'F');
  }
  // Línea de medias entre edades.
  doc.setDrawColor(18, 52, 86);
  doc.setLineWidth(0.55);
  for (let i = 1; i < grupos.length; i++) {
    const a = grupos[i - 1], b = grupos[i];
    doc.line(mapX(a.edad), mapY(a.media), mapX(b.edad), mapY(b.media));
  }
  // Marcador de R28 estimado (cuadrado hueco) si aplica.
  if (r28Est && gEst) {
    const xx = mapX(28);
    const yy = mapY(r28Est);
    doc.setDrawColor(120, 80, 10);
    doc.setLineWidth(0.4);
    doc.rect(xx - 1.3, yy - 1.3, 2.6, 2.6, 'S');
    // Conexión punteada desde la edad fuente hasta el R28 estimado.
    doc.setLineDashPattern([1.0, 0.8], 0);
    doc.line(mapX(gEst.edad), mapY(gEst.media), xx, yy);
    doc.setLineDashPattern([], 0);
    doc.setTextColor(120, 80, 10);
    doc.setFontSize(6.5);
    doc.text(tx(`R₂₈ est.`), xx + 2, yy - 0.5);
  }

  /* ─── Leyenda chica abajo del gráfico ─── */
  let yLeg = plotY0 + plotH + 13;
  doc.setFontSize(7);
  let xLeg = plotX0;
  const legendItem = (color, label, dashed = false) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.6);
    if (dashed) doc.setLineDashPattern([1.2, 0.9], 0);
    doc.line(xLeg, yLeg, xLeg + 6, yLeg);
    if (dashed) doc.setLineDashPattern([], 0);
    doc.setTextColor(80, 80, 80);
    doc.text(tx(label), xLeg + 7, yLeg + 1.2);
    xLeg += 7 + doc.getTextWidth(tx(label)) + 5;
  };
  doc.setFillColor(18, 52, 86);
  doc.circle(xLeg + 1, yLeg, 0.9, 'F');
  doc.setTextColor(80, 80, 80);
  doc.text(tx('Probeta'), xLeg + 3, yLeg + 1.2);
  xLeg += 3 + doc.getTextWidth(tx('Probeta')) + 5;
  legendItem([18, 52, 86], 'Media por edad');
  if (fcContractual) legendItem([56, 111, 194], `f'c contractual`, true);
  if (fcmRequerido) legendItem([40, 130, 60], `f'cm requerido`, true);
  if (r28Est) {
    doc.setDrawColor(120, 80, 10);
    doc.setLineWidth(0.4);
    doc.rect(xLeg, yLeg - 1.3, 2.6, 2.6, 'S');
    doc.setTextColor(80, 80, 80);
    doc.text(tx('R₂₈ estimado'), xLeg + 3.5, yLeg + 1.2);
  }
  y = plotY0 + plotH + 18;
  doc.setTextColor(0, 0, 0);
  doc.setLineDashPattern([], 0);

  /* ─── Tabla de relaciones por edad ─── */
  if (y + 28 > pageH - 30) { doc.addPage(); y = margin; }
  const usaFcm = !!fcmRequerido;
  const refVsLabel = usaFcm ? "vs f'cm req." : (fcContractual ? "vs f'c contr." : 'vs ref.');
  const refVsDen = usaFcm ? fcmRequerido : fcContractual;
  const rowsBase = grupos.map((g) => {
    const rr28 = r28Ref ? g.media / r28Ref : null;
    const vsRef = refVsDen ? (g.media / refVsDen) * 100 : null;
    return [
      tx(`${g.edad} d`),
      tx(`${g.n}`),
      tx(`${formatNumber(g.media, { precision: 1 })}`),
      tx(g.n >= 2 ? formatNumber(g.desvio, { precision: 2 }) : '—'),
      tx(g.n >= 2 ? `${formatNumber(g.cv, { precision: 1 })}%` : '—'),
      tx(rr28 != null ? formatNumber(rr28, { precision: 2 }) : '—'),
      tx(vsRef != null ? `${formatNumber(vsRef, { precision: 0 })}%` : '—'),
    ];
  });
  // Fila orientativa para R28 estimado (si no se ensayó 28 d).
  const rowsExtra = [];
  if (!r28Real && r28Est) {
    rowsExtra.push([
      { content: tx('28 d (estimado)'), styles: { fontStyle: 'italic' } },
      { content: tx('—'), styles: { fontStyle: 'italic' } },
      { content: tx(formatNumber(r28Est, { precision: 1 })), styles: { fontStyle: 'italic' } },
      { content: tx('—'), styles: { fontStyle: 'italic' } },
      { content: tx('—'), styles: { fontStyle: 'italic' } },
      { content: tx('1,00'), styles: { fontStyle: 'italic' } },
      { content: tx(refVsDen ? `${formatNumber((r28Est / refVsDen) * 100, { precision: 0 })}%` : '—'), styles: { fontStyle: 'italic' } },
    ]);
  }
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    rowPageBreak: 'avoid',
    // Sesión 2026-05-28: cada cell del head lleva su `styles.halign` explícito
    // para que coincida con el `halign` declarado en `columnStyles`. Sin esto
    // jspdf-autotable deja los headers en su default ("left") mientras el
    // body sí respeta el `columnStyles.halign`, produciendo la desalineación
    // que reportó el usuario (header "Resultado MPa" a la izquierda y body
    // "19,4" a la derecha del mismo ancho de columna).
    head: [[
      { content: tx('Edad'), styles: { halign: 'left' } },
      { content: tx('n'), styles: { halign: 'center' } },
      { content: tx('Resultado MPa'), styles: { halign: 'right' } },
      { content: tx('Desvío'), styles: { halign: 'right' } },
      { content: tx('CV %'), styles: { halign: 'right' } },
      { content: tx('R/R₂₈'), styles: { halign: 'right' } },
      { content: tx(refVsLabel), styles: { halign: 'right' } },
    ]],
    body: [...rowsBase, ...rowsExtra],
    styles: { fontSize: 8.5, cellPadding: 1.2 },
    headStyles: { fillColor: C.sectionTone },
    columnStyles: {
      0: { cellWidth: 24, fontStyle: 'bold' },
      1: { halign: 'center', cellWidth: 12 },
      2: { halign: 'right', cellWidth: 26 },
      3: { halign: 'right', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 18 },
      5: { halign: 'right', cellWidth: 22 },
      6: { halign: 'right', cellWidth: 'auto' },
    },
    theme: 'striped',
  });
  y = doc.lastAutoTable.finalY + 2;

  // Nota al pie de la tabla.
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(110, 110, 110);
  const notas = [];
  // Nota normativa (validada con revisor-civil): el "resultado de ensayo"
  // de una muestra a una edad ES el promedio de las probetas hermanas
  // ensayadas, NO cada valor individual (CIRSOC 200-2024 §6.2.3 / CIRSOC
  // 201-2005 §6.5.2 / IRAM 1666 §A.7.10). Los criterios de aceptación
  // se aplican sobre este promedio.
  notas.push("Resultado de ensayo a cada edad = promedio de las N probetas hermanas (CIRSOC 200-2024 §6.2.3 / IRAM 1666 §A.7.10). Los valores individuales por probeta se listan en la Sección 3.");
  if (usaFcm) {
    notas.push("vs f'cm requerido = R / f'cm (CIRSOC §6.2.3 — criterio técnico de aceptación promedio del lote).");
  } else if (fcContractual) {
    notas.push("vs f'c contractual = R / f'c. Sin desvío estándar registrado no se puede mostrar f'cm requerido.");
  }
  if (!r28Real && r28Est) {
    notas.push(`R₂₈ estimado por CEB-FIP β(t), s=0,25 (cemento clase N) a partir de R${gEst.edad} = ${formatNumber(gEst.media, { precision: 1 })} MPa. Orientativo, no reemplaza el ensayo real.`);
  }
  for (const n of notas) {
    const lineas = doc.splitTextToSize(tx(n), contentW);
    doc.text(lineas, margin, y + 3);
    y += lineas.length * 3 + 1;
  }
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  y += 2;

  /* ─── Línea destacada: resultado de ensayo a edad de diseño ───
     Hace explícita la lectura normativa (CIRSOC §6.2.3): el "resultado de
     ensayo" comparable contra los criterios de aceptación ES el promedio
     de probetas hermanas, no los individuales. Se muestra el promedio a la
     edad de diseño (típico 28 d; se usa `dosificacion.edadDisenio` si está). */
  const edadDiseno = Number(m?.dosificacion?.edadDisenio) || 28;
  const gDiseno = grupos.find((g) => g.edad === edadDiseno) || g28;
  if (gDiseno) {
    if (y + 14 > pageH - 30) { doc.addPage(); y = margin; }
    const boxH = 10;
    doc.setFillColor(245, 248, 252);
    doc.setDrawColor(56, 111, 194);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentW, boxH, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.primary);
    doc.text(
      tx(`Resultado de ensayo a ${gDiseno.edad} d (edad de diseño): ${formatNumber(gDiseno.media, { precision: 1 })} MPa`),
      margin + 3, y + 4.2,
    );
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(80, 80, 80);
    doc.text(
      tx(`Promedio de ${gDiseno.n} probeta(s) hermana(s). Valor comparable contra f'cm requerido y los criterios de aceptación CIRSOC 200-2024 §6.2.3.`),
      margin + 3, y + 8,
    );
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    y += boxH + 4;
  }

  /* ─── Interpretación auto-generada ─── */
  const interp = [];
  // R7/R28 si están disponibles.
  const g7 = grupos.find((g) => g.edad === 7);
  if (g7 && r28Ref) {
    const ratio = g7.media / r28Ref;
    // Umbrales alineados con el rango habitual mostrado (0,65–0,80). Antes el
    // umbral interno (0,60) no coincidía con el mostrado (0,65), por lo que
    // un valor 0,64 era reportado como "dentro del rango" siendo que estaba
    // claramente por debajo. Tono no-alarmista: una desviación leve suele
    // explicarse por el tipo de cemento, no necesariamente por un defecto.
    let comentario;
    if (ratio < 0.65) {
      comentario = 'por debajo del rango habitual (0,65–0,80). Frecuente en cementos con adiciones o puzolánicos; verificar coherencia con el cemento utilizado';
    } else if (ratio > 0.80) {
      comentario = 'por encima del rango habitual (0,65–0,80). Frecuente en cementos de alta resistencia inicial o de cinética rápida';
    } else {
      comentario = 'dentro del rango habitual (0,65–0,80)';
    }
    interp.push(`R₇/R₂₈ = ${formatNumber(ratio, { precision: 2 })}${r28Real ? '' : ' (R₂₈ estimado)'} — ${comentario}.`);
  }
  // Cumplimiento a 28 d (usa el real si está; el estimado solo orientativo).
  if (r28Real && refVsDen) {
    const margen = r28Real - refVsDen;
    const refLabel = usaFcm ? "f'cm requerido" : "f'c contractual";
    if (margen >= 0) {
      interp.push(`f'cm a 28 d (${formatNumber(r28Real, { precision: 1 })} MPa) supera al ${refLabel} (${refVsDen} MPa) con margen +${formatNumber(margen, { precision: 1 })} MPa.`);
    } else {
      interp.push(`f'cm a 28 d (${formatNumber(r28Real, { precision: 1 })} MPa) NO alcanza al ${refLabel} (${refVsDen} MPa) — falta ${formatNumber(-margen, { precision: 1 })} MPa.`);
    }
  } else if (!r28Real && r28Est) {
    interp.push(`R₂₈ aún no ensayada. Estimación orientativa: ${formatNumber(r28Est, { precision: 1 })} MPa (CEB-FIP).`);
  }
  // CV intra-edad alto.
  const cvAlto = grupos.filter((g) => g.n >= 2 && g.cv > 15);
  if (cvAlto.length > 0) {
    const detalles = cvAlto.map((g) => `${g.edad} d: ${formatNumber(g.cv, { precision: 1 })}%`).join(', ');
    interp.push(`CV intra-edad elevado (>15%) en ${detalles}. Revisar uniformidad del moldeo/curado.`);
  }
  if (interp.length > 0) {
    if (y + interp.length * 4 + 4 > pageH - 30) { doc.addPage(); y = margin; }
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.primary);
    doc.text(tx('Interpretación'), margin, y + 3);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    for (const linea of interp) {
      const lineas = doc.splitTextToSize(tx(`• ${linea}`), contentW);
      doc.text(lineas, margin, y + 3);
      y += lineas.length * 3.5 + 1;
    }
  }
  return y + 6;
}

/**
 * Dibuja un título de sección con banda azul redondeada (mismo patrón que
 * `sectionHeader` de dosificacionInformePdf). Devuelve la `y` donde el
 * caller puede continuar dibujando, ya con un colchón inferior aplicado.
 */
function drawSectionTitle(doc, texto, margin, y, contentW) {
  const bandH = 7.5;
  doc.setFillColor(...C.primary);
  doc.roundedRect(margin, y, contentW, bandH, 1.2, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.white);
  doc.text(tx(texto), margin + 3, y + 5.2);
  // Reset para que el caller herede colores neutros.
  doc.setTextColor(...C.text);
  doc.setFont('helvetica', 'normal');
  return y + bandH + 3.5;
}

/**
 * Genera el PDF de ficha de muestra.
 *
 * @param {object} datos   Resultado del endpoint GET /api/muestra/:id/ficha
 *   o /api/muestras-terceros/:id/ficha.
 *   { muestra, fresco, fresco_inputs }
 * @param {object} configEmpresa
 *   - nombreEmpresa, direccion, logoLink (o logoBase64)
 * @param {object} [opciones]
 *   - tituloDocumento: encabezado y footer; default "Ficha de muestra".
 *   - subtituloDocumento: bajada bajo el título; default "Resumen del moldeo y curado de probetas".
 *   - filenamePrefix: prefijo del filename; default "Ficha_muestra".
 * @returns {Promise<{ buffer, filename, doc }>}
 */
export async function generarFichaMuestraPdf(datos, configEmpresa = {}, opciones = {}) {
  if (!datos || !datos.muestra) {
    throw new Error('Sin datos de muestra para emitir la ficha.');
  }
  const m = datos.muestra;
  const fresco = datos.fresco;
  const inputs = datos.fresco_inputs || {};
  const tituloDocumento = opciones.tituloDocumento || 'Ficha de muestra';
  const subtituloDocumento = opciones.subtituloDocumento || 'Resumen del moldeo y curado de probetas';
  const filenamePrefix = opciones.filenamePrefix || 'Ficha_muestra';

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  // Embedemos DejaVu Sans para que la capa de texto del PDF tenga las
  // tildes/ñ correctamente decodificadas por extractores y screen readers.
  // Antes con Helvetica built-in pdftotext devolvía U+FFFD para todos los
  // caracteres con acento (auditoría visual smoke-pdf-visual del test42).
  // El catch dejaba pasar fallos silenciosos: si DejaVu no carga, el PDF se
  // genera pero copiar/pegar texto rompe acentos (test46). Logueamos el
  // motivo para diagnóstico.
  try { await registerDejavuOnDoc(doc); }
  catch (e) { console.warn('[fichaMuestraPdf] DejaVu no se pudo registrar, capa de texto puede tener encoding roto:', e); }
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;

  /* ─── Encabezado con banda azul (mejora contraste del logo).
     Pasamos `nombreEmpresa: ''` para suprimir el texto del nombre de empresa:
     ya aparece en el título del documento debajo, no necesitamos repetirlo. */
  let y = await drawPdfHeader(doc, {
    configEmpresa: { ...configEmpresa, nombreEmpresa: '', direccion: undefined },
    margin,
    headerBg: C.primary,
  });

  /* ─── Título del documento ─── */
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.primary);
  doc.text(tx(`${tituloDocumento} #${m.idMuestra}`), margin, y + 4);
  y += 7;
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...C.text);
  doc.text(tx(subtituloDocumento), margin, y + 3);
  y += 7;
  doc.setFont('helvetica', 'normal');

  // Contador dinámico de secciones — evita huecos en la numeración cuando
  // alguna sección (archivos, evolución) se omite por condición. Antes los
  // números estaban hardcodeados y el lector veía "4 → 6" (smoke test69).
  let _secCount = 0;
  const sec = (titulo) => `${++_secCount}. ${titulo}`;

  /* ─── Identificación ─── */
  y = drawSectionTitle(doc, sec('Identificación'), margin, y, contentW);
  // Dosificación: prioridad al catálogo (FK), fallback al texto libre (muestras
   // de terceros donde no estaba en el catálogo del tenant).
   const dosifNombre = m.dosificacion?.nombre || m.dosificacionTextoLibre || '—';
  const tipoH = m.tipoHormigon?.tipoHormigon
    ?? m.dosificacion?.tipoHormigon?.tipoHormigon
    ?? '—';
  // Identificación: las muestras de pastón de prueba no tienen despacho ni
  // modalidad, pero sí origen (Planta/Obra) y lote. Se arma el cuerpo según
  // el tipo de muestra (`m.esPaston`).
  const operadorTxt = m.operador
    ? `${m.operador.apellido || ''}, ${m.operador.nombre || ''}`.trim() || '—'
    : '—';
  const identBody = m.esPaston
    ? [
        [tx('Cliente'),          tx(clienteNombre(m.cliente))],
        [tx('Obra'),             tx(m.obra?.nombre || '—')],
        [tx('Planta'),           tx(m.planta?.nombre || '—')],
        [tx('Fecha de moldeo'),  tx(formatDate(m.fecha))],
        [tx('Confeccionada en'), tx(m.origen === 'OBRA' ? 'Obra' : 'Planta')],
        [tx('Lote'),             tx(m.loteNumero != null ? `T${m.loteNumero}` : '—')],
        ...(m.idPastonPrueba ? [[tx('Pastón de prueba'), tx(`#${m.idPastonPrueba}`)]] : []),
        [tx('Remito'),           tx(m.remito || '—')],
        [tx('Tipo de hormigón'), tx(tipoH)],
        [tx('Dosificación'),     tx(dosifNombre)],
        [tx('Operador'),         tx(operadorTxt)],
      ]
    : [
        [tx('Cliente'),         tx(clienteNombre(m.cliente))],
        [tx('Obra'),            tx(m.obra?.nombre || '—')],
        [tx('Planta'),          tx(m.planta?.nombre || '—')],
        [tx('Fecha de moldeo'), tx(formatDate(m.fecha))],
        [tx('Hora del despacho'), tx(m.despacho?.hora || '—')],
        [tx('Remito'),          tx(m.remito || m.despacho?.remito || '—')],
        [tx('Tipo de hormigón'), tx(tipoH)],
        [tx('Dosificación'),    tx(dosifNombre)],
        [tx('Modalidad'),       tx(m.modalidad?.modalidad || '—')],
        [tx('Operador'),        tx(operadorTxt)],
      ];
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [],
    body: identBody,
    // cellPadding bajo: la tabla de Identificación no tiene header y al ser
    // 10 filas se ve "aireada" comparada con las demás. Compactarla recupera
    // ~10mm verticales — clave para que el informe entre en una sola página
    // (smoke-pdf-visual test47).
    styles: { fontSize: 9, cellPadding: { top: 0.8, right: 1.5, bottom: 0.8, left: 1.5 } },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    theme: 'plain',
  });
  y = doc.lastAutoTable.finalY + 7;

  /* ─── Sección 2: Hormigón fresco ─── */
  y = drawSectionTitle(doc, sec('Hormigón fresco'), margin, y, contentW);

  // Trazabilidad: si la muestra es de un pastón y el fresco se deriva de una
  // medición del timeline, indicarlo bajo el título de sección. Le permite al
  // lector saber exactamente de qué momento del moldeo vienen estos valores.
  if (m.esPaston && inputs.medicion) {
    const md = inputs.medicion;
    const horaTxt = md.fechaHora
      ? new Date(md.fechaHora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
      : null;
    const partes = [`Medición #${md.ordenSecuencia ?? '—'}`, md.etapa || null, md.etiqueta || null, horaTxt]
      .filter(Boolean);
    const sufijo = md.derivado ? ' (derivada del timeline)' : '';
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(tx(`Datos tomados de: ${partes.join(' · ')}${sufijo}`), margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.text);
  }

  const filas = [];
  // Asentamiento
  if (fresco?.asentamiento) {
    const sev = fresco.asentamiento.severity || 'ok';
    filas.push([
      tx('Asentamiento (cono Abrams)'),
      tx(inputs.asentamientoMmMedido != null ? `${inputs.asentamientoMmMedido} mm` : '—'),
      tx(SEV_LABEL[sev] || sev),
      tx(fresco.asentamiento.motivo || ''),
    ]);
  }
  // Temperatura
  if (fresco?.temperatura) {
    const sev = fresco.temperatura.severity || 'ok';
    filas.push([
      tx('Temperatura del hormigón'),
      tx(inputs.temperaturaHormigon != null ? `${formatNumber(inputs.temperaturaHormigon, { precision: 1 })} °C` : '—'),
      tx(SEV_LABEL[sev] || sev),
      tx(fresco.temperatura.motivo || ''),
    ]);
  }
  // Aire
  if (fresco?.aire) {
    const sev = fresco.aire.severity || 'ok';
    filas.push([
      tx('Aire incorporado'),
      tx(inputs.aireincorporado != null ? `${formatNumber(inputs.aireincorporado, { precision: 1 })} %` : '—'),
      tx(SEV_LABEL[sev] || sev),
      tx(fresco.aire.motivo || ''),
    ]);
  }
  // Temperatura ambiente (informativo, sin veredicto normativo). Se muestra
  // SIEMPRE: si no hay dato medido, la fila aparece igual con "Sin datos".
  // Esto explicita que el dato no se omitió por error sino que no se midió.
  filas.push([
    tx('Temperatura ambiente'),
    inputs.temperaturaAmbiente != null
      ? tx(`${formatNumber(inputs.temperaturaAmbiente, { precision: 1 })} °C`)
      : tx('Sin datos'),
    tx('—'),
    tx('Informativo, no se evalúa.'),
  ]);

  if (filas.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(tx('Sin mediciones de hormigón fresco registradas.'), margin, y + 4);
    y += 9;
    doc.setFont('helvetica', 'normal');
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      rowPageBreak: 'avoid',
      head: [[tx('Ensayo'), tx('Valor'), tx('Veredicto'), tx('Observación')]],
      body: filas,
      styles: { fontSize: 9, cellPadding: 1 },
      headStyles: { fillColor: C.sectionTone },
      columnStyles: {
        0: { cellWidth: 50, fontStyle: 'bold' },
        1: { cellWidth: 30 },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 'auto' },
      },
      theme: 'striped',
    });
    y = doc.lastAutoTable.finalY + 7;
  }

  /* ─── Sección 3: Probetas moldeadas ─── */
  if (y + 40 > pageH - 30) { doc.addPage(); y = margin; }
  y = drawSectionTitle(doc, sec('Probetas moldeadas'), margin, y, contentW);

  const probetas = Array.isArray(m.probetas) ? m.probetas : [];
  if (probetas.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.text(tx('Sin probetas asociadas a esta muestra.'), margin, y + 4);
    y += 9;
    doc.setFont('helvetica', 'normal');
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      rowPageBreak: 'avoid',
      head: [[
        tx('#'),
        tx('Nombre'),
        tx('Código'),
        tx('Edad rotura'),
        tx('Fecha rotura'),
        tx('Estado'),
        tx('Peso (g)'),
        tx('Altura (mm)'),
        tx('Diám. (mm)'),
        tx('Resistencia'),
        tx('H/D'),
        tx('Tipo rotura'),
      ]],
      body: probetas.map((p, i) => {
        const ensayo = p.ensayo;
        const resistenciaTxt = ensayo
          ? `${formatNumber(ensayo.resistencia, { precision: 2 })} MPa`
          : '—';
        // Peso / altura / diámetro medidos en el ensayo de rotura. La unidad
        // va en el encabezado (g / mm) para no repetirla por fila; las celdas
        // sólo llevan el número (alineado a la derecha vía columnStyles).
        const pesoTxt = ensayo && ensayo.peso != null
          ? formatNumber(ensayo.peso, { precision: 0 })
          : '—';
        const alturaTxt = ensayo && ensayo.altura != null
          ? formatNumber(ensayo.altura, { precision: 1 })
          : '—';
        const diamTxt = ensayo && ensayo.diametro != null
          ? formatNumber(ensayo.diametro, { precision: 1 })
          : '—';
        // R5 (revisor-civil 2026-05-08): mostramos relación H/D real
        // (altura/diámetro), no el factor — para probetas moldeadas H/D=2
        // siempre y no se aplica factor (IRAM 1524/1534).
        const hdReal = ensayo && ensayo.altura && ensayo.diametro
          ? formatNumber(ensayo.altura / ensayo.diametro, { precision: 3 })
          : '—';
        const tipoRot = ensayo?.tipoRotura
          ? (TIPO_ROTURA_LABEL[ensayo.tipoRotura] || ensayo.tipoRotura)
          : '—';
        return [
          tx(`${i + 1}`),
          tx(p.nombre || `#${p.idProbeta}`),
          tx(p.codigo || '—'),
          tx(`${p.diasRotura} d`),
          tx(formatDate(p.fechaRotura)),
          tx(ESTADO_PROBETA_LABEL[p.idEstadoProbeta] || '—'),
          tx(pesoTxt),
          tx(alturaTxt),
          tx(diamTxt),
          tx(resistenciaTxt),
          tx(hdReal),
          tx(tipoRot),
        ];
      }),
      // fontSize 7 + anchos explícitos: con 12 columnas en A4 vertical
      // (contentW ≈ 178 mm) el reparto automático apretaba el texto y partía
      // celdas. Numéricos a la derecha; las columnas de texto se dejan más
      // anchas (Código y Tipo de rotura son las que más crecen).
      styles: { fontSize: 7, cellPadding: 1, overflow: 'linebreak' },
      // NO fijar `halign` en headStyles: pisaba la alineación por columna y
      // dejaba todos los encabezados centrados aunque la celda fuera a la
      // derecha (ej. "Peso (g)" centrado sobre números alineados a la
      // derecha). Con el halign sólo en columnStyles, encabezado y celda de
      // cada columna quedan alineados igual.
      headStyles: { fillColor: C.sectionTone },
      columnStyles: {
        0: { cellWidth: 6, halign: 'center' },
        1: { cellWidth: 16, halign: 'left' },
        2: { cellWidth: 22, halign: 'left' },
        3: { cellWidth: 11, halign: 'center' },
        4: { cellWidth: 18, halign: 'center' },
        5: { cellWidth: 15, halign: 'center' },
        6: { cellWidth: 14, halign: 'right' },
        7: { cellWidth: 14, halign: 'right' },
        8: { cellWidth: 14, halign: 'right' },
        9: { cellWidth: 17, halign: 'right' },
        10: { cellWidth: 11, halign: 'right' },
        11: { cellWidth: 'auto', halign: 'left' },
      },
      // Garantía a prueba de versión: forzamos el halign del encabezado de
      // cada columna al mismo de su cuerpo (algunas versiones de
      // jspdf-autotable priorizan headStyles sobre columnStyles en la fila de
      // encabezado).
      didParseCell: (data) => {
        if (data.section === 'head') {
          const al = PROBETA_COL_HALIGN[data.column.index];
          if (al) data.cell.styles.halign = al;
        }
      },
      theme: 'striped',
    });
    y = doc.lastAutoTable.finalY + 4;

    /* ─── Referencia de tipos de rotura (IRAM 1546:2013 §11) ───
       Para lectores no técnicos, el número de la última columna ("Tipo 2",
       "Tipo 4", etc.) no dice nada por sí solo: agregamos la leyenda con la
       descripción de cada patrón de fractura. Es informativo — no determina
       aptitud (esta tabla es sobre hormigón ya ensayado; el criterio es la
       norma). La clasificación es de IRAM 1546 (método de ensayo de
       compresión), NO de IRAM 1666 (que es especificación del elaborado y se
       cita en la sección de evolución de resistencia). */
    if (y + 26 > pageH - 30) { doc.addPage(); y = margin; }
    const refTitulo = 'Referencia — Tipo de rotura (IRAM 1546:2013 §11):';
    const refItems =
      'Tipo 1: conos bien formados en ambas bases.   '
      + 'Tipo 2: cono en una base y fisuras verticales a través de las bases en la otra.   '
      + 'Tipo 3: columnar (fisuras verticales a través de ambas bases).   '
      + 'Tipo 4: diagonal, sin fisuras a través de las bases.   '
      + 'Tipo 5: cortante (fractura lateral cerca de una base).   '
      + 'Tipo 6: terminación en punta en una base.';
    const refNota =
      'Los tipos 5 y 6 (y en parte el 2) suelen asociarse a deficiencias en la '
      + 'preparación de las bases o el refrentado de la probeta, no necesariamente '
      + 'a la calidad del hormigón. Clasificación informativa.';

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(tx(refTitulo), margin, y + 3);
    y += 5;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(90, 90, 90);
    const itemLines = doc.splitTextToSize(tx(refItems), contentW);
    doc.text(itemLines, margin, y + 1);
    y += itemLines.length * 3.4 + 1.5;

    doc.setFont('helvetica', 'italic');
    doc.setTextColor(110, 110, 110);
    const notaLines = doc.splitTextToSize(tx(refNota), contentW);
    doc.text(notaLines, margin, y + 1);
    y += notaLines.length * 3.4;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    y += 5;
  }

  /* ─── Sección 4: Resumen estado actual ─── */
  if (probetas.length > 0) {
    if (y + 25 > pageH - 30) { doc.addPage(); y = margin; }
    const counts = {
      [ESTADO_PROBETA.CURANDO]: 0,
      [ESTADO_PROBETA.PENDIENTE]: 0,
      [ESTADO_PROBETA.ENSAYADA]: 0,
      [ESTADO_PROBETA.DESCARTADA]: 0,
      [ESTADO_PROBETA.PERDIDA]: 0,
    };
    for (const p of probetas) counts[p.idEstadoProbeta] = (counts[p.idEstadoProbeta] || 0) + 1;

    y = drawSectionTitle(doc, sec('Estado actual del lote'), margin, y, contentW);
    autoTable(doc, {
      startY: y,
      // tableWidth fijo evita que la columna Cantidad se estire al margen
      // derecho del A4 y quede pegada al borde imprimible (auditoría visual
      // test42). Centramos la tabla con el offset.
      tableWidth: 90,
      margin: { left: margin, right: margin },
      // `rowPageBreak: 'avoid'` evita que la tabla se parta entre páginas
      // (smoke-pdf-visual test47: la fila "Perdida" quedaba sola en la pág 2).
      rowPageBreak: 'avoid',
      head: [[tx('Estado'), tx('Cantidad')]],
      body: Object.entries(ESTADO_PROBETA).map(([key, id]) => [
        tx(ESTADO_PROBETA_LABEL[id]),
        tx(`${counts[id] || 0}`),
      ]),
      styles: { fontSize: 9, cellPadding: 1 },
      headStyles: { fillColor: C.sectionTone },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { halign: 'right', cellWidth: 30 },
      },
      theme: 'striped',
    });
    y = doc.lastAutoTable.finalY + 7;
  }

  /* ─── Evolución de resistencia (antes de Archivos: analítica primero) ───
     Sólo se renderiza si hay ≥2 probetas ensayadas. Gráfico R vs √t + tabla
     de relaciones + interpretación auto-generada con R₂₈ estimado (CEB-FIP
     β(t), s=0,25) cuando aún no se rompió la probeta de 28 d. El número de
     sección sale del contador dinámico `sec`. */
  y = _dibujarEvolucionResistencia(doc, m, { margin, contentW, pageH, y, sec });

  /* ─── Archivos referenciados (al final del contenido) ─── */
  const archivosTotal = probetas.flatMap((p) => p.archivos || []);
  if (archivosTotal.length > 0) {
    if (y + 20 > pageH - 30) { doc.addPage(); y = margin; }
    y = drawSectionTitle(doc, sec('Archivos adjuntos'), margin, y, contentW);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.text(tx('Para acceder a los archivos, ingresar al sistema con la probeta indicada.'), margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [[tx('Probeta'), tx('Archivo'), tx('Tipo')]],
      body: probetas.flatMap((p) =>
        (p.archivos || []).map((a) => [
          tx(p.nombre || `#${p.idProbeta}`),
          tx(a.nombreOriginal || `#${a.idArchivo}`),
          tx(a.mimeType || '—'),
        ])
      ),
      styles: { fontSize: 8, cellPadding: 1 },
      headStyles: { fillColor: C.sectionTone },
      theme: 'striped',
    });
    y = doc.lastAutoTable.finalY + 10;
  }

  /* ─── Firmas ───
     Posición Y dinámica = donde terminó la última sección + offset razonable.
     Antes la Y se calculaba desde una variable que quedaba 4-5 cm separada
     del contenido (auditoría visual test42). */
  // Bug previo: si arrancaba addPage(), `firmaTop` seguía usando el yFirmas
  // viejo (~pageH-35) → las firmas se dibujaban en y≈270 de la página NUEVA
  // dejando toda la parte de arriba en blanco. Ahora cuando hay salto de
  // página, las firmas arrancan cerca del tope (margin + 8); si no, mantienen
  // el ancla al pie de la página (pageH-35).
  let firmaTop;
  if (Math.max(y, pageH - 35) + 20 > pageH - 12) {
    doc.addPage();
    firmaTop = margin + 8;
  } else {
    firmaTop = Math.max(y, pageH - 35) + 8;
  }
  const firmaW = (pageW - 2 * margin - 10) / 2;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.line(margin, firmaTop, margin + firmaW, firmaTop);
  doc.text(tx('Operario laboratorio'), margin, firmaTop + 4);

  const xJefe = margin + firmaW + 10;
  doc.line(xJefe, firmaTop, xJefe + firmaW, firmaTop);
  doc.text(tx('Jefe de planta / Responsable de Calidad'), xJefe, firmaTop + 4);

  /* ─── Footer paginación ─── */
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.text(`Página ${i}/${total}`, pageW - margin, pageH - 5, { align: 'right' });
    // Footer: dato propio del documento, sin jerga interna del proyecto.
    doc.text(tx(`${tituloDocumento} #${m.idMuestra}`), margin, pageH - 5);
  }

  const fechaStr = formatDate(m.fecha).replace(/\//g, '-');
  const filename = `${filenamePrefix}_${m.idMuestra}_${fechaStr}.pdf`;
  return { buffer: doc.output('arraybuffer'), filename, doc };
}

export default generarFichaMuestraPdf;
