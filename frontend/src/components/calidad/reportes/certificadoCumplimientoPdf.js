import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatNumber, formatDate, sanitizePdfText, formatSubtipoAgregado } from '../../../lib/format';
import { registerDejavuOnDoc, hasDejavuLoaded } from '../../../lib/format/dejavuFont';
import { detectarDatosDePrueba, watermarkText, watermarkColor } from '../../../lib/testDataDetection';
import { getEnvironmentTag, environmentWatermarkText } from '../../../lib/environment';
import {
  getCategoriaPdfPresentation,
  getCategoriaPdfLabel,
  getCategoriaPdfColor,
} from '../../../lib/compliance/pdfPresentation';
import { VEREDICTO } from '../../../lib/compliance';
// PR9.4 — modelo dual de evaluación.
// Default PRESTACIONAL (decisión 1: certificado puede emitirse según el plan
// de control de calidad de la planta productora; toggle a PRESCRIPTIVO
// disponible para verificación normativa estricta en auditorías externas).
import { MODO_PRESCRIPTIVO, MODO_PRESTACIONAL } from '../../../lib/evaluacion';

/* ───────── Categorización de hits cumple/CUMPLE en este archivo (Prompt 3 C9.2) ─────────
 *
 * (A) DISPLAY del veredicto al usuario — migrados al helper canónico:
 *     - Estado por ensayo (columna "Estado" de la tabla, ~L290)
 *     - Color de celda Estado vía didParseCell (~L300)
 *     - Banner del dictamen (color + texto, ~L320)
 *
 * (B) VOCABULARIO INTERNO preservado — el contrato del PDF acepta
 *     `cumple: boolean` y `cumpleGlobal: boolean` por back-compat con callers
 *     que aún no migran. El helper resuelve ambos shapes a categoría canónica.
 *     A futuro, los callers pasarán `compliance: ComplianceResult` y el
 *     boolean queda como camino legacy.
 *
 * (C) TEXTO NORMATIVO preservado — frases fijas del documento formal:
 *     - "El material evaluado CUMPLE con los requisitos normativos aplicables."
 *     - "Condiciones de aplicabilidad:"
 *     - "Motivos de la no certificación:"
 *     - Disclaimer al pie
 *     Esto NO migra: es el lenguaje formal del certificado/informe que un
 *     ingeniero lee y firma. Se condiciona al wording según categoría visual,
 *     pero el texto en sí permanece como redacción profesional.
 */

const C = {
  primary: [31, 97, 141], accent: [39, 174, 96], danger: [192, 57, 43],
  white: [255, 255, 255], text: [44, 62, 80], muted: [127, 140, 141],
  gold: [184, 134, 11],
};

const fmtDate = (d) => formatDate(d);
const fmtNum = (v, d = 2) => formatNumber(v, { precision: d, forceDecimals: true });
const tx = (s) => sanitizePdfText(s);

/**
 * Tipos de documento que este emisor puede generar.
 * - CERTIFICADO: Certificado de Cumplimiento (cuando policy lo permite)
 * - INFORME_EVALUACION: Informe de Evaluación (cuando hay incumplimientos /
 *   ensayos faltantes / inconcluyentes; NO afirma cumplimiento)
 */
export const DOC_TYPE = Object.freeze({
  CERTIFICADO: 'CERTIFICADO',
  INFORME_EVALUACION: 'INFORME_EVALUACION',
});

/**
 * IMPORTANTE: este es un emisor de bajo nivel. NO debe invocarse directamente
 * desde componentes UI — todos los call sites deben pasar por
 * `lib/document-issuance/emitDocument()`, que aplica la
 * `CertificateIssuancePolicy` antes de decidir qué documento emitir.
 *
 * El refactor de P0.1 movió la decisión "emitir certificado vs informe" fuera
 * de este archivo. Acá solo se construye el PDF según el `tipo` indicado.
 *
 * @param {Object} opts
 * @param {('CERTIFICADO'|'INFORME_EVALUACION')} [opts.tipo='CERTIFICADO']
 * @param {string} opts.empresa
 * @param {string} opts.planta
 * @param {string} opts.nroCertificado — e.g. "CERT-2026-0042" (o "INF-..." según tipo)
 * @param {Object} opts.material — { nombre, tipo, subtipo, productor, cantera }
 * @param {string} opts.normaRef — "CIRSOC 200:2024 / IRAM 1512"
 * @param {Array} opts.ensayos — [{ nombre, norma, resultado, unidad, especificacion, cumple, compliance, estadoLabel, fecha, laboratorio, nroInforme }]
 *   - `cumple: boolean` y `estadoLabel: string` se preservan por back-compat (P0.1).
 *   - `compliance: ComplianceResult` (Prompt 3 C9.2) — si está, gana sobre `cumple`.
 * @param {boolean} opts.cumpleGlobal — back-compat con callers pre-Prompt 3.
 * @param {Object} [opts.veredictoGlobal] — ComplianceResult agregado (Prompt 3 C9.2).
 *   Si está, gana sobre `cumpleGlobal` para resolver categoría visual.
 * @param {string} [opts.veredictoGlobalLabel] - label legacy (deprecated; usar veredictoGlobal)
 * @param {string[]} [opts.razonesNoCumple] - usado en INFORME_EVALUACION
 * @param {string[]} [opts.notasCondicionales] - condiciones a verificar (Allowed con notas)
 * @param {Array<{ensayoNombre, banda, fueraDeBanda: Array<{tamiz, medido, min, max, desvio}>}>} [opts.granulometriaDetalle]
 *   Detalle por tamiz para fallas de granulometría (P1.3). Solo se renderiza
 *   si tiene ítems Y el tipo es INFORME_EVALUACION.
 * @param {Object} [opts.destinoUso] - contexto de uso bajo el cual se evaluó (P1.5).
 *   { expuestoDesgaste?: bool, claseExposicion?: string, fceMpa?: number }
 *   Si no se provee, el documento aclara que se aplicaron criterios estándar
 *   sin contexto de destino específico.
 * @param {string} opts.observaciones
 * @param {string} opts.responsable
 * @param {string} opts.validezHasta — fecha (solo en CERTIFICADO)
 * @param {string} opts.logoUrl
 */
export function generarCertificadoCumplimientoPdf(opts) {
  const {
    tipo = DOC_TYPE.CERTIFICADO,
    empresa, planta, nroCertificado, material = {}, normaRef, ensayos = [],
    cumpleGlobal, veredictoGlobal = null, veredictoGlobalLabel,
    razonesNoCumple = [],
    notasCondicionales = [],
    granulometriaDetalle = [],
    destinoUso = null,
    observaciones, responsable, validezHasta, logoUrl,
    // P2.10 — datos del emisor para footer oficial
    cuitEmpresa, direccionEmpresa, emailEmpresa,
    // K.4 — override CIRSOC §3.2.3.2 f) estampado en el documento
    overrideActivo = null,
    // Decisión 2026-05-28: el certificado de cumplimiento normativo
    // pasa a NORMATIVO siempre. Un "certificado descriptivo" es un
    // sinsentido — el documento mismo está nominado para emitir un
    // veredicto formal contra la norma. El argumento `modoEvaluacion`
    // queda solo por compat de la firma del caller; cualquier valor
    // que apunte a DESCRIPTIVO/PRESTACIONAL se ignora con warning.
    modoEvaluacion = 'NORMATIVO',
  } = opts;
  const _modoUpperCert = String(modoEvaluacion).toUpperCase();
  if (_modoUpperCert === 'DESCRIPTIVO' || _modoUpperCert === 'PRESTACIONAL') {
    // eslint-disable-next-line no-console
    console.warn('[certificadoCumplimientoPdf] modoEvaluacion=%s ignorado: el certificado se emite siempre en modo NORMATIVO (decisión 2026-05-28). Si querés un documento descriptivo de cumplimiento, generá el informe de dosificación en modo Descriptivo o la ficha técnica del agregado en modo Descriptivo.', modoEvaluacion);
  }
  // Mantengo la constante con nombre legacy MODO_PRESCRIPTIVO para no
  // tocar las ~10 referencias internas (es un módulo grande); en strings
  // visibles uso "NORMATIVO".
  const _modoCert = MODO_PRESCRIPTIVO;

  // Resuelve la categoría visual canónica del veredicto agregado a partir
  // de los inputs disponibles, en orden de preferencia (C9.2):
  //   1. veredictoGlobal (ComplianceResult, máxima fidelidad)
  //   2. cumpleGlobal (boolean legacy: true → APTO, false → NO APTO)
  //   3. EVALUACIÓN INCOMPLETA (default seguro si no hay nada)
  const veredictoPresentation = getCategoriaPdfPresentation(
    veredictoGlobal || cumpleGlobal,
  );

  const isInforme = tipo === DOC_TYPE.INFORME_EVALUACION;

  const doc = new jsPDF('p', 'mm', 'a4');
  // P2.1 — registrar DejaVu Sans si está precargada y monkey-patch setFont
  // para redirigir TODAS las llamadas existentes (`doc.setFont('Helvetica', ...)`)
  // hacia DejaVu sin tocar cada call site. Si la fuente no está disponible,
  // setFont funciona normalmente con Helvetica + sanitizer Latin-1.
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
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = 0;

  // ── Border frame: se dibuja en el loop final por-página (P3 fix). Antes se
  //    dibujaba acá una sola vez y las páginas agregadas posteriormente con
  //    addPage() (ej. cuando el banner del dictamen no entraba completo) se
  //    quedaban sin frame. Además la altura previa (pageH-16) hacía que el
  //    borde inferior cayera en pageH-8, pisando el footer en pageH-6. La
  //    nueva altura (pageH-24) deja margen limpio para el footer.

  // ── Watermark de DATOS DE PRUEBA (P2.14) ──
  // Heurística: si los IDs de informe, nombre de material, cantera, etc.
  // tienen patrones obvios de testing, estampar watermark grande.
  // Política: warning + watermark, sin bloqueo.
  const deteccionPrueba = detectarDatosDePrueba(material, ensayos);
  if (deteccionPrueba.esProbablementePrueba) {
    const wmText = watermarkText(deteccionPrueba);
    const [r, g, b] = watermarkColor(deteccionPrueba);
    doc.saveGraphicsState();
    try {
      doc.setGState(new doc.GState({ opacity: 0.18 }));
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(36);
      doc.setTextColor(r, g, b);
      // Estampar diagonalmente en el centro de la página
      doc.text(wmText, pageW / 2, pageH / 2, {
        align: 'center',
        angle: -35,
        baseline: 'middle',
      });
    } finally {
      // R6 (auditoría 01-calidad): restoreGraphicsState debe correr siempre,
      // aun si setGState/text tiran. Sin try/finally, una excepción dejaría la
      // opacidad 0,18 activa y todo el resto del PDF saldría semitransparente.
      doc.restoreGraphicsState();
    }
  }

  // ── Header — el título y el color cambian según el tipo de documento ──
  y = 22;
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(16);
  // Color del título: azul para certificado, naranja para informe (señaliza
  // que NO es un certificado de cumplimiento)
  doc.setTextColor(...(isInforme ? [217, 119, 6] : C.primary));
  const titulo = isInforme ? 'INFORME DE EVALUACIÓN' : 'CERTIFICADO DE CUMPLIMIENTO';
  doc.text(tx(titulo), pageW / 2, y, { align: 'center' });
  y += 7;
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...C.muted);
  doc.text(tx(normaRef || 'CIRSOC 200:2024'), pageW / 2, y, { align: 'center' });
  y += 5;
  if (nroCertificado) {
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.gold);
    doc.text(tx(`Nº ${nroCertificado}`), pageW / 2, y, { align: 'center' });
  }
  y += 10;

  // ── PR9.4 — Banner del modo de evaluación ──
  // Decisión arquitectónica: el certificado por default refleja el plan de
  // control de calidad de la planta productora (modo PRESTACIONAL). Para
  // auditorías externas o licitaciones que requieran verificación normativa
  // estricta, el caller pide modo PRESCRIPTIVO y el documento estampa
  // banner amber destacado.
  // M11 (auditoría 01-calidad): el body de los banners se wrappea con
  // `splitTextToSize` y el rectángulo se dimensiona en función de las líneas
  // resultantes. Antes el texto largo del banner PRESCRIPTIVO (≈ 250 chars)
  // podía desbordar el margen lateral o pisarse contra el borde inferior del
  // rect en páginas angostas / fuentes con anchos distintos.
  // Banner del certificado (decisión 2026-05-28): siempre NORMATIVO.
  // No hay rama descriptiva — un certificado descriptivo es contradictio
  // in terminis. Patrón con wrap dinámico (lección PR1).
  const _bannerBodyMaxW = contentW - 6;
  const _bannerLineH = 3;
  {
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    const bodyTxt = tx('Verificación contra la matriz CIRSOC 200:2024 + serie IRAM completa, sin filtros del plan de control de calidad de la planta productora. Documento formal de cumplimiento para auditorías externas, licitaciones y contraste técnico.');
    const bodyLines = doc.splitTextToSize(bodyTxt, _bannerBodyMaxW);
    const rectH = 6 + bodyLines.length * _bannerLineH;
    doc.setFillColor(255, 243, 205);
    doc.setDrawColor(220, 170, 50);
    doc.rect(margin, y, contentW, rectH, 'FD');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(133, 100, 4);
    doc.text(tx('CERTIFICADO DE CUMPLIMIENTO NORMATIVO'), margin + 3, y + 4);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(bodyLines, margin + 3, y + 8);
    y += rectH + 3;
    doc.setTextColor(...C.text);
  }

  // ── Banner de detección de datos de prueba (P2.14) ──
  if (deteccionPrueba.esProbablementePrueba) {
    const [r, g, b] = watermarkColor(deteccionPrueba);
    const bannerH = 9 + Math.min(deteccionPrueba.motivos.length, 3) * 3;
    doc.setFillColor(r, g, b);
    doc.setGState(new doc.GState({ opacity: 0.12 }));
    doc.rect(margin, y, contentW, bannerH, 'F');
    doc.setGState(new doc.GState({ opacity: 1 }));
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(r, g, b);
    doc.text(tx(`⚠ ${watermarkText(deteccionPrueba)}`), margin + 3, y + 4.5);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(80, 80, 80);
    let yMot = y + 7.5;
    for (const m of deteccionPrueba.motivos.slice(0, 3)) {
      doc.text(tx(`• ${m.campo}: "${m.valor}" — ${m.motivo}`), margin + 5, yMot);
      yMot += 2.8;
    }
    y += bannerH + 3;
    doc.setTextColor(...C.text);
  }

  // ── Divider ──
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // ── Material identification ──
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.text);
  doc.text('Material evaluado', margin, y); y += 6;

  const matRows = [
    ['Denominación', material.nombre || '—'],
    ['Tipo', material.tipo || '—'],
  ];
  if (material.subtipo) matRows.push(['Subtipo', formatSubtipoAgregado(material.subtipo)]);
  if (material.productor) matRows.push(['Productor / Proveedor', material.productor]);
  if (material.cantera) matRows.push(['Cantera / Yacimiento', material.cantera]);
  if (planta) matRows.push(['Planta', planta]);

  doc.autoTable({
    startY: y, body: matRows, theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2, textColor: C.text },
    columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } },
    margin: { left: margin, right: margin },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ── Contexto de uso evaluado (P1.5) ──
  // El cumplimiento del material depende del destino: con desgaste superficial
  // se aplican límites estrictos; sin desgaste, los estándar. Sin contexto
  // explícito, el documento usa criterios estándar y lo deja constar.
  const tieneDestino = destinoUso && (
    destinoUso.expuestoDesgaste != null
    || destinoUso.claseExposicion
    || destinoUso.fceMpa != null
  );
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.text);
  doc.text('Contexto de uso evaluado', margin, y); y += 6;
  if (tieneDestino) {
    const destRows = [];
    if (destinoUso.expuestoDesgaste != null) {
      destRows.push(['Desgaste superficial', destinoUso.expuestoDesgaste ? 'Sí (criterios estrictos)' : 'No (criterios estándar)']);
    }
    if (destinoUso.claseExposicion) {
      destRows.push(['Clase de exposición', String(destinoUso.claseExposicion)]);
    }
    if (destinoUso.fceMpa != null) {
      destRows.push(['Resistencia característica máx.', `H${Math.round(Number(destinoUso.fceMpa))} (${fmtNum(destinoUso.fceMpa, 0)} MPa)`]);
    }
    doc.autoTable({
      startY: y, body: destRows, theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2, textColor: C.text },
      columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' } },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 6;
  } else {
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    const txt = 'Sin contexto de destino especificado. Se aplicaron criterios estándar de IRAM 1512/1531. Para uso con desgaste superficial, exposición química o resistencias H≥35, verificar adicionalmente los requisitos correspondientes.';
    const lines = doc.splitTextToSize(tx(txt), contentW - 4);
    doc.text(lines, margin, y);
    y += lines.length * 3.5 + 4;
  }

  // ── Ensayos evaluados ──
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.text);
  doc.text('Ensayos evaluados', margin, y); y += 5;

  const ensHead = [['Ensayo', 'Norma', 'Resultado', 'Especificación', 'Estado']];
  const ensBody = ensayos.map(e => {
    // El resultado puede venir como string ya formateado (densidad, peso unitario,
    // granulometría, etc — ver resultadoDisplay.js) o como número crudo (legacy).
    let resultadoCelda;
    if (e.resultado == null || e.resultado === '') {
      resultadoCelda = '—';
    } else if (typeof e.resultado === 'string') {
      resultadoCelda = e.unidad ? `${e.resultado} ${e.unidad}` : e.resultado;
    } else {
      // Número crudo (compat): formatear con la precisión por unidad
      const fmt = fmtNum(e.resultado, e.unidad === '%' ? 3 : 2);
      resultadoCelda = e.unidad ? `${fmt} ${e.unidad}` : fmt;
    }
    return [
      tx(e.nombre),
      tx(e.norma || ''),
      tx(resultadoCelda),
      tx(e.especificacion || ''),
      // Categoría canónica del estado del ensayo (Prompt 3 C9.2). Orden de
      // preferencia del helper: compliance (rich) > cumple boolean > EVAL INCOMPLETA.
      // Usa labels canónicos (APTO / NO APTO / APTO CON OBSERVACIONES /
      // APTITUD CONDICIONADA / EVALUACIÓN INCOMPLETA / INFORMATIVO / NO APLICA),
      // no el ENUM legacy CUMPLE/NO CUMPLE/CUMPLE CONDICIONAL.
      tx(getCategoriaPdfLabel(e.compliance || e.cumple)),
    ];
  });

  doc.autoTable({
    startY: y, head: ensHead, body: ensBody, theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2 },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 7 },
    // Reserva margen inferior para que la tabla no corra hasta el borde de
    // la página: el frame decorativo cierra a `pageH - 16` y el footer ocupa
    // ~10mm; con bottom: 25 garantizamos que las filas que sigan van a la
    // página siguiente en lugar de pisarse con el footer.
    margin: { left: margin, right: margin, bottom: 25 },
    columnStyles: { 4: { halign: 'center', fontStyle: 'bold' } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        // El value de la celda ya es una categoría VEREDICTO canónica (set en
        // ensBody arriba). El helper devuelve la tupla RGB equivalente al
        // CATEGORIA_COLORS.hex del módulo web, asegurando paridad visual.
        data.cell.styles.textColor = getCategoriaPdfColor(String(data.cell.raw));
      }
    },
  });
  y = doc.lastAutoTable.finalY + 8;

  // ── Dictamen — el wording depende del tipo de documento Y la categoría canónica ──
  // Prompt 3 C9.2: el color y texto del banner derivan de la categoría visual
  // canónica (5 categorías relevantes en certificado/informe; INFORMATIVO y
  // NO APLICA no aplican como veredicto global de un material).
  let dictColor;
  let dictText;
  if (isInforme) {
    // Informe de Evaluación: NUNCA afirma cumplimiento. Indica el veredicto
    // técnico canónico sin claim formal, y deja claro que el documento NO es
    // un certificado. Color naranja independiente de la categoría (señaliza
    // "esto NO es certificación").
    dictColor = [217, 119, 6];
    const labelCanonico = veredictoPresentation.label;
    dictText = `Resultado de la evaluación: ${labelCanonico}. Este documento NO constituye un Certificado de Cumplimiento.`;
  } else {
    // CERTIFICADO. La policy ya bloqueó NO APTO y EVALUACIÓN INCOMPLETA
    // antes de llegar acá; las 3 categorías que pueden aparecer son APTO,
    // APTO CON OBSERVACIONES y APTITUD CONDICIONADA.
    dictColor = veredictoPresentation.color;
    switch (veredictoPresentation.categoria) {
      case VEREDICTO.APTO:
        dictText = 'El material evaluado CUMPLE con los requisitos normativos aplicables.';
        break;
      case VEREDICTO.APTO_CON_OBSERVACIONES:
        dictText = 'El material evaluado CUMPLE con los requisitos normativos aplicables. Se registran observaciones técnicas en el cuerpo del informe.';
        break;
      case VEREDICTO.APTITUD_CONDICIONADA:
        dictText = 'El material es APTO sujeto a las condiciones de aplicabilidad indicadas en este informe. Su uso fuera de las condiciones declaradas no está respaldado por esta evaluación.';
        break;
      default:
        // Defensivo: si alguien llamó este renderer salteándose la policy,
        // emitir el banner de error explícito en lugar de un certificado mudo.
        dictColor = C.danger;
        dictText = 'ERROR: certificado emitido sin un veredicto canónico válido. Revisar policy de emisión.';
    }
  }

  // Calcular altura del banner ANTES de dibujar para poder hacer page-break guard.
  doc.setFont('Helvetica', 'bold');
  doc.setFontSize(11);
  const dictLines = doc.splitTextToSize(tx(dictText), contentW - 8);
  const dictH = Math.max(12, dictLines.length * 5 + 4);

  // Page-break guard: si el banner no entra completo + margen inferior razonable
  // (footer en pageH - 6 + disclaimer + reserva), saltar a la página siguiente.
  // Sin este guard el banner se metía al borde inferior pisando el footer.
  if (y + dictH + 6 > pageH - 20) {
    doc.addPage();
    y = 22;
  }

  doc.setFillColor(...dictColor);
  doc.roundedRect(margin, y, contentW, dictH, 2, 2, 'F');
  doc.setTextColor(...C.white);
  doc.text(dictLines, pageW / 2, y + (dictH / 2) - ((dictLines.length - 1) * 2.5) + 1, { align: 'center', baseline: 'middle' });
  y += dictH + 4;

  // ── Razones de no cumplimiento (solo en INFORME_EVALUACION) ──
  if (isInforme && razonesNoCumple.length > 0) {
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    doc.text(tx('Motivos de la no certificación:'), margin, y);
    y += 5;
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.text);
    razonesNoCumple.forEach((razon) => {
      const lines = doc.splitTextToSize(tx(`• ${razon}`), contentW - 4);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4;
    });
    y += 2;
  }

  // ── Detalle granulométrico por tamiz (P1.3) ──
  // El motivo "N tamices fuera de banda" no alcanza para auditoría: aquí
  // listamos cada tamiz con valor medido, límites y desvío en pp.
  if (isInforme && granulometriaDetalle.length > 0) {
    granulometriaDetalle.forEach((g) => {
      const fuera = g.fueraDeBanda || [];
      if (!fuera.length) return;
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...C.text);
      const titulo = g.banda
        ? `Tamices fuera de banda — ${g.ensayoNombre} (banda ${g.banda})`
        : `Tamices fuera de banda — ${g.ensayoNombre}`;
      doc.text(tx(titulo), margin, y);
      y += 4;
      const head = [['Tamiz', 'Medido (%)', 'Mín (%)', 'Máx (%)', 'Desvío (pp)']];
      // P1.10: desvio es signed (− por debajo del mín, + por encima del máx).
      const fmtDesv = (v) => {
        if (v == null) return '—';
        const n = Number(v);
        const s = fmtNum(Math.abs(n), 1);
        return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
      };
      const body = fuera.map((f) => [
        tx(f.tamiz || (f.aberturaMm != null ? `${fmtNum(f.aberturaMm, 2)} mm` : '—')),
        f.medido != null ? fmtNum(f.medido, 1) : '—',
        f.min != null ? fmtNum(f.min, 1) : '—',
        f.max != null ? fmtNum(f.max, 1) : '—',
        fmtDesv(f.desvio),
      ]);
      doc.autoTable({
        startY: y, head, body, theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.5, textColor: C.text, lineColor: [200, 200, 200], lineWidth: 0.2 },
        headStyles: { fillColor: [217, 119, 6], textColor: C.white, fontStyle: 'bold', fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 32 },
          1: { halign: 'right' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold', textColor: C.danger },
        },
        margin: { left: margin, right: margin },
      });
      y = doc.lastAutoTable.finalY + 4;
    });
  }

  // ── Notas / condiciones de aplicabilidad (en CERTIFICADO con condicionales) ──
  if (!isInforme && notasCondicionales.length > 0) {
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(217, 119, 6);
    doc.text(tx('Condiciones de aplicabilidad:'), margin, y);
    y += 5;
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.text);
    notasCondicionales.forEach((nota) => {
      const lines = doc.splitTextToSize(tx(`• ${nota}`), contentW - 4);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4;
    });
    y += 2;
  }

  // ── K.4 — Banner de override CIRSOC §3.2.3.2 f) ──
  // Cuando hay un override activo firmado, el documento debe declararlo
  // explícitamente con banner visible + bloque de firma del responsable.
  if (overrideActivo) {
    y += 2;
    const bannerH = 18;
    doc.setFillColor(254, 243, 199); // amarillo suave
    doc.setDrawColor(217, 119, 6);
    doc.setLineWidth(0.4);
    doc.rect(margin, y, contentW, bannerH, 'FD');
    doc.setFont('Helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(146, 64, 14);
    doc.text(tx('Liberación bajo CIRSOC 200:2024 §3.2.3.2 f)'), margin + 3, y + 4.5);
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.text);
    const ambitoLabel = overrideActivo.ambito === 'OBRA'
      ? 'Ámbito: obra (firma de Director Técnico matriculado)'
      : 'Ámbito: autocontrol de planta (firma de Responsable de Calidad)';
    doc.text(tx(ambitoLabel), margin + 3, y + 9);
    const motivoLines = doc.splitTextToSize(
      tx(`Motivo: ${overrideActivo.motivo || 'sin motivo declarado'}`),
      contentW - 6,
    );
    doc.text(motivoLines.slice(0, 2), margin + 3, y + 13);
    y += bannerH + 3;
  }

  // ── Validez (solo CERTIFICADO; el INFORME no establece validez normativa) ──
  if (!isInforme && validezHasta) {
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    doc.text(tx(`Válido hasta: ${fmtDate(validezHasta)}`), margin, y);
    y += 5;
  }
  doc.setFont('Helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.text);
  doc.text(tx(`Fecha de emisión: ${fmtDate(new Date())}`), margin, y);
  y += 5;
  // P2.10 — datos completos del emisor (razón social + CUIT + dirección + contacto)
  if (empresa) {
    const cuitTxt = cuitEmpresa ? ` · CUIT ${cuitEmpresa}` : '';
    doc.text(tx(`Emitido por: ${empresa}${cuitTxt}`), margin, y);
    y += 5;
  }
  if (direccionEmpresa) {
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(tx(`Domicilio: ${direccionEmpresa}`), margin, y);
    y += 4;
    if (planta) { doc.text(tx(`Planta: ${planta}`), margin, y); y += 4; }
    if (emailEmpresa) { doc.text(tx(`Contacto: ${emailEmpresa}`), margin, y); y += 4; }
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
  }

  // ── Observaciones ──
  if (observaciones) {
    y += 3;
    doc.setFont('Helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    const lines = doc.splitTextToSize(tx(observaciones), contentW);
    doc.text(lines, margin, y);
    y += lines.length * 3.5;
  }

  // ── Firmas ──
  // K.4 — si hay override, agregamos tercer bloque para el resolutor.
  y = Math.max(y + 15, pageH - (overrideActivo ? 60 : 48));
  doc.setDrawColor(...C.muted); doc.setLineWidth(0.3);
  doc.line(margin + 5, y, margin + 65, y);
  doc.line(pageW - margin - 65, y, pageW - margin - 5, y);
  doc.setFont('Helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.muted);
  doc.text('Laboratorista', margin + 35, y + 4, { align: 'center' });
  doc.text(tx(responsable || 'Responsable de calidad'), pageW - margin - 35, y + 4, { align: 'center' });

  if (overrideActivo) {
    const yOv = y + 14;
    const xCenter = pageW / 2;
    doc.setDrawColor(217, 119, 6); doc.setLineWidth(0.3);
    doc.line(xCenter - 30, yOv, xCenter + 30, yOv);
    doc.setFont('Helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(146, 64, 14);
    doc.text(tx(overrideActivo.resueltoPor || 'Responsable técnico'), xCenter, yOv + 3.5, { align: 'center' });
    doc.setFont('Helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(...C.muted);
    const rolLabel = overrideActivo.ambito === 'OBRA' ? 'Director Técnico' : 'Responsable de Calidad';
    const matriculaStr = overrideActivo.matriculaResolutor ? ` · Mat. ${overrideActivo.matriculaResolutor}` : '';
    doc.text(tx(`${rolLabel}${matriculaStr}`), xCenter, yOv + 6.5, { align: 'center' });
    doc.text(tx('Firma bajo CIRSOC §3.2.3.2 f)'), xCenter, yOv + 9.5, { align: 'center' });
  }

  // ── Disclaimer (cambia según tipo) ──
  y += 12;
  doc.setFont('Helvetica', 'italic'); doc.setFontSize(5.5); doc.setTextColor(...C.muted);
  if (isInforme) {
    doc.text(tx('Este Informe de Evaluación ha sido emitido automáticamente por el sistema HormiQual. Los resultados corresponden a los ensayos cargados al momento de la emisión.'), pageW / 2, y, { align: 'center' });
    doc.text(tx('Este documento NO constituye un Certificado de Cumplimiento. Para certificación, deben subsanarse los motivos indicados arriba.'), pageW / 2, y + 3, { align: 'center' });
  } else {
    doc.text(tx('Este certificado ha sido emitido automáticamente por el sistema HormiQual. Los resultados corresponden a ensayos realizados según las normas indicadas.'), pageW / 2, y, { align: 'center' });
    doc.text(tx('La reproducción parcial de este documento no tiene validez. Validez sujeta a la vigencia de los ensayos de referencia.'), pageW / 2, y + 3, { align: 'center' });
  }

  // P2.12 — paginación + watermark de ambiente en cada hoja.
  const totalPaginas = doc.internal.getNumberOfPages();
  const envTag = getEnvironmentTag();
  const envWmText = environmentWatermarkText(envTag);
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);

    // ── Border frame (P3 fix) ── dibujado en cada página, no solo en la primera.
    // Altura ajustada para no pisar el footer en pageH-6: el frame outer cierra
    // en pageH-16 (8mm de margen libre debajo).
    doc.setDrawColor(...C.primary);
    doc.setLineWidth(1.5);
    doc.rect(8, 8, pageW - 16, pageH - 24);
    doc.setLineWidth(0.5);
    doc.rect(10, 10, pageW - 20, pageH - 28);

    // Watermark de ambiente dev/staging (todas las páginas)
    if (envWmText) {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.10 }));
      doc.setFont('Helvetica', 'bold');
      doc.setFontSize(32);
      doc.setTextColor(150, 90, 30); // naranja oscuro suave
      doc.text(envWmText, pageW / 2, pageH / 2 + 30, {
        align: 'center',
        angle: -20,
        baseline: 'middle',
      });
      doc.restoreGraphicsState();
    }

    // Paginación "Página X de Y"
    doc.setFont('Helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(
      tx(`Página ${i} de ${totalPaginas}`),
      pageW - margin,
      pageH - 6,
      { align: 'right' }
    );
    if (nroCertificado) {
      doc.text(tx(`Nº ${nroCertificado}`), margin, pageH - 6);
    }
  }

  // Nombre de archivo según tipo
  const prefijo = isInforme ? 'informe_evaluacion' : 'certificado';
  const fn = `${prefijo}_${(material.nombre || 'material').replace(/[^a-zA-Z0-9]/g, '_')}_${nroCertificado || fmtDate(new Date()).replace(/\//g, '')}.pdf`;
  doc.save(fn);
}
