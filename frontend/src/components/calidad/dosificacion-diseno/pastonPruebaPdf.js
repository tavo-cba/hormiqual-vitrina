import jsPDF from "jspdf";
import "jspdf-autotable";

const C = {
  primary: [18, 52, 86],
  secondary: [66, 81, 99],
  text: [31, 41, 55],
  muted: [107, 114, 128],
  white: [255, 255, 255],
  light: [245, 247, 250],
  green: [21, 128, 61],
  red: [220, 38, 38],
  amber: [217, 119, 6],
};

const fmtNum = (v, dec = 1) =>
  v != null
    ? Number(v).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec })
    : "—";

/**
 * Sanitiza strings para jsPDF default (Helvetica, Latin-1). Reemplaza dashes
 * Unicode y comparadores ≤/≥, y descompone diacríticos al carácter base si
 * la fuente no los soporta. Sin esto, caracteres > U+00FF se renderizan como
 * cuadrados.
 */
function tx(str) {
  if (str == null) return "";
  return String(str)
    .replace(/³/g, "3")
    .replace(/–/g, "-")
    .replace(/—/g, " - ")
    .replace(/−/g, "-")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[Ā-￿]/g, (ch) => {
      const nfd = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      return nfd.length ? nfd : "?";
    });
}

const METODO_PDF_LABELS = {
  asentamiento: "Asentamiento medido",
  remoldeo: "Remoldeo VeBe medido",
  extendido: "Extendido medido",
};
const METODO_PDF_UNITS = {
  asentamiento: "cm",
  remoldeo: "s",
  extendido: "cm",
};

/**
 * Fetches the tenant logo as base64 so jsPDF can embed it. Devuelve `null` si
 * la URL es vacía o falla la red — el header sigue funcionando sin logo.
 */
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

/**
 * Generate a PDF ficha for a pastón de prueba.
 * @param {Object} paston - Saved pastón record (or current form state)
 * @param {Object} options - { dosifNombre, empresa, logoUrl, mediciones, ajustes, modoEvaluacion }
 *   modoEvaluacion: PR9.3 — 'PRESCRIPTIVO' | 'PRESTACIONAL'. Default
 *   PRESTACIONAL: el plan de control de calidad de la planta es soberano.
 *   logoUrl: thumbnail del tenant (cfg.thumbnail) para el encabezado azul.
 */
export async function generarPastonPruebaPdf(paston, options = {}) {
  const {
    dosifNombre, empresa, logoUrl, aditivosMeta = [], muestrasPaston = [],
    // B1 (sugerencia DeepSeek, validada por revisor-civil): límites de a/c
    // para alertar (NO bloquear) cuando la a/c efectiva final los supera.
    // `acMaxPliego` = techo contractual; `acMaxDurabilidad` = Tabla 2.5
    // CIRSOC 200:2024 según clase de exposición.
    acMaxPliego = null, acMaxDurabilidad = null, claseExposicion = null,
    modoEvaluacion = 'DESCRIPTIVO',
  } = options;
  const logoData = await fetchLogoBase64(logoUrl);
  // Decisión 2026-05-28: default DESCRIPTIVO. Acepta aliases viejos
  // PRESTACIONAL/PRESCRIPTIVO (back-compat). El veredicto experimental
  // del pastón (APROBADO/RECHAZADO/OBSERVADO, decisión D26 lock-in) NO
  // se ve afectado por el modo — es vocabulario propio del flow.
  const _modoUpper = String(modoEvaluacion).toUpperCase();
  const _modoNorm = (_modoUpper === 'NORMATIVO' || _modoUpper === 'PRESCRIPTIVO')
    ? 'NORMATIVO'
    : 'DESCRIPTIVO';
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  let y = margin;

  /* ── Pre-parse datos que determinan qué secciones existen ── */
  const planif = paston.ensayosPlanificados;
  const hasPlanif = planif && ((planif.probetas?.length || 0) + (planif.ensayos_fresco?.length || 0)) > 0;

  let comps = paston.componentes;
  if (typeof comps === "string") { try { comps = JSON.parse(comps); } catch { comps = []; } }
  if (!Array.isArray(comps)) comps = [];

  const mediciones = Array.isArray(options.mediciones) ? options.mediciones : [];
  const ajustes = Array.isArray(options.ajustes) ? options.ajustes : [];
  const ajustesDelPaston = ajustes.filter(a => a.pastonRefId === paston.idPastonPrueba);
  // `muestrasPaston` ya viene destructurado de options (default []).
  // Cada item tiene `probetas[]` con datos de identificación, edad, estado y
  // posible ensayo de resistencia. Se usa para la sección "Probetas moldeadas".
  const tieneProbetasReales = muestrasPaston.some(m => Array.isArray(m.probetas) && m.probetas.length > 0);

  /* ── Cálculo de aporte neto de humedad (audit test53) ──
   *
   * La corrección por humedad de los agregados es transversal: aparece en
   * la sección "Trazabilidad" y se necesita en "Balance" para que el agua
   * "Cargada" (caudalímetro) sea consistente con el agua corregida que se
   * declara en Trazabilidad. Lo computamos UNA vez acá, lo usan ambas
   * secciones. `deltaAguaPorHumedadL` positivo = agregados aportan agua
   * (caudalímetro carga MENOS); negativo = agregados secos absorben.
   */
  const humedadesParsed = (() => {
    let h = paston.humedadAgregadosJson;
    if (typeof h === "string") { try { h = JSON.parse(h); } catch { h = []; } }
    return Array.isArray(h) ? h : [];
  })();
  const aguaDosifCompTop = comps.find(c => c.tipo === "AGUA");
  let deltaAguaPorHumedadL = 0;
  if (paston.correccionHumedad && humedadesParsed.length > 0) {
    const agregadosCompsTop = comps.filter(c => c.tipo === "AGREGADO");
    for (const h of humedadesParsed) {
      const humedad = Number(h.humedadPct);
      const absorcion = Number(h.absorcionPct);
      if (!Number.isFinite(humedad) && !Number.isFinite(absorcion)) continue;
      const match = agregadosCompsTop.find(c =>
        (h.idAgregado && c.idAgregado === h.idAgregado) ||
        (h.nombre && (c.componente || "").trim().toLowerCase() === (h.nombre || "").trim().toLowerCase())
      );
      if (!match) continue;
      const libre = (Number.isFinite(humedad) ? humedad : 0) - (Number.isFinite(absorcion) ? absorcion : 0);
      deltaAguaPorHumedadL += (Number(match.cantidadScaled || 0) * libre) / 100;
    }
  }
  const aguaTeoricaTop = aguaDosifCompTop ? Number(aguaDosifCompTop.cantidadScaled || 0) : 0;
  const aguaCorregidaACargar = aguaTeoricaTop - deltaAguaPorHumedadL;

  /* ── Contar secciones para reservar espacio del índice ── */
  // Always-on: Datos generales + Componentes. El resto es condicional.
  let sectionCount = 2;
  if (hasPlanif) sectionCount++;
  if (paston.observaciones) sectionCount++;
  if (paston.veredicto) sectionCount++;
  if (mediciones.length > 0) sectionCount++; // mediciones seriadas
  // Sección "Datos del pastón fresco": aparece si hay cualquier valor base
  // cargado (asentamiento, T°, PUV, aire o aspecto). Cuando existen mediciones,
  // el backend mirrora Medición #1 → campos legacy del pastón, así que estos
  // campos representan la base del timeline.
  const hayDatoFrescoPrecheck = paston.asentamientoMedido != null
    || paston.temperaturaHormigon != null
    || paston.temperaturaAmbiente != null
    || paston.puvMedido != null
    || paston.aireMedido != null
    || (paston.aspecto != null && paston.aspecto !== "");
  if (hayDatoFrescoPrecheck) sectionCount++;
  if (tieneProbetasReales || (mediciones.length === 0 && paston.probetasMoldeadas != null) || paston.identificacionProbetas) sectionCount++;
  // Trazabilidad humedad
  {
    let h = paston.humedadAgregadosJson;
    if (typeof h === "string") { try { h = JSON.parse(h); } catch { h = []; } }
    if (paston.correccionHumedad && Array.isArray(h) && h.length > 0) sectionCount++;
  }
  // Análisis del efecto del aditivo: sólo si hay ≥2 mediciones con asentamiento + aditivos agregados
  const tieneAnalisisAditivo = mediciones.length >= 2 && mediciones.some(m => {
    if (Number(m.aguaAgregadaLts) > 0) return true;
    let a = m.aditivosAgregadosJson;
    if (typeof a === "string") { try { a = JSON.parse(a); } catch { a = null; } }
    return Array.isArray(a) && a.some(x => Number(x.cantidad) > 0);
  });
  if (tieneAnalisisAditivo) sectionCount++;
  // Balance de materiales: aparece si hay ajustes con materiales, retenidos
  // legacy en componentes, o retenidos declarados en la Medición #1 del
  // timeline (campos JSON aguaRetenidaLts / aditivosRetenidosJson / fibrasRetenidasJson).
  const hayRetenidosPrecheck = comps.some(c => Number(c.retenido || 0) > 0)
    || mediciones.some(m => {
      if (Number(m.aguaRetenidaLts) > 0) return true;
      let a = m.aditivosRetenidosJson;
      if (typeof a === "string") { try { a = JSON.parse(a); } catch { a = null; } }
      if (Array.isArray(a) && a.some(x => Number(x.cantidad) > 0)) return true;
      let f = m.fibrasRetenidasJson;
      if (typeof f === "string") { try { f = JSON.parse(f); } catch { f = null; } }
      return Array.isArray(f) && f.some(x => Number(x.cantidad) > 0);
    });
  const hayAgregadosPrecheck = ajustesDelPaston.length > 0 || mediciones.some(m => {
    if (m.aguaAgregadaLts != null && Number(m.aguaAgregadaLts) > 0) return true;
    if (m.aditivoAgregadoNombre && m.aditivoAgregadoCantidad != null) return true;
    let a = m.aditivosAgregadosJson;
    if (typeof a === "string") { try { a = JSON.parse(a); } catch { a = null; } }
    return Array.isArray(a) && a.some(x => Number(x.cantidad) > 0);
  });
  if (hayAgregadosPrecheck || hayRetenidosPrecheck) sectionCount++;
  if (ajustesDelPaston.length > 0) sectionCount++;

  /* ── Índice dinámico: tracking ── */
  const tocEntries = [];
  let sectionNum = 0;

  const checkBreak = (needed) => {
    if (y + needed > pageH - 20) { doc.addPage(); y = margin; }
  };

  /** Renderiza un encabezado de sección con barra coloreada.
   *
   * `minNextContent` (opcional, mm) — espacio mínimo de contenido que la
   * sección espera dibujar inmediatamente después del banner. Si no entra en
   * lo que queda de la página, se hace addPage primero — evita el "banner
   * huérfano" al pie de página con la tabla recién en la siguiente. Las
   * secciones grandes (Balance, Análisis, Mediciones) lo declaran. */
  const sectionHead = (title, minNextContent = 0) => {
    checkBreak(18 + minNextContent);
    sectionNum++;
    tocEntries.push({ num: sectionNum, title, page: doc.internal.getNumberOfPages() });
    doc.setFillColor(...C.primary);
    doc.roundedRect(margin, y, contentW, 7.5, 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...C.white);
    doc.text(`${sectionNum}. ${title}`, margin + 3, y + 5.2);
    y += 10.5;
  };

  /* ═══════════════════════════════════════
     Header
     ═══════════════════════════════════════ */
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, pageW, 32, "F");
  if (logoData) {
    try { doc.addImage(logoData, "PNG", margin, 4, 24, 24); } catch { /* fallback sin logo */ }
  }
  const titleX = logoData ? margin + 28 : margin;
  doc.setTextColor(...C.white);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text("Ficha de Pastón de Prueba", titleX, 13);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const subLines = [];
  if (empresa) subLines.push(empresa);
  if (dosifNombre) subLines.push(`Dosificación: ${dosifNombre}`);
  subLines.forEach((l, i) => doc.text(tx(l), titleX, 20 + i * 5));

  const dateStr = paston.fecha || new Date().toISOString().slice(0, 10);
  doc.text(dateStr, pageW - margin, 13, { align: "right" });
  if (paston.hora) {
    // Fix auditor-pdf 2026-05-28 (test87/88/89): pastones viejos guardados
    // antes del fix de `toHHMM` traen `paston.hora` como "07:30 a. m."
    // (formato de `toLocaleTimeString('es-AR')` que MySQL TIME rechaza y
    // que se ve feo en el PDF). El render del PDF defensivamente extrae
    // HH:mm del prefijo del string para evitar mostrar el sufijo "a. m./p. m."
    const m = String(paston.hora).match(/^(\d{1,2}):(\d{2})/);
    const horaDisplay = m ? `${m[1].padStart(2, "0")}:${m[2]}` : paston.hora;
    doc.text(`Hora: ${horaDisplay}`, pageW - margin, 19, { align: "right" });
  }
  if (paston.operador) {
    doc.setFontSize(8);
    doc.text(`Operador: ${paston.operador}`, pageW - margin, 25, { align: "right" });
  }
  y = 38;

  /* ═══════════════════════════════════════
     Banner del modo del documento (decisión 2026-05-28).
     Patrón con wrap dinámico (lección PR1). El veredicto experimental
     del pastón (APROBADO/RECHAZADO/OBSERVADO) NO depende del modo —
     es vocabulario propio del flow experimental.
     ═══════════════════════════════════════ */
  {
    const bannerInnerPad = 3;
    const bannerInnerW = contentW - 2 * bannerInnerPad;
    const titleH = 3.5;
    const lineH = 3.4;
    const padBottom = 1.5;
    let titleText, descText, fillRGB, strokeRGB, textRGB;
    if (_modoNorm === 'NORMATIVO') {
      titleText = 'PASTON DE PRUEBA - MODO NORMATIVO';
      descText = 'Pruebas experimentales evaluadas contra CIRSOC 200:2024 + serie IRAM. El veredicto del pastón (APROBADO / RECHAZADO / OBSERVADO) refleja la decisión técnica del laboratorio sobre el resultado experimental, no un veredicto normativo automático.';
      fillRGB = [255, 243, 205];
      strokeRGB = [220, 170, 50];
      textRGB = [133, 100, 4];
    } else {
      titleText = 'PASTON DE PRUEBA - REGISTRO DESCRIPTIVO';
      descText = 'Documento descriptivo. Lista los resultados experimentales del pastón (mediciones, asentamiento, resistencias, retención) sin emitir valoración normativa adicional. El veredicto del pastón (APROBADO / RECHAZADO / OBSERVADO) refleja la decisión técnica del laboratorio sobre el resultado experimental.';
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

  /* ═══════════════════════════════════════
     Aviso prospectivo del modo NORMATIVO sobre pastón planificado.
     Decisión 2026-05-28 (audit test90/test91): cuando el pastón no
     tiene mediciones cargadas aún, el modo normativo no puede emitir
     veredictos. En lugar de mostrar un cuerpo idéntico al descriptivo
     (auditor lo flagueaba como señal de modo desincronizada), declaramos
     prospectivamente qué se evaluará cuando lleguen los datos.
     ═══════════════════════════════════════ */
  if (_modoNorm === 'NORMATIVO' && mediciones.length === 0) {
    const noteText = 'Pastón en estado planificado (sin mediciones cargadas aún). Cuando se carguen los resultados experimentales, este documento en modo Normativo activará las siguientes verificaciones: (1) f\'c real >= f\'cm objetivo (CIRSOC 200:2024 §6.2.3); (2) asentamiento medido dentro de tolerancia del de diseño (IRAM 1666 §A.7); (3) volumen del pastón >= mínimo IRAM 1541 (factor 1,40 sobre vol. ensayos); (4) a/c efectivo respetando Tabla 2.5 CIRSOC para la clase de exposición declarada. Mientras tanto, este documento lista los datos planificados sin emitir veredicto.';
    const noteInnerPad = 3;
    const noteInnerW = contentW - 2 * noteInnerPad;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    const noteLines = doc.splitTextToSize(noteText, noteInnerW);
    const noteLineH = 3.4;
    const noteH = 2 + noteLines.length * noteLineH + 1.5;
    doc.setFillColor(252, 250, 240);
    doc.setDrawColor(220, 200, 150);
    doc.rect(margin, y, contentW, noteH, 'FD');
    doc.setTextColor(120, 90, 30);
    doc.text(noteLines, margin + noteInnerPad, y + 4);
    y += noteH + 2;
    doc.setTextColor(...C.text);
  }

  /* ═══════════════════════════════════════
     Reservar espacio para el índice
     ═══════════════════════════════════════ */
  const tocPage = 1;
  const tocStartY = y;
  // Separador (4mm) + título "Contenido" (5mm) + entradas (4.5mm c/u) + colchón
  // inferior (5mm). Audit test52 mostró que las últimas entradas del TOC
  // perdían sus page labels cuando el reservado quedaba justo en el límite.
  // +1 entrada de margen para casos donde alguna sección condicional surge en
  // runtime sin estar contada (e.g., trazabilidad humedad con datos nuevos).
  const tocReserved = 4 + 5 + (sectionCount + 1) * 4.5 + 5;
  y += tocReserved;

  /* ═══════════════════════════════════════
     1. Datos generales
     ═══════════════════════════════════════ */
  sectionHead("Datos generales");

  const volAdoptado = paston.volumenAdoptadoL || (paston.volumenM3 ? paston.volumenM3 * 1000 : 0);
  const infoRows = [
    ["Volumen adoptado", `${fmtNum(volAdoptado, 0)} L`],
    ...(paston.volumenEnsayosL ? [["Vol. ensayos", `${fmtNum(paston.volumenEnsayosL, 1)} L`]] : []),
    ...(paston.volumenMinimoL ? [["Vol. mínimo IRAM 1541", `${fmtNum(paston.volumenMinimoL, 0)} L (x1,40)`]] : []),
    ["Operador", paston.operador || "—"],
    ["Corrección por humedad", paston.correccionHumedad ? "Sí" : "No"],
  ];
  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    body: infoRows,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
  });
  y = doc.lastAutoTable.finalY + 8;

  /* ═══════════════════════════════════════
     2. Ensayos planificados (condicional)
     ═══════════════════════════════════════ */
  if (hasPlanif) {
    sectionHead("Ensayos planificados");

    const planRows = [];
    if (planif.probetas?.length) {
      planif.probetas.forEach(p => {
        planRows.push([p.nombre || p.tipo, `${p.cantidad} probeta(s)`, ""]);
      });
    }
    if (planif.ensayos_fresco?.length) {
      planif.ensayos_fresco.forEach(e => {
        planRows.push([e.nombre || e.tipo, `${e.cantidad} ensayo(s)`, ""]);
      });
    }
    if (planRows.length > 0) {
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        body: planRows,
        theme: "plain",
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 70 } },
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  /* ═══════════════════════════════════════
     3. Componentes del pastón
     ═══════════════════════════════════════ */
  sectionHead("Componentes del pastón");

  const hayRetenidos = comps.some(c => Number(c.retenido || 0) > 0);
  // Decimales para "Dosif. (kg/m³)" según tipo. Audit test52: con 1 decimal
  // fijo, aditivos de 0,33 kg/m³ se mostraban como 0,3 → el lector hacía
  // dosis × volumen y obtenía un total distinto al de la columna "Cantidad"
  // (que se calcula con precisión completa). Solución: aditivos y fibras a
  // 3 decimales; agua/cemento/agregados/adiciones a 1 decimal.
  const decKgM3 = (tipo, kgM3) => {
    if (tipo === 'ADITIVO' || tipo === 'FIBRA') return 3;
    if (tipo === 'ADICION' && Math.abs(Number(kgM3) || 0) < 10) return 2;
    return 1;
  };
  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: hayRetenidos
      ? [["Componente", "Dosif. (kg/m³)", "Dosificado", "Retenido", "Cargado (real)", "Unidad"]]
      : [["Componente", "Dosif. (kg/m³)", "Cantidad", "Unidad"]],
    body: comps.map((c) => {
      const dosif = Number(c.cantidadScaled || 0);
      const ret = Number(c.retenido || 0);
      const cargado = Number(c.cargado != null ? c.cargado : (dosif - ret));
      const decDosif = decKgM3(c.tipo, c.kgM3);
      const decCant = (v) => (v < 10 ? 2 : (v < 100 ? 1 : 0));
      if (hayRetenidos) {
        return [
          c.componente,
          fmtNum(c.kgM3, decDosif),
          fmtNum(dosif, decCant(dosif)),
          ret > 0 ? fmtNum(ret, decCant(ret)) : "—",
          fmtNum(cargado, decCant(cargado)),
          c.unidad,
        ];
      }
      return [c.componente, fmtNum(c.kgM3, decDosif), fmtNum(dosif, decCant(dosif)), c.unidad];
    }),
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: hayRetenidos ? {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right", textColor: [217, 119, 6] },
      4: { halign: "right", fontStyle: "bold" },
      5: { halign: "center" },
    } : {
      1: { halign: "right" },
      2: { halign: "right", fontStyle: "bold" },
      3: { halign: "center" },
    },
    theme: "grid",
  });
  y = doc.lastAutoTable.finalY + 8;

  /* ═══════════════════════════════════════
     3.bis Trazabilidad de la corrección por humedad (condicional)
     Aparece cuando paston.correccionHumedad=true y existe humedadAgregadosJson.
     Detalla, por agregado: humedad medida, absorción, humedad libre, masa
     seca → húmeda y agua aportada / robada al agua libre.
     ═══════════════════════════════════════ */
  {
    let humedades = paston.humedadAgregadosJson;
    if (typeof humedades === "string") { try { humedades = JSON.parse(humedades); } catch { humedades = []; } }
    if (!Array.isArray(humedades)) humedades = [];
    if (paston.correccionHumedad && humedades.length > 0) {
      sectionHead("Trazabilidad de la corrección por humedad");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      const intro = "Cada agregado puede llegar húmedo (aporta agua a la mezcla) o seco bajo absorción (le roba agua libre al agua de mezcla). La humedad libre = humedad real - absorción; si es positiva, ese porcentaje sobre la masa seca se descuenta del agua dosificada.";
      doc.text(doc.splitTextToSize(intro, contentW), margin, y);
      y += doc.splitTextToSize(intro, contentW).length * 3 + 2;
      doc.setTextColor(...C.text);

      // Cruzar humedades con componentes de tipo AGREGADO para obtener masa seca.
      // Se filtran las filas sin humedad ni absorción cargadas (los agregados que
      // el operador no midió) para no mostrar renglones vacíos en el PDF.
      const agregadosComps = comps.filter(c => c.tipo === "AGREGADO");
      const humRows = [];
      let deltaAguaTotalL = 0;
      for (const h of humedades) {
        const humedad = Number(h.humedadPct);
        const absorcion = Number(h.absorcionPct);
        const tieneDato = Number.isFinite(humedad) || Number.isFinite(absorcion);
        if (!tieneDato) continue;
        const masaSecaKg = (() => {
          const match = agregadosComps.find(c =>
            (h.idAgregado && c.idAgregado === h.idAgregado) ||
            (h.nombre && (c.componente || "").trim().toLowerCase() === (h.nombre || "").trim().toLowerCase())
          );
          return match ? Number(match.cantidadScaled || 0) : null;
        })();
        const hVal = Number.isFinite(humedad) ? humedad : 0;
        const aVal = Number.isFinite(absorcion) ? absorcion : 0;
        const libre = hVal - aVal;
        const aporteL = masaSecaKg != null ? (masaSecaKg * libre) / 100 : null;
        if (aporteL != null) deltaAguaTotalL += aporteL;
        humRows.push([
          h.nombre || "Agregado",
          `${fmtNum(hVal, 2)} %`,
          `${fmtNum(aVal, 2)} %`,
          `${libre > 0 ? "+" : ""}${fmtNum(libre, 2)} %`,
          masaSecaKg != null ? `${fmtNum(masaSecaKg, 1)} kg` : "—",
          aporteL != null ? `${aporteL > 0 ? "+" : ""}${fmtNum(aporteL, 2)} L` : "—",
        ]);
      }
      // Si no quedó ninguna fila válida (e.g., correccionHumedad=true pero
      // ningún agregado tiene humedades cargadas), agregar fila informativa.
      if (humRows.length === 0) {
        humRows.push(["(sin humedades cargadas por agregado)", "—", "—", "—", "—", "—"]);
      }

      // Fix auditor-pdf 2026-05-28 (test87): el encabezado de la 6ª columna
      // "Aporte (+) / Absorción (−)" se cortaba a "Aporte (+) / Abso" porque
      // el ancho `auto` resultante (~36 mm) no alcanzaba para los 24 chars
      // del header a 7.5pt. Redistribuimos: col 0 (Agregado) de 50→46 mm y
      // col 3 (Humedad libre) de 28→22 mm; eso libera 10 mm para el auto.
      // Fix follow-up auditor-pdf 2026-05-28 (test102): el `head` de
      // autoTable NO pasa por `tx()`; jsPDF Helvetica WinAnsi degrada U+2212
      // ("−") a comilla doble `"`. Usamos guion ASCII en el string fuente.
      doc.autoTable({
        startY: y,
        head: [["Agregado", "Humedad", "Absorción", "Humedad libre", "Masa seca", "Aporte (+) / Absorción (-)"]],
        body: humRows,
        margin: { left: margin, right: margin },
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 1.5 },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
        columnStyles: {
          0: { cellWidth: 46, fontStyle: "bold" },
          1: { halign: "right", cellWidth: 22 },
          2: { halign: "right", cellWidth: 22 },
          3: { halign: "right", cellWidth: 22 },
          4: { halign: "right", cellWidth: 24 },
          5: { halign: "right", cellWidth: "auto", fontStyle: "bold" },
        },
      });
      y = doc.lastAutoTable.finalY + 4;

      // Resumen del impacto neto sobre el agua dosificada
      const aguaDosifComp2 = comps.find(c => c.tipo === "AGUA");
      const aguaTeoricaL = aguaDosifComp2 ? Number(aguaDosifComp2.cantidadScaled || 0) : null;
      const aguaCorregidaL = aguaTeoricaL != null ? aguaTeoricaL - deltaAguaTotalL : null;
      const tono = deltaAguaTotalL > 0 ? [217, 119, 6] : (deltaAguaTotalL < 0 ? [22, 163, 74] : [80, 80, 80]);
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...tono);
      const linea = aguaTeoricaL != null
        ? `Aporte neto de humedad: ${deltaAguaTotalL > 0 ? "+" : ""}${fmtNum(deltaAguaTotalL, 2)} L  |  Agua teórica: ${fmtNum(aguaTeoricaL, 1)} L  ->  Agua corregida a cargar: ${fmtNum(aguaCorregidaL, 1)} L`
        : `Aporte neto de humedad: ${deltaAguaTotalL > 0 ? "+" : ""}${fmtNum(deltaAguaTotalL, 2)} L`;
      doc.text(linea, margin, y + 3);
      doc.setTextColor(...C.text);
      y += 9;
    }
  }

  /* ═══════════════════════════════════════
     4. Datos generales del pastón fresco
     Resumen de valores base del hormigón fresco. Cuando hay timeline cargado,
     los valores vienen mirroreados de Medición #1 (base) hacia los campos
     legacy de PastonPrueba (asentamientoMedido, temperaturaHormigon, etc.) por
     `medicionPastonService._mirrorBaseAPaston`. La evolución por etapa se
     muestra en la sección "Mediciones seriadas" más abajo.
     ═══════════════════════════════════════ */
  {
    const metodo = paston.consistenciaMetodo || "asentamiento";
    const metodoLabel = METODO_PDF_LABELS[metodo] || "Consistencia medida";
    const metodoUnit = METODO_PDF_UNITS[metodo] || "cm";

    const medRows = [
      [metodoLabel, paston.asentamientoMedido != null ? `${paston.asentamientoMedido} ${metodoUnit}` : "—"],
      ["Temp. hormigón", paston.temperaturaHormigon != null ? `${fmtNum(paston.temperaturaHormigon, 1)} °C` : "—"],
      ["Temp. ambiente", paston.temperaturaAmbiente != null ? `${fmtNum(paston.temperaturaAmbiente, 1)} °C` : "—"],
      ["PUV medido", paston.puvMedido != null ? `${fmtNum(paston.puvMedido, 0)} kg/m³` : "—"],
      ["Aire medido", paston.aireMedido != null ? `${fmtNum(paston.aireMedido, 1)} %` : "—"],
      ["Aspecto", paston.aspecto || "—"],
    ];
    const hayDatoFresco = medRows.some(([, v]) => v !== "—");
    if (hayDatoFresco) {
      const headerLabel = mediciones.length === 0
        ? "Mediciones en estado fresco (datos del pastón)"
        : "Datos del pastón fresco (Medición #1 - base)";
      sectionHead(headerLabel);
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        body: medRows,
        theme: "plain",
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  /* ═══════════════════════════════════════
     5. Probetas moldeadas (detalle por muestra)
     Se renderiza si el caller pasa `muestrasPaston` con sus probetas. Cada
     pastón puede tener 1-2 MuestraPaston (una por origen: PLANTA, OBRA) y
     cada muestra tiene N probetas con nombre, edad de rotura, fecha y estado.
     Si no se pasaron muestras pero sí `probetasMoldeadas` legacy, se muestra
     el bloque viejo como fallback.
     ═══════════════════════════════════════ */
  const probetasFlat = [];
  for (const m of muestrasPaston) {
    if (Array.isArray(m.probetas)) {
      for (const p of m.probetas) {
        probetasFlat.push({ ...p, _origen: m.origen, _lote: m.loteNumero });
      }
    }
  }
  if (probetasFlat.length > 0) {
    // Reservar espacio: cabecera + filas + nota.
    sectionHead("Probetas moldeadas", 10 + probetasFlat.length * 5 + 6);

    const fmtFecha = (v) => {
      if (!v) return "—";
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleDateString("es-AR");
    };
    const labelEstado = (id) => {
      // Mapeo mínimo de estados (ver fichaMuestraPdf para el set completo).
      const m = { 1: "Curando", 2: "Pendiente rotura", 3: "Rota", 4: "Descartada" };
      return m[id] || "—";
    };
    const resistTxt = (p) => p.ensayo && p.ensayo.resistencia != null
      ? `${fmtNum(Number(p.ensayo.resistencia), 1)} MPa`
      : "—";

    doc.autoTable({
      startY: y,
      head: [["#", "Origen", "Nombre", "Lote", "Edad", "Fecha rotura", "Estado", "Resistencia"]],
      body: probetasFlat.map((p, i) => [
        String(i + 1),
        p._origen === "OBRA" ? "Obra" : (p._origen === "PLANTA" ? "Planta" : "—"),
        p.nombre || `#${p.idProbeta}`,
        p._lote != null ? String(p._lote) : "—",
        p.diasRotura != null ? `${p.diasRotura} d` : "—",
        fmtFecha(p.fechaRotura),
        labelEstado(p.idEstadoProbeta),
        resistTxt(p),
      ]),
      margin: { left: margin, right: margin },
      theme: "striped",
      styles: { fontSize: 7.5, cellPadding: 1.2 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: 18 },
        2: { cellWidth: 36, fontStyle: "bold" },
        3: { cellWidth: 14, halign: "center" },
        4: { cellWidth: 16, halign: "center" },
        5: { cellWidth: 24, halign: "center" },
        6: { cellWidth: 28 },
        7: { cellWidth: "auto", halign: "right" },
      },
      rowPageBreak: "avoid",
    });
    y = doc.lastAutoTable.finalY + 4;

    // B3 (sugerencia DeepSeek) — Condición de mezcla por muestra. Si durante
    // el pastón hubo correcciones de agua/aditivo, las probetas de distintas
    // muestras NO son la misma mezcla → la dispersión de resistencia se
    // interpreta mal sin saber a qué punto del timeline corresponden.
    // Prioridad: vínculo explícito `medicionPaston` (FK, set por admin/edición);
    // si no, se DERIVA del timeline por etapa (PLANTA→última medición PLANTA,
    // OBRA→última medición OBRA).
    const medsOrden = [...mediciones].sort((a, b) =>
      (Number(a.ordenSecuencia) || 0) - (Number(b.ordenSecuencia) || 0));
    const fmtHoraCond = (v) => {
      if (!v) return null;
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
    };
    const condicionDeMuestra = (m) => {
      // 1) vínculo explícito
      const mp = m.medicionPaston;
      if (mp && mp.ordenSecuencia != null) {
        const h = fmtHoraCond(mp.fechaHora);
        return `Medición #${mp.ordenSecuencia}${mp.etapa ? ` ${mp.etapa}` : ''}${mp.etiqueta ? ` · ${mp.etiqueta}` : ''}${h ? ` · ${h}` : ''}`;
      }
      // 2) derivado por etapa
      const etapaObj = m.origen === 'OBRA' ? 'OBRA' : 'PLANTA';
      const cand = medsOrden.filter(x => (x.etapa || 'PLANTA') === etapaObj);
      const md = cand.length ? cand[cand.length - 1] : null;
      if (!md) return null;
      const h = fmtHoraCond(md.fechaHora);
      return `Medición #${md.ordenSecuencia || '—'} ${etapaObj}${md.etiqueta ? ` · ${md.etiqueta}` : ''}${h ? ` · ${h}` : ''} (derivado del timeline)`;
    };

    // ¿Hubo correcciones (agua/aditivo) en el timeline? → advertir que las
    // muestras de distintas condiciones no son una mezcla homogénea.
    const huboCorrecciones = mediciones.some((mm) => {
      if (Number(mm.aguaAgregadaLts) > 0) return true;
      let a = mm.aditivosAgregadosJson;
      if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = null; } }
      return Array.isArray(a) && a.some(x => Number(x?.cantidad) > 0);
    });

    const condRows = muestrasPaston
      .filter(m => Array.isArray(m.probetas) && m.probetas.length > 0)
      .map(m => [
        m.origen === 'OBRA' ? 'Obra' : (m.origen === 'PLANTA' ? 'Planta' : '—'),
        m.loteNumero != null ? `Lote ${m.loteNumero}` : '—',
        `${m.probetas.length} probeta(s)`,
        condicionDeMuestra(m) || 'Sin timeline (condición no determinable)',
      ]);
    if (condRows.length > 0) {
      checkBreak(8 + condRows.length * 6 + (huboCorrecciones ? 8 : 0));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.primary);
      doc.text("Condición de mezcla de cada muestra", margin, y + 3);
      y += 5;
      doc.autoTable({
        startY: y,
        head: [["Origen", "Lote", "Probetas", "Condición de mezcla (momento del moldeo)"]],
        body: condRows,
        margin: { left: margin, right: margin },
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 1.2 },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
        columnStyles: {
          0: { cellWidth: 18 },
          1: { cellWidth: 18, halign: "center" },
          2: { cellWidth: 24, halign: "center" },
          3: { cellWidth: "auto" },
        },
      });
      y = doc.lastAutoTable.finalY + 3;
      if (huboCorrecciones && condRows.length > 1) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(7);
        doc.setTextColor(217, 119, 6);
        const adv = "Atención: durante el pastón hubo correcciones de agua/aditivo. Las probetas de muestras con distinta condición NO representan una mezcla homogénea — interpretar la dispersión de resistencia considerando a qué condición corresponde cada grupo.";
        const al = doc.splitTextToSize(adv, contentW);
        doc.text(al, margin, y + 3);
        y += al.length * 3 + 4;
        doc.setTextColor(...C.text);
        doc.setFont("helvetica", "normal");
      }
      y += 2;
    }

    // Resumen agrupado por origen.
    const porOrigen = probetasFlat.reduce((acc, p) => {
      const k = p._origen || "—";
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    const resumen = Object.entries(porOrigen)
      .map(([k, v]) => `${k === "OBRA" ? "Obra" : k === "PLANTA" ? "Planta" : k}: ${v}`)
      .join("  |  ");
    doc.text(`Total: ${probetasFlat.length} probetas — ${resumen}`, margin, y + 3);
    doc.setTextColor(...C.text);
    doc.setFont("helvetica", "normal");
    y += 8;
  } else if ((mediciones.length === 0 && paston.probetasMoldeadas != null) || paston.identificacionProbetas) {
    // Fallback legacy: pastones antiguos sin MuestraPaston asociada.
    sectionHead("Probetas");
    const probRows = [];
    if (mediciones.length === 0 && paston.probetasMoldeadas != null) {
      probRows.push(["Probetas moldeadas (legacy)", String(paston.probetasMoldeadas)]);
    }
    if (paston.identificacionProbetas) {
      probRows.push(["Identificación", paston.identificacionProbetas]);
    }
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      body: probRows,
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 1.5 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  /* ═══════════════════════════════════════
     6. Observaciones (condicional)
     ═══════════════════════════════════════ */
  if (paston.observaciones) {
    sectionHead("Observaciones");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.text);
    const lines = doc.splitTextToSize(tx(paston.observaciones), contentW);
    doc.text(lines, margin, y);
    y += lines.length * 3.5 + 5;
  }

  /* Veredicto — se renderiza al FINAL del informe (después de Balance y
     Ajustes), no acá. Auditoría test49: el veredicto debe ser la conclusión
     final, no aparecer antes de las mediciones y el balance que lo sustentan.
     Ver bloque al final de la función. */

  /* ═══════════════════════════════════════
     7. Mediciones seriadas (condicional)
     ═══════════════════════════════════════ */
  if (mediciones.length > 0) {
    // Reserva: 8 mm header + 6 mm × filas + ~90 mm para el chart si aplica.
    sectionHead("Mediciones seriadas (pérdida de asentamiento)", 8 + mediciones.length * 6 + (mediciones.length >= 2 ? 90 : 0));

    const medsSorted = [...mediciones].sort((a, b) => {
      if (a.ordenSecuencia !== b.ordenSecuencia) return (a.ordenSecuencia || 0) - (b.ordenSecuencia || 0);
      return new Date(a.fechaHora || 0).getTime() - new Date(b.fechaHora || 0).getTime();
    });
    const fmtHora = (v) => {
      if (!v) return "—";
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
    };
    // Parse aditivos de cada medición
    const parseAditivos = (m) => {
      let arr = m.aditivosAgregadosJson;
      if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
      if (!Array.isArray(arr)) arr = [];
      if (arr.length === 0 && m.aditivoAgregadoNombre && m.aditivoAgregadoCantidad != null) {
        arr = [{ nombre: m.aditivoAgregadoNombre, cantidad: Number(m.aditivoAgregadoCantidad), unidad: m.aditivoAgregadoUnidad || "cc" }];
      }
      return arr.filter(a => a?.cantidad != null && Number(a.cantidad) > 0);
    };

    // Construir filas con agua y aditivos como texto compacto
    const buildAgregadosStr = (m) => {
      const parts = [];
      if (m.aguaAgregadaLts != null && Number(m.aguaAgregadaLts) > 0) {
        parts.push(`Agua: ${fmtNum(Number(m.aguaAgregadaLts), 1)} L`);
      }
      const ads = parseAditivos(m);
      for (const a of ads) {
        parts.push(`${a.nombre || "Aditivo"}: ${fmtNum(Number(a.cantidad), Number(a.cantidad) < 10 ? 2 : 1)} ${a.unidad || "cc"}`);
      }
      return parts.join(" | ") || "—";
    };

    checkBreak(10 + medsSorted.length * 6);
    // "Slump" → "Asent." (abreviado por ancho de columna) ; "TRANSPORTE" se
    // partía en 2 líneas con cellWidth=16 → se eleva a 20. "m3" → "m³"
    // (superscript 3 sí está en Latin-1).
    doc.autoTable({
      startY: y,
      head: [["#", "Etapa", "Hora", "Asent.", "T° H°", "Agregados en punto", "Vol. rem."]],
      body: medsSorted.map(m => [
        String(m.ordenSecuencia || "—"),
        m.etapa || "—",
        fmtHora(m.fechaHora),
        m.asentamientoMm != null ? `${fmtNum(m.asentamientoMm, 0)} mm` : "—",
        Number.isFinite(Number(m.temperaturaHormigonC)) ? `${fmtNum(m.temperaturaHormigonC, 1)}°` : "—",
        buildAgregadosStr(m),
        m.volumenRemanenteM3 != null ? `${fmtNum(Number(m.volumenRemanenteM3), 2)} m³` : "—",
      ]),
      margin: { left: margin, right: margin },
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 7, halign: "center" },
        1: { cellWidth: 20 },
        2: { cellWidth: 12 },
        3: { cellWidth: 16, halign: "right" },
        4: { cellWidth: 12, halign: "right" },
        5: { cellWidth: "auto" },
        6: { cellWidth: 18, halign: "right" },
      },
    });
    y = doc.lastAutoTable.finalY + 7;

    // ── Gráfico Slump vs tiempo (versión mejorada 2026-06-13) ──
    // Mejoras: tamaño 2× anterior, grilla mayor+menor, ejes con label, marcas
    // de eventos (agua/aditivo agregado), valores numéricos junto a cada punto
    // y leyenda más rica. Sigue siendo vector puro de jsPDF (no se rasteriza).
    const puntos = medsSorted
      .filter(m => m.asentamientoMm != null && m.fechaHora)
      .map(m => {
        let ads = m.aditivosAgregadosJson;
        if (typeof ads === "string") { try { ads = JSON.parse(ads); } catch { ads = []; } }
        const tieneAgua = Number(m.aguaAgregadaLts) > 0;
        const tieneAditivo = Array.isArray(ads) && ads.some(a => Number(a.cantidad) > 0);
        return {
          t: new Date(m.fechaHora).getTime(),
          slump: Number(m.asentamientoMm),
          etapa: m.etapa || "PLANTA",
          tieneAgua,
          tieneAditivo,
        };
      });
    // Jitter de X para puntos que comparten timestamp (audit test52): cuando
    // varias mediciones se hacen en el mismo minuto (e.g., planta y obra a
    // las 17:02) los círculos se superponen y los labels chocan. Acá
    // agrupamos por timestamp y asignamos un pequeño offset (en mm aplicado
    // sobre sx() abajo) ordenado por etapa: PLANTA -1.2, TRANSPORTE 0,
    // OBRA +1.2 — separa los puntos sin alterar el eje cronológico.
    const ORDEN_ETAPA = { PLANTA: -1.2, TRANSPORTE: 0, OBRA: 1.2 };
    const grupos = new Map();
    for (const p of puntos) {
      if (!grupos.has(p.t)) grupos.set(p.t, []);
      grupos.get(p.t).push(p);
    }
    for (const [, arr] of grupos) {
      if (arr.length <= 1) { arr.forEach(p => { p._jitterMm = 0; }); continue; }
      // Si hay 2+ en el mismo t, separar por etapa primero, luego por orden
      arr.sort((a, b) => (ORDEN_ETAPA[a.etapa] ?? 0) - (ORDEN_ETAPA[b.etapa] ?? 0));
      const step = 1.6;
      const start = -((arr.length - 1) / 2) * step;
      arr.forEach((p, i) => { p._jitterMm = start + i * step; });
    }
    if (puntos.length >= 2) {
      checkBreak(110);
      const chartW = contentW;
      const chartH = 78; // antes 42 → casi el doble de altura
      const padL = 24, padR = 10, padT = 10, padB = 24;
      const x0 = margin, y0 = y;

      // Fondo del chart (panel completo)
      doc.setFillColor(252, 253, 255);
      doc.setDrawColor(220, 226, 234);
      doc.setLineWidth(0.2);
      doc.rect(x0, y0, chartW, chartH, "FD");

      // Título del chart
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.primary);
      doc.text("Evolución del asentamiento en el tiempo", x0 + chartW / 2, y0 + padT - 3, { align: "center" });
      doc.setFont("helvetica", "normal");

      // Rangos
      const tMin = puntos[0].t;
      const tMaxRaw = puntos[puntos.length - 1].t;
      const tSpan = Math.max(1, tMaxRaw - tMin);
      // Padding temporal del 5% a cada lado para que los puntos extremos no toquen los ejes
      const tPad = tSpan * 0.05;
      const tMinE = tMin - tPad;
      const tMaxE = tMaxRaw + tPad;
      const sMaxRaw = Math.max(...puntos.map(p => p.slump), 220);
      // Redondear a múltiplo de 50 superior
      const sMax = Math.ceil(sMaxRaw / 50) * 50;
      const sx = (t) => x0 + padL + ((t - tMinE) / (tMaxE - tMinE)) * (chartW - padL - padR);
      const sy = (s) => y0 + chartH - padB - (s / sMax) * (chartH - padT - padB);

      // Grilla mayor (cada 50 mm) + ticks
      doc.setDrawColor(225, 230, 238);
      doc.setLineWidth(0.15);
      const yTicks = [];
      for (let s = 0; s <= sMax; s += 50) yTicks.push(s);
      yTicks.forEach(s => {
        const yt = sy(s);
        doc.line(x0 + padL, yt, x0 + chartW - padR, yt);
      });
      // Grilla menor (cada 25 mm) — más sutil
      doc.setDrawColor(238, 241, 246);
      doc.setLineWidth(0.1);
      for (let s = 25; s < sMax; s += 50) {
        const yt = sy(s);
        doc.line(x0 + padL, yt, x0 + chartW - padR, yt);
      }

      // Ejes (más oscuros que la grilla)
      doc.setDrawColor(120, 130, 145);
      doc.setLineWidth(0.4);
      doc.line(x0 + padL, y0 + padT, x0 + padL, y0 + chartH - padB);
      doc.line(x0 + padL, y0 + chartH - padB, x0 + chartW - padR, y0 + chartH - padB);

      // Labels Y + tick marks
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(80, 90, 105);
      yTicks.forEach(s => {
        const yt = sy(s);
        doc.setDrawColor(120, 130, 145);
        doc.line(x0 + padL - 1.2, yt, x0 + padL, yt);
        doc.text(String(s), x0 + padL - 2, yt + 1.5, { align: "right" });
      });
      // Etiqueta del eje Y (rotada)
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...C.secondary);
      doc.text("Asentamiento (mm)", x0 + 4, y0 + chartH / 2, { align: "center", angle: 90 });

      // Labels X — distribuir hasta 6 ticks por X para no saturar
      const fmtHoraShort = (ts) => {
        const d = new Date(ts);
        return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
      };
      const maxXTicks = Math.min(puntos.length, 6);
      const step = Math.max(1, Math.ceil(puntos.length / maxXTicks));
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(80, 90, 105);
      puntos.forEach((p, i) => {
        if (i % step !== 0 && i !== puntos.length - 1) return;
        const tx = sx(p.t);
        const ty = y0 + chartH - padB;
        doc.setDrawColor(120, 130, 145);
        doc.line(tx, ty, tx, ty + 1.2);
        doc.text(fmtHoraShort(p.t), tx - 2, ty + 5.5, { angle: 30 });
      });
      // Etiqueta del eje X
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.secondary);
      doc.text("Hora del dia", x0 + (chartW + padL - padR) / 2, y0 + chartH - 3, { align: "center" });

      // Helper: X final del punto con jitter aplicado. Sólo se usa para
      // puntos, halos y líneas de evento — la serie principal usa X sin
      // jitter para mantener una línea continua coherente con el tiempo.
      const sxJ = (p) => sx(p.t) + (p._jitterMm || 0);

      // Línea de serie — gruesa (sin jitter para no romper continuidad)
      doc.setDrawColor(37, 99, 235);
      doc.setLineWidth(0.7);
      for (let i = 1; i < puntos.length; i++) {
        doc.line(sx(puntos[i - 1].t), sy(puntos[i - 1].slump), sx(puntos[i].t), sy(puntos[i].slump));
      }

      // Marcas verticales de "evento" (agua o aditivo agregado) — línea
      // discontinua tenue para señalar el momento en el que se intervino la
      // mezcla. La línea SE INTERRUMPE en la vecindad del punto + valor
      // numérico (zona [py-7, py+4]) para no superponerse con el dato del
      // asentamiento; sin esto la lectura del valor sobre la línea naranja
      // resulta confusa (audit test51). Usa jitter para alinear con su punto.
      doc.setLineWidth(0.25);
      puntos.forEach(p => {
        if (!p.tieneAgua && !p.tieneAditivo) return;
        const tx = sxJ(p);
        const dataPy = sy(p.slump);
        const yTop = y0 + padT;
        const yBot = y0 + chartH - padB;
        const skipTop = dataPy - 7;
        const skipBot = dataPy + 4;
        doc.setDrawColor(217, 119, 6);
        // Segmento superior: yTop → skipTop
        for (let yy = yTop; yy < skipTop; yy += 2) {
          doc.line(tx, yy, tx, Math.min(yy + 1, skipTop));
        }
        // Segmento inferior: skipBot → yBot
        for (let yy = skipBot; yy < yBot; yy += 2) {
          doc.line(tx, yy, tx, Math.min(yy + 1, yBot));
        }
        // Etiqueta del evento: usamos "+Agua" en lugar de "+H2O" para evitar
        // el subíndice químico (U+2082 está fuera de Latin-1 y se sustituye).
        doc.setFont("helvetica", "bold");
        doc.setFontSize(5.5);
        doc.setTextColor(180, 95, 5);
        const tag = p.tieneAgua && p.tieneAditivo ? "+Agua+Adit." : p.tieneAgua ? "+Agua" : "+Adit.";
        doc.text(tag, tx + 1, y0 + padT + 3);
      });

      // Puntos por etapa: halo blanco + relleno coloreado + valor encima.
      // Audit test52: en eventos con línea punteada, el dato numérico se
      // confundía con la línea pese al skip zone. Reforzamos con un
      // rectángulo blanco DEBAJO del label (masking más confiable que sólo
      // skip de la línea). El rect se dibuja antes del texto.
      const colorByEtapa = { PLANTA: [245, 158, 11], TRANSPORTE: [6, 182, 212], OBRA: [16, 185, 129] };
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      for (const p of puntos) {
        const col = colorByEtapa[p.etapa] || [100, 100, 100];
        const px = sxJ(p), py = sy(p.slump);
        // Halo blanco para que destaque sobre la línea
        doc.setFillColor(255, 255, 255);
        doc.circle(px, py, 2.4, "F");
        doc.setFillColor(col[0], col[1], col[2]);
        doc.circle(px, py, 1.8, "F");
        // Backdrop blanco bajo el label (ancho proporcional al texto)
        const label = `${fmtNum(p.slump, 0)}`;
        const labelW = doc.getTextWidth(label) + 1.6;
        doc.setFillColor(252, 253, 255);
        doc.rect(px - labelW / 2, py - 5.5, labelW, 3, "F");
        // Valor numérico
        doc.setTextColor(50, 60, 75);
        doc.text(label, px, py - 3, { align: "center" });
      }

      // Leyenda al pie — círculos de etapas + marca de evento
      const legendY = y0 + chartH + 4;
      let lx = x0 + padL;
      const etapasPresentes = new Set(puntos.map(p => p.etapa));
      const allLegend = [
        { key: "PLANTA", label: "Planta", col: [245, 158, 11] },
        { key: "TRANSPORTE", label: "Transporte", col: [6, 182, 212] },
        { key: "OBRA", label: "Obra", col: [16, 185, 129] },
      ];
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      allLegend.filter(l => etapasPresentes.has(l.key)).forEach(l => {
        doc.setFillColor(l.col[0], l.col[1], l.col[2]);
        doc.circle(lx + 1.5, legendY - 1, 1.4, "F");
        doc.setFillColor(255, 255, 255);
        doc.circle(lx + 1.5, legendY - 1, 0.6, "F");
        doc.setTextColor(...C.text);
        doc.text(l.label, lx + 4.5, legendY);
        lx += 28;
      });
      // Marca de evento en leyenda si hubo agregados
      if (puntos.some(p => p.tieneAgua || p.tieneAditivo)) {
        doc.setDrawColor(217, 119, 6);
        doc.setLineWidth(0.4);
        for (let yy = legendY - 2.5; yy < legendY + 0.5; yy += 1) {
          doc.line(lx + 1.5, yy, lx + 1.5, Math.min(yy + 0.5, legendY + 0.5));
        }
        doc.setTextColor(...C.text);
        doc.text("Agregado en obra", lx + 4.5, legendY);
      }
      y = legendY + 6;
      doc.setTextColor(...C.text);
      doc.setFont("helvetica", "normal");
    }

    /* ═══════════════════════════════════════
       7.bis Analisis del efecto del aditivo sobre el asentamiento
       Para cada intervalo entre mediciones consecutivas donde se agregó agua
       o aditivo, calcula:
         - Δslump observado (mm)
         - Δslump teórico atribuible al agua: ~6 mm por L agregado por m³
           de hormigón remanente (regla práctica común; depende del mix).
         - Δslump residual = observado − atribuido al agua  → efecto del aditivo
         - Comparación con `incrementoAsentamientoEsperado` declarado en la
           ficha técnica del aditivo (proporcional a la dosis agregada vs dosis
           de diseño que es la base del valor declarado).
       Sección informativa, no normativa: las reglas son aproximadas.
       ═══════════════════════════════════════ */
    const medsSortedAna = [...mediciones].sort((a, b) => {
      if (a.ordenSecuencia !== b.ordenSecuencia) return (a.ordenSecuencia || 0) - (b.ordenSecuencia || 0);
      return new Date(a.fechaHora || 0).getTime() - new Date(b.fechaHora || 0).getTime();
    });
    const intervalosConAgregado = [];
    for (let i = 1; i < medsSortedAna.length; i++) {
      const prev = medsSortedAna[i - 1];
      const cur = medsSortedAna[i];
      const aguaL = Number(cur.aguaAgregadaLts) || 0;
      let ads = cur.aditivosAgregadosJson;
      if (typeof ads === "string") { try { ads = JSON.parse(ads); } catch { ads = []; } }
      if (!Array.isArray(ads)) ads = [];
      ads = ads.filter(a => a && Number(a.cantidad) > 0);
      if (aguaL <= 0 && ads.length === 0) continue;
      if (prev.asentamientoMm == null || cur.asentamientoMm == null) continue;
      intervalosConAgregado.push({ prev, cur, aguaL, ads });
    }

    if (intervalosConAgregado.length > 0) {
      // Reserva: 12 mm de intro + 12 mm × intervalos + 10 mm de nota final.
      sectionHead("Análisis del efecto del aditivo sobre el asentamiento", 12 + intervalosConAgregado.length * 12 + 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      const intro = "Para cada intervalo entre mediciones se aísla el aporte del agua (regla práctica: ~6 mm/L sobre el remanente) del aporte del aditivo. El efecto observado del aditivo se contrasta con el incremento declarado en la ficha técnica, escalado a la dosis efectivamente agregada.";
      doc.text(doc.splitTextToSize(intro, contentW), margin, y);
      y += doc.splitTextToSize(intro, contentW).length * 3 + 2;
      doc.setTextColor(...C.text);

      // Helper: para un aditivo agregado, obtener la ficha declarada
      const fichaPorAditivo = (nombre, refIdx) => {
        if (refIdx != null) {
          const m = aditivosMeta.find(a => a.refIdx === refIdx);
          if (m) return m;
        }
        const lower = (nombre || "").trim().toLowerCase();
        return aditivosMeta.find(a => (a.nombre || "").trim().toLowerCase() === lower) || null;
      };

      const anaRows = [];
      for (const it of intervalosConAgregado) {
        const dSlumpMm = Number(it.cur.asentamientoMm) - Number(it.prev.asentamientoMm);
        const dSlumpCm = dSlumpMm / 10;
        const remanenteM3 = Number(it.cur.volumenRemanenteM3) || Number(it.prev.volumenRemanenteM3) || (Number(paston.volumenM3) || 1);
        // Aporte del agua: ~6 mm de aumento de slump por cada L de agua / m³ remanente.
        // Es una regla de campo. La doc lo aclara explícitamente.
        const aguaPorM3 = remanenteM3 > 0 ? it.aguaL / remanenteM3 : 0;
        const dPorAguaMm = aguaPorM3 * 6;
        const dResidualMm = dSlumpMm - dPorAguaMm;

        // Aporte declarado del aditivo: escalado por dosis agregada vs dosis diseño.
        // Formato del detalle por aditivo: dos líneas por producto para no
        // depender del wrap automático que parte frases a la mitad. La
        // primera línea identifica el aditivo + cantidad agregada; la
        // segunda muestra el efecto declarado en ficha técnica.
        let dDeclaradoMm = 0;
        const detalleAditivos = [];
        for (const a of it.ads) {
          const ficha = fichaPorAditivo(a.nombre, a.refIdx);
          const nombreCorto = ficha?.nombre || a.nombre || "Aditivo";
          const cantTxt = `${fmtNum(Number(a.cantidad), 2)} ${a.unidad || "kg"}`;
          if (!ficha) {
            detalleAditivos.push(`${nombreCorto}: ${cantTxt}`);
            continue;
          }
          const dosisAgregadaPorM3 = remanenteM3 > 0 ? Number(a.cantidad) / remanenteM3 : 0;
          const dosisDisenoKgM3 = Number(ficha.dosisDiseno) || 0;
          if (dosisDisenoKgM3 > 0 && ficha.incrementoAsentamientoEsperado != null) {
            const factor = dosisAgregadaPorM3 / dosisDisenoKgM3;
            const incCm = Number(ficha.incrementoAsentamientoEsperado);
            const incMm = incCm * 10;
            const aporte = incMm * factor;
            dDeclaradoMm += aporte;
            // El "@" anterior generaba confusión. Usamos texto explícito.
            // Unidades en mm con cm entre paréntesis (audit test52): el chart
            // y la tabla manejan mm, la ficha del fabricante suele venir en
            // cm — mostramos ambos para evitar mala lectura.
            detalleAditivos.push(
              `${nombreCorto}: ${cantTxt} agregado\n  ficha técnica: +${fmtNum(incMm, 0)} mm (${fmtNum(incCm, 1)} cm) de asentamiento con dosis ${fmtNum(dosisDisenoKgM3, 3)} kg/m³`
            );
          } else {
            detalleAditivos.push(`${nombreCorto}: ${cantTxt} agregado (sin dato en ficha técnica)`);
          }
        }

        const hora = (() => {
          if (!it.cur.fechaHora) return "—";
          const d = new Date(it.cur.fechaHora);
          if (isNaN(d.getTime())) return String(it.cur.fechaHora);
          return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
        })();

        anaRows.push([
          `${it.cur.etapa || "—"} ${hora}`,
          // "->" se reemplaza por prosa: "60 a 160 mm". El símbolo → (U+2192)
          // no existe en Latin-1/WinAnsi (la fuente embebida de jsPDF), y
          // representarlo como "->" parecía ASCII art. "a" es claro en español:
          // "de 60 a 160 mm" significa "from 60 to 160 mm".
          `${fmtNum(it.prev.asentamientoMm, 0)} a ${fmtNum(it.cur.asentamientoMm, 0)} mm`,
          `${dSlumpMm > 0 ? "+" : ""}${fmtNum(dSlumpMm, 0)} mm`,
          // El cálculo es determinístico (no se aproxima), aunque la regla
          // práctica que lo sustenta sí. El "~" se removió: la incertidumbre
          // vive en el factor 6 mm/L declarado en la intro de la sección,
          // no en el resultado por intervalo.
          it.aguaL > 0 ? `+${fmtNum(it.aguaL, 1)} L\n${fmtNum(dPorAguaMm, 0)} mm` : "—",
          dDeclaradoMm > 0 ? `${fmtNum(dDeclaradoMm, 0)} mm declarado` : (detalleAditivos.length ? "sin dato" : "—"),
          `${dResidualMm > 0 ? "+" : ""}${fmtNum(dResidualMm, 0)} mm`,
          detalleAditivos.join("\n") || "—",
        ]);
      }

      checkBreak(15 + anaRows.length * 12);
      doc.autoTable({
        startY: y,
        // jsPDF embebe Helvetica WinAnsi (Latin-1) por defecto. Δ (U+0394) y
        // → (U+2192) están FUERA de esa codificación y se sustituyen por
        // glifos basura (`"` y `!'` respectivamente). Para evitarlo usamos
        // ASCII: "Var." en lugar de Δ y "->" en lugar de →.
        head: [["Intervalo", "Asentamiento", "Var. obs.", "Aporte agua", "Aporte aditivo declarado", "Var. residual (aditivo real)", "Detalle"]],
        body: anaRows,
        margin: { left: margin, right: margin },
        theme: "grid",
        styles: { fontSize: 6.8, cellPadding: 1.2, valign: "middle" },
        headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold", fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 22, fontStyle: "bold" },
          1: { cellWidth: 26, halign: "right" },
          2: { cellWidth: 16, halign: "right", fontStyle: "bold" },
          3: { cellWidth: 22, halign: "right" },
          4: { cellWidth: 28, halign: "right" },
          5: { cellWidth: 22, halign: "right", fontStyle: "bold", textColor: C.amber },
          6: { cellWidth: "auto" },
        },
      });
      y = doc.lastAutoTable.finalY + 4;

      // Lectura comparativa (resumen):
      doc.setFontSize(7);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(...C.muted);
      const nota = "Var. residual = Var. observada - aporte estimado del agua. Si la Var. residual es similar al aporte declarado del aditivo, el producto está rindiendo según ficha. Si es menor, puede haber pérdida por absorción o por tiempo transcurrido; si es mayor, sinergia o sobredosis.";
      const lns = doc.splitTextToSize(nota, contentW);
      doc.text(lns, margin, y + 3);
      y += lns.length * 3 + 6;
      doc.setTextColor(...C.text);
      doc.setFont("helvetica", "normal");
    }
  }

  // B2 — valores que la sección "Desvíos críticos" necesita del Balance.
  // Se hoistean acá y se asignan dentro del bloque de Balance/a-c para no
  // recomputar la a/c efectiva (lógica no trivial) y arriesgar divergencia.
  let _acEfectivaFinal = null;
  let _acLimiteGob = null; // { v, fuente }
  // B2 (audit test56): la diferencia de carga relevante es DOSIFICADO vs
  // TOTAL REAL en la mezcla (incluye agregados de obra), NO dosificado vs
  // (dosificado − retenido). Se hoistea del Balance para no re-agregar.
  const _balancePorComponente = []; // { nombre, dosificado, totalReal, unidad }

  /* ═══════════════════════════════════════
     8. Balance de materiales — totales agregados vs dosificación
     ═══════════════════════════════════════ */
  {
    // Sumar materiales agregados desde las acciones (redosificaciones/ajustes)
    let aguaTotalAgregadaL = 0;
    const aditivosTotales = {}; // "nombre (unidad)" → cantidad
    for (const a of ajustesDelPaston) {
      const tipo = a.tipoAccion || 'ADITIVO';
      const cant = a.cantidad != null ? Number(a.cantidad) : (a.dosis != null ? Number(a.dosis) : 0);
      if (cant <= 0) continue;
      if (tipo === 'AGUA') {
        aguaTotalAgregadaL += cant;
      } else {
        const nombre = tipo === 'AIRE' ? 'Aire incorporado'
          : a.aditivo?.marca || a.nombreMaterial || `Material #${a.idAditivo || a.idFibra || '?'}`;
        const unidad = a.unidad || 'cc';
        const key = `${nombre} (${unidad})`;
        aditivosTotales[key] = (aditivosTotales[key] || 0) + cant;
      }
    }
    // Fallback: si no hay ajustes, intentar leer de mediciones legacy
    if (ajustesDelPaston.length === 0) {
      for (const m of mediciones) {
        if (m.aguaAgregadaLts != null) aguaTotalAgregadaL += Number(m.aguaAgregadaLts);
        let arr = m.aditivosAgregadosJson;
        if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
        if (!Array.isArray(arr)) arr = [];
        if (arr.length === 0 && m.aditivoAgregadoNombre && m.aditivoAgregadoCantidad != null) {
          arr = [{ nombre: m.aditivoAgregadoNombre, cantidad: Number(m.aditivoAgregadoCantidad), unidad: m.aditivoAgregadoUnidad || "cc" }];
        }
        for (const a of arr) {
          if (a?.cantidad != null && Number(a.cantidad) > 0) {
            const key = `${a.nombre || "Aditivo"} (${a.unidad || "cc"})`;
            aditivosTotales[key] = (aditivosTotales[key] || 0) + Number(a.cantidad);
          }
        }
      }
    }

    // Consolidar aditivos del pastón por nombre (un mismo aditivo puede
    // estar en 2 slots con funciones distintas pero es el mismo producto físico)
    const aguaDosifComp = comps.find(c => c.tipo === "AGUA");
    const aditivosComps = comps.filter(c => c.tipo === "ADITIVO");

    // Sesión 2026-06-13 — los retenidos ahora viven en Medición #1 (base).
    // Antes el UI escribía a `comps[i].retenido` desde la grilla del protocolo,
    // pero esa grilla se eliminó y ahora la fuente única es la primera medición
    // del timeline. Acá leemos los campos JSON `aguaRetenidaLts`,
    // `aditivosRetenidosJson` y `fibrasRetenidasJson` con fallback a los
    // campos legacy de componentes para no romper pastones viejos.
    const medicionBase = mediciones.find(m => Number(m.ordenSecuencia) === 1)
      || mediciones[0]
      || null;
    let aditivosRetenidosBase = [];
    let fibrasRetenidasBase = [];
    let aguaRetenidaBase = 0;
    if (medicionBase) {
      aguaRetenidaBase = Number(medicionBase.aguaRetenidaLts) || 0;
      let arr = medicionBase.aditivosRetenidosJson;
      if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
      if (Array.isArray(arr)) aditivosRetenidosBase = arr.filter(a => a && Number(a.cantidad) > 0);
      let arrF = medicionBase.fibrasRetenidasJson;
      if (typeof arrF === "string") { try { arrF = JSON.parse(arrF); } catch { arrF = []; } }
      if (Array.isArray(arrF)) fibrasRetenidasBase = arrF.filter(f => f && Number(f.cantidad) > 0);
    }
    const retenidoBaseDeAditivo = (nombreComp) => {
      const lower = (nombreComp || "").trim().toLowerCase();
      for (const a of aditivosRetenidosBase) {
        if ((a.nombre || "").trim().toLowerCase() === lower) return Number(a.cantidad) || 0;
      }
      return 0;
    };

    // Agrupar componentes aditivos por nombre → sumar dosificado y retenido
    // (el retenido legacy de comps + el retenido moderno de medición #1).
    const aditivosConsolidados = {};
    for (const ac of aditivosComps) {
      const nombre = ac.componente;
      if (!aditivosConsolidados[nombre]) {
        aditivosConsolidados[nombre] = { nombre, unidad: ac.unidad, dosificado: 0, retenido: 0 };
      }
      aditivosConsolidados[nombre].dosificado += Number(ac.cantidadScaled || 0);
      aditivosConsolidados[nombre].retenido += Number(ac.retenido || 0);
    }
    // Sumar al retenido lo que aporta la Medición #1 (key: nombre del componente).
    for (const nombre of Object.keys(aditivosConsolidados)) {
      aditivosConsolidados[nombre].retenido += retenidoBaseDeAditivo(nombre);
    }

    const hayAgregados = aguaTotalAgregadaL > 0 || Object.keys(aditivosTotales).length > 0;
    const hayRetenidosComp = comps.some(c => Number(c.retenido || 0) > 0)
      || aguaRetenidaBase > 0
      || aditivosRetenidosBase.length > 0
      || fibrasRetenidasBase.length > 0;

    if (hayAgregados || hayRetenidosComp) {
      // Estimar filas antes del sectionHead para reservar espacio correcto.
      const filasEstimadas = (aguaDosifComp ? 1 : 0)
        + Object.keys(aditivosConsolidados).length
        + fibrasRetenidasBase.length
        + 1; // header
      // Reserva: 10 mm header tabla + 6 mm × filas + 12 mm para línea a/c final.
      sectionHead("Balance de materiales", 10 + filasEstimadas * 6 + 12);

      const balanceRows = [];
      const dec = (v) => Math.abs(v) < 10 ? 2 : 1;

      // Agua — Audit test53: cuando hay corrección por humedad, "Cargado"
      // debe ser el agua que efectivamente pasa por el caudalímetro
      // (agua corregida − retenido), no la dosis teórica. Si los agregados
      // aportan +X L de humedad, el caudalímetro carga −X L para mantener
      // el a/c objetivo. Antes mostrábamos agua teórica y el lector veía
      // inconsistencia con la Sección 3 ("Trazabilidad").
      if (aguaDosifComp) {
        const dosificado = Number(aguaDosifComp.cantidadScaled || 0);
        const retenido = Math.max(Number(aguaDosifComp.retenido || 0), aguaRetenidaBase);
        const aguaCorregida = dosificado - deltaAguaPorHumedadL; // = lo que va al caudalímetro
        const cargadoInicial = aguaCorregida - retenido;
        const totalReal = cargadoInicial + aguaTotalAgregadaL;
        const diff = totalReal - dosificado;
        balanceRows.push([
          paston.correccionHumedad && Math.abs(deltaAguaPorHumedadL) > 0.05
            ? `Agua (corregida por humedad)`
            : "Agua",
          `${fmtNum(dosificado, 1)} ${aguaDosifComp.unidad}`,
          retenido > 0 ? `${fmtNum(retenido, 1)}` : "—",
          `${fmtNum(cargadoInicial, 1)}`,
          aguaTotalAgregadaL > 0 ? `+${fmtNum(aguaTotalAgregadaL, 1)}` : "—",
          `${fmtNum(totalReal, 1)}`,
          diff !== 0 ? `${diff > 0 ? "+" : ""}${fmtNum(diff, 1)}` : "=",
        ]);
        // Agua excluida del check B2 (tiene su propia trazabilidad de
        // corrección/humedad), pero la registramos por completitud.
        _balancePorComponente.push({ nombre: 'Agua', dosificado, totalReal, unidad: aguaDosifComp.unidad, esAgua: true });
      }

      // Aditivos consolidados por nombre
      const aditivosTotalesCopy = { ...aditivosTotales };
      for (const [nombre, ac] of Object.entries(aditivosConsolidados)) {
        const cargadoInicial = ac.dosificado - ac.retenido;
        // Buscar agregados que matcheen por nombre del aditivo
        const matchKey = Object.keys(aditivosTotalesCopy).find(k => k.startsWith(nombre));
        const agregado = matchKey ? aditivosTotalesCopy[matchKey] : 0;
        const totalReal = cargadoInicial + agregado;
        const diff = totalReal - ac.dosificado;
        balanceRows.push([
          nombre,
          `${fmtNum(ac.dosificado, dec(ac.dosificado))} ${ac.unidad}`,
          ac.retenido > 0 ? `${fmtNum(ac.retenido, dec(ac.retenido))}` : "—",
          `${fmtNum(cargadoInicial, dec(cargadoInicial))}`,
          agregado > 0 ? `+${fmtNum(agregado, dec(agregado))}` : "—",
          `${fmtNum(totalReal, dec(totalReal))}`,
          diff !== 0 ? `${diff > 0 ? "+" : ""}${fmtNum(diff, dec(diff))}` : "=",
        ]);
        _balancePorComponente.push({ nombre, dosificado: ac.dosificado, totalReal, unidad: ac.unidad, esAgua: false });
        if (matchKey) delete aditivosTotalesCopy[matchKey];
      }

      // Aditivos "Otro" que no matchean con ningún componente de la dosificación
      for (const [key, cant] of Object.entries(aditivosTotalesCopy)) {
        balanceRows.push([
          key.replace(/ \([^)]+\)$/, ""),
          "— (no dosificado)",
          "—",
          "—",
          `+${fmtNum(cant, dec(cant))}`,
          `${fmtNum(cant, dec(cant))}`,
          `+${fmtNum(cant, dec(cant))}`,
        ]);
      }

      // Fibras retenidas declaradas en la Medición #1. El `comps` clásico
      // no incluye fibras (viven aparte en resultado.fibras del motor), así
      // que el "Dosificado" se muestra como — y solo se reporta el Retenido.
      for (const f of fibrasRetenidasBase) {
        const cant = Number(f.cantidad) || 0;
        if (cant <= 0) continue;
        balanceRows.push([
          `${f.nombre || "Fibra"} (fibra)`,
          "—",
          `${fmtNum(cant, dec(cant))} ${f.unidad || "kg"}`,
          "—",
          "—",
          "—",
          "—",
        ]);
      }

      if (balanceRows.length > 0) {
        checkBreak(10 + balanceRows.length * 6);
        // Audit test52: "DYNAMON XTEND W500 R" partía en 2 filas con cellWidth=35.
        // Ensanchamos Material a 48mm y bajamos fontSize a 7 (de 7.5) para
        // mantener el total dentro de contentW. Numéricas siguen legibles.
        doc.autoTable({
          startY: y,
          head: [["Material", "Dosificado", "Retenido", "Cargado", "Agregado", "Total real", "Diferencia"]],
          body: balanceRows,
          margin: { left: margin, right: margin },
          theme: "grid",
          styles: { fontSize: 7, cellPadding: 1.2 },
          headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold", fontSize: 7.5 },
          columnStyles: {
            0: { fontStyle: "bold", cellWidth: 48 },
            1: { halign: "right", cellWidth: 22 },
            2: { halign: "right", cellWidth: 18 },
            3: { halign: "right", cellWidth: 20 },
            4: { halign: "right", cellWidth: 20, textColor: [217, 119, 6] },
            5: { halign: "right", cellWidth: 20, fontStyle: "bold" },
            6: { halign: "right", cellWidth: "auto" },
          },
        });
        y = doc.lastAutoTable.finalY + 7;
      }

      // Verificación a/c — tres valores explícitos (audit test53):
      //
      //   1. Diseño: agua teórica / cemento teórico, antes de cualquier ajuste.
      //   2. Agua aforada en planta: lo que pasó por el caudalímetro (agua
      //      teórica menos aporte de humedad de los agregados menos retenido).
      //      Es el dato que el operador ve en planta. NO incluye humedad ni
      //      agregados de obra.
      //   3. Efectiva final (con humedad y obra): refleja la mezcla realmente
      //      producida (agua aforada + aporte de humedad de los agregados +
      //      agua agregada en obra) / cemento real. Es la métrica relevante
      //      para la calidad del hormigón terminado.
      //
      // Audit observó que "Real (planta)" incluía agregados de OBRA — etiqueta
      // engañosa. Y que el agua "real" debe incluir el aporte de humedad para
      // ser fiel a la mezcla efectivamente producida.
      if (aguaDosifComp) {
        const cementoComp = comps.find(c => c.tipo === "CEMENTO");
        if (cementoComp) {
          const aguaDosif = Number(aguaDosifComp.cantidadScaled || 0);
          const aguaRetenida = Number(aguaDosifComp.retenido || 0);
          const cementoDosif = Number(cementoComp.cantidadScaled || 0);
          const cementoRetenido = Number(cementoComp.retenido || 0);
          const cementoReal = cementoDosif - cementoRetenido;
          // Agua aforada = lo que pasó por el caudalímetro = teórica - humedad - retenido.
          const aguaAforada = aguaDosif - deltaAguaPorHumedadL - aguaRetenida;
          // Efectiva final = aforada + aporte humedad (que vuelve a la mezcla) + obra.
          const aguaEfectiva = aguaAforada + deltaAguaPorHumedadL + aguaTotalAgregadaL;

          if (cementoDosif > 0 && cementoReal > 0) {
            const acDisenio = aguaDosif / cementoDosif;
            const acAforada = aguaAforada / cementoReal;
            const acEfectiva = aguaEfectiva / cementoReal;
            const acDiffFinal = acEfectiva - acDisenio;

            checkBreak(20);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            doc.setTextColor(...C.primary);
            doc.text("Relación a/c:", margin, y);
            y += 4.2;

            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.8);
            doc.setTextColor(...C.text);
            const linea = [
              `Diseño: ${acDisenio.toFixed(3)}`,
              `Agua aforada en planta: ${acAforada.toFixed(3)}`,
              `Efectiva final (con humedad y obra): ${acEfectiva.toFixed(3)}`,
            ].join("   |   ");
            doc.text(linea, margin + 2, y);
            y += 4;

            // Diferencia final vs diseño con código de color
            const acColor = Math.abs(acDiffFinal) > 0.02 ? [220, 38, 38] : [22, 163, 74];
            const acIcon = Math.abs(acDiffFinal) > 0.02 ? "ATENCIÓN" : "OK";
            doc.setFont("helvetica", "italic");
            doc.setFontSize(7.5);
            doc.setTextColor(acColor[0], acColor[1], acColor[2]);
            doc.text(
              `Diferencia efectiva final vs diseño: ${acDiffFinal > 0 ? "+" : ""}${acDiffFinal.toFixed(3)}  [${acIcon}]`,
              margin + 2, y
            );
            doc.setDrawColor(acColor[0], acColor[1], acColor[2]);
            doc.setLineWidth(0.4);
            doc.line(margin, y + 1.5, margin + contentW, y + 1.5);
            y += 6;
            doc.setTextColor(...C.text);
            doc.setFont("helvetica", "normal");

            // B1 — Alerta de desvío normativo de a/c (visual, NO bloqueante).
            // revisor-civil: el a/c máx (pliego y Tabla 2.5 durabilidad) es
            // límite infranqueable y el que debe cumplir es el EFECTIVO real.
            // Por decisión de producto se alerta (banner rojo) sin degradar
            // el veredicto automáticamente — la responsabilidad queda en el
            // evaluador, pero el desvío queda documentado y visible.
            const limites = [
              acMaxPliego != null && Number.isFinite(Number(acMaxPliego))
                ? { v: Number(acMaxPliego), fuente: 'pliego' } : null,
              acMaxDurabilidad != null && Number.isFinite(Number(acMaxDurabilidad))
                ? { v: Number(acMaxDurabilidad), fuente: `durabilidad CIRSOC 200:2024 Tabla 2.5${claseExposicion ? ` — clase ${claseExposicion}` : ''}` } : null,
            ].filter(Boolean);
            if (limites.length > 0) {
              // El más restrictivo gobierna.
              const gobernante = limites.reduce((a, b) => (b.v < a.v ? b : a));
              const TOL_AC = 0.005; // ruido de redondeo del a/c (3 decimales)
              _acEfectivaFinal = acEfectiva;
              _acLimiteGob = gobernante;
              if (acEfectiva > gobernante.v + TOL_AC) {
                checkBreak(16);
                const bx = margin, bw = contentW, bh = 13;
                doc.setFillColor(254, 226, 226);          // rojo muy claro
                doc.setDrawColor(220, 38, 38);
                doc.setLineWidth(0.5);
                doc.roundedRect(bx, y, bw, bh, 1.2, 1.2, 'FD');
                doc.setFont("helvetica", "bold");
                doc.setFontSize(8);
                doc.setTextColor(185, 28, 28);
                doc.text("DESVÍO NORMATIVO DE a/c", bx + 3, y + 4.5);
                doc.setFont("helvetica", "normal");
                doc.setFontSize(7);
                doc.setTextColor(127, 29, 29);
                const msg = `La a/c efectiva final (${acEfectiva.toFixed(3)}) supera el a/c máximo de ${gobernante.fuente} (${gobernante.v.toFixed(3)}). El a/c máximo es un límite de cumplimiento obligatorio (CIRSOC 200:2024 §2.2.4/§6) y aplica sobre la a/c REAL, no la de diseño. Verificar conformidad / justificar el desvío antes de liberar a producción.`;
                const ml = doc.splitTextToSize(msg, bw - 6);
                doc.text(ml, bx + 3, y + 8);
                y += bh + 4;
                doc.setTextColor(...C.text);
                doc.setFont("helvetica", "normal");
              }
            }
          }
        }
      }
    }
  }

  /* ═══════════════════════════════════════
     8.bis Desvíos críticos (B2 — sugerencia DeepSeek)
     Consolida automáticamente, ANTES del veredicto, los apartamientos que
     el evaluador debe ver sí o sí:
       1) a/c efectiva final > a/c máximo (pliego / Tabla 2.5 durabilidad).
       2) Aditivo usado en obra NO previsto en el diseño original.
       3) Diferencia de carga > 5% por componente sólido (no agua: el agua
          ya tiene su propia trazabilidad de corrección/humedad).
     Visual/alerta — NO degrada el veredicto (decisión de producto).
     ═══════════════════════════════════════ */
  {
    const desvios = [];

    // (1) a/c efectiva > máx (reusa lo computado en Balance, sin recomputar)
    if (_acEfectivaFinal != null && _acLimiteGob
        && _acEfectivaFinal > _acLimiteGob.v + 0.005) {
      desvios.push(`Relación a/c efectiva final ${_acEfectivaFinal.toFixed(3)} supera el máximo de ${_acLimiteGob.fuente} (${_acLimiteGob.v.toFixed(3)}). Límite de cumplimiento obligatorio (CIRSOC 200:2024 §2.2.4/§6).`);
    }

    // (2) Aditivos agregados en obra que NO estaban en el diseño original.
    // `aditivosMeta` = aditivos del diseño (con nombre). En cada medición,
    // `aditivosAgregadosJson` puede traer { nombre, cantidad, unidad,
    // esOtro }. esOtro=true ⇒ aditivo libre no previsto; si esOtro!=true
    // igual verificamos que el nombre matchee alguno del diseño.
    const nombresDiseno = new Set(
      (aditivosMeta || []).map(a => String(a.nombre || '').trim().toLowerCase()).filter(Boolean)
    );
    const noPrevistos = new Map(); // nombre → cantidad acumulada
    for (const m of mediciones) {
      let arr = m.aditivosAgregadosJson;
      if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
      if (!Array.isArray(arr)) arr = [];
      for (const a of arr) {
        const cant = Number(a?.cantidad) || 0;
        if (cant <= 0) continue;
        const nom = String(a?.nombre || '').trim();
        const esNoPrevisto = a?.esOtro === true
          || (nom && !nombresDiseno.has(nom.toLowerCase()));
        if (esNoPrevisto && nom) {
          noPrevistos.set(nom, (noPrevistos.get(nom) || 0) + cant);
        }
      }
    }
    for (const [nom, cant] of noPrevistos) {
      desvios.push(`Aditivo "${nom}" agregado en obra (${fmtNum(cant, 2)}) NO estaba previsto en el diseño original. Requiere justificación, dosis normalizada y verificación de compatibilidad.`);
    }

    // (3) Diferencia de carga > 5% por componente — DOSIFICADO vs TOTAL REAL
    // en la mezcla (incluye agregados de obra), tomado del Balance (fix
    // audit test56: antes comparaba dosificado vs dosificado−retenido y no
    // detectaba el desvío real, p.ej. "Dynamon dosificado 16,6 vs real
    // 17,6"). Agua excluida: tiene su propia trazabilidad de corrección.
    for (const b of _balancePorComponente) {
      if (b.esAgua) continue;
      const dosif = Number(b.dosificado || 0);
      if (dosif <= 0) continue;
      const real = Number(b.totalReal || 0);
      const diffPct = ((real - dosif) / dosif) * 100;
      if (Math.abs(diffPct) > 5) {
        const d2 = (v) => (Math.abs(v) < 10 ? 2 : (v < 100 ? 1 : 0));
        desvios.push(`${b.nombre}: dosificado ${fmtNum(dosif, d2(dosif))} ${b.unidad || ''} vs cargado real ${fmtNum(real, d2(real))} ${b.unidad || ''} (${diffPct > 0 ? '+' : ''}${fmtNum(diffPct, 1)}%). Diferencia > 5%: documentar la causa operativa (error de dosificación o ajuste a criterio del operador).`);
      }
    }

    if (desvios.length > 0) {
      const altura = 9 + desvios.length * 9 + 4;
      sectionHead("Desvíos críticos", altura);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      const intro = "Apartamientos detectados automáticamente que el evaluador debe analizar antes de emitir el veredicto. No bloquean la emisión, pero quedan registrados en el informe.";
      doc.text(doc.splitTextToSize(intro, contentW), margin, y);
      y += doc.splitTextToSize(intro, contentW).length * 3 + 2;

      for (const d of desvios) {
        const lines = doc.splitTextToSize(d, contentW - 8);
        const bh = lines.length * 3.4 + 3;
        checkBreak(bh + 2);
        doc.setFillColor(254, 226, 226);
        doc.setDrawColor(220, 38, 38);
        doc.setLineWidth(0.4);
        doc.roundedRect(margin, y, contentW, bh, 1, 1, 'FD');
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(185, 28, 28);
        doc.text("!", margin + 3, y + 4);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(127, 29, 29);
        doc.text(lines, margin + 7, y + 4);
        y += bh + 2.5;
      }
      doc.setTextColor(...C.text);
      doc.setFont("helvetica", "normal");
      y += 3;
    }
  }

  /* ═══════════════════════════════════════
     9. Ajustes aplicados (condicional)
     ═══════════════════════════════════════ */
  if (ajustesDelPaston.length > 0) {
    sectionHead("Ajustes aplicados durante el pastón");

    const fmtHoraAj = (v) => {
      if (!v) return "—";
      const d = new Date(v);
      if (isNaN(d.getTime())) return String(v);
      return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
    };
    doc.autoTable({
      startY: y,
      head: [["Etapa", "Hora", "Aditivo", "Dosis", "Unidad", "Motivo"]],
      body: ajustesDelPaston.map(a => [
        a.etapa || "OBRA",
        fmtHoraAj(a.fecha),
        a.aditivo?.nombre || `Aditivo #${a.idAditivo}`,
        fmtNum(a.dosis, 3),
        a.unidadDosis || "—",
        a.motivo || "—",
      ]),
      margin: { left: margin, right: margin },
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 1.2 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 14 },
        2: { cellWidth: 40 },
        3: { cellWidth: 18, halign: "right" },
        4: { cellWidth: 18 },
        5: { cellWidth: "auto" },
      },
    });
    y = doc.lastAutoTable.finalY + 7;
  }

  /* ═══════════════════════════════════════
     10. Veredicto de la prueba (siempre AL FINAL del informe)
     Auditoría test49: el veredicto cierra el documento — el lector debe
     ver primero los datos (componentes, mediciones, balance, ajustes) y
     después la conclusión + firmas.
     ═══════════════════════════════════════ */
  if (paston.veredicto) {
    sectionHead("Veredicto de la prueba");

    // Badge de veredicto con color
    const verdColors = {
      APROBADO: { bg: [22, 163, 74], label: "APROBADO" },
      APROBADO_PRELIMINAR: { bg: [29, 78, 216], label: "APROBADO PRELIMINAR" },
      RECHAZADO: { bg: [220, 38, 38], label: "RECHAZADO" },
      OBSERVADO: { bg: [217, 119, 6], label: "OBSERVADO" },
    };
    const vc = verdColors[paston.veredicto] || verdColors.OBSERVADO;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const badgeW = doc.getTextWidth(vc.label) + 6;
    doc.setFillColor(vc.bg[0], vc.bg[1], vc.bg[2]);
    doc.roundedRect(margin, y - 3.2, badgeW, 5, 1, 1, "F");
    doc.setTextColor(...C.white);
    doc.text(vc.label, margin + 3, y);
    y += 5;

    // Nota aclaratoria para APROBADO_PRELIMINAR (audit test53): el veredicto
    // definitivo APROBADO se emite cuando las probetas confirman fc; mientras
    // tanto el preliminar permite arrancar producción a riesgo del cliente.
    if (paston.veredicto === 'APROBADO_PRELIMINAR') {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(...C.muted);
      const nota = "Aprobación preliminar: el hormigón fresco cumplió los criterios de fresco (asentamiento, temperatura, aire, aspecto), pero la aprobación definitiva queda condicionada a los resultados de rotura de probetas.";
      const lns = doc.splitTextToSize(nota, contentW);
      doc.text(lns, margin, y + 1);
      y += lns.length * 3 + 3;
      doc.setFont("helvetica", "normal");
    }

    // Reglas de firma (audit test53):
    //
    //   1. El EMISOR siempre se llena automáticamente con el usuario del
    //      sistema que registra el veredicto — queda impreso digitalmente.
    //   2. El EVALUADOR es opcional. Si queda vacío, se imprime una línea
    //      en blanco para que el operador del ensayo firme y selle a mano
    //      al imprimir el informe.
    //   3. Si el operador completa Evaluador con un nombre que coincide con
    //      el Emisor (misma persona, incluso con variaciones tipo "Asinari"
    //      vs "Gustavo Asinari"), se condensa en UNA sola firma centrada
    //      para no duplicar la rúbrica de la misma persona.
    const evaluadorTxt = (paston.evaluadoPor || "").trim();
    const emisorTxt = (paston.veredictoEmitidoPor || "").trim();
    const mismaPersona = (() => {
      if (!evaluadorTxt || !emisorTxt) return false;
      const tokens = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);
      const ta = tokens(evaluadorTxt), tb = tokens(emisorTxt);
      const [shortT, longT] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      return shortT.every(w => longT.includes(w));
    })();
    const condensarFirma = mismaPersona; // ambos completos + misma persona

    // Datos del veredicto
    doc.setTextColor(...C.text);
    const verdRows = [];
    if (condensarFirma) {
      const nombreCompleto = evaluadorTxt.length >= emisorTxt.length ? evaluadorTxt : emisorTxt;
      verdRows.push(["Firmado por", nombreCompleto]);
    } else {
      if (paston.evaluadoPor) verdRows.push(["Evaluado por", paston.evaluadoPor]);
      else verdRows.push(["Evaluado por", "(firma manual al imprimir)"]);
      if (paston.veredictoEmitidoPor) verdRows.push(["Emitido por", paston.veredictoEmitidoPor]);
    }
    if (paston.fechaVeredicto) {
      const fv = new Date(paston.fechaVeredicto);
      verdRows.push(["Fecha del veredicto", isNaN(fv.getTime()) ? String(paston.fechaVeredicto) : fv.toLocaleDateString("es-AR")]);
    }
    if (paston.observacionesGenerales) verdRows.push(["Observaciones", paston.observacionesGenerales]);

    if (verdRows.length > 0) {
      doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        body: verdRows,
        theme: "plain",
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // Bloque de firma
    const firmaY = y + 6;
    if (firmaY + 22 > doc.internal.pageSize.getHeight() - 15) {
      doc.addPage();
      y = 18;
    }
    const drawFirma = (x, w, label, persona) => {
      doc.setDrawColor(80, 80, 80);
      doc.setLineWidth(0.3);
      doc.line(x + 5, firmaY + 12, x + w - 5, firmaY + 12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...C.text);
      // Si no hay persona, dejamos la línea limpia (para firma/sello manual).
      if (persona && persona.trim()) {
        doc.text(persona, x + w / 2, firmaY + 10, { align: "center" });
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(label, x + w / 2, firmaY + 16, { align: "center" });
    };
    if (condensarFirma) {
      // Una sola firma centrada cuando es la misma persona.
      const w = 80;
      const x = margin + (contentW - w) / 2;
      const nombre = evaluadorTxt.length >= emisorTxt.length ? evaluadorTxt : emisorTxt;
      drawFirma(x, w, "Firma del responsable del veredicto", nombre);
    } else {
      const colW = (doc.internal.pageSize.getWidth() - margin * 2) / 2;
      // Evaluador puede quedar vacío para firma manual.
      drawFirma(margin, colW,
        paston.evaluadoPor ? "Evaluador del pastón" : "Firma y sello del evaluador",
        paston.evaluadoPor);
      drawFirma(margin + colW, colW, "Emisor del veredicto", paston.veredictoEmitidoPor);
    }
    y = firmaY + 22;

    if (paston.fechaVeredicto) {
      const fv = new Date(paston.fechaVeredicto);
      const fechaStr = isNaN(fv.getTime()) ? String(paston.fechaVeredicto) : fv.toLocaleDateString("es-AR");
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`Veredicto emitido el ${fechaStr}`, doc.internal.pageSize.getWidth() / 2, y, { align: "center" });
      y += 6;
    }
  }

  /* ═══════════════════════════════════════
     Renderizar índice en el espacio reservado
     ═══════════════════════════════════════ */
  doc.setPage(tocPage);
  let tocY = tocStartY;

  // Línea separadora decorativa
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.3);
  doc.line(margin, tocY, margin + contentW, tocY);
  tocY += 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...C.primary);
  doc.text("Contenido", margin, tocY);
  tocY += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  // Defensa contra page labels perdidos (audit test52): renderizamos primero
  // el page label, después el title, y validamos que entry.page sea un número
  // válido — si no, usamos el total actual de páginas como fallback razonable.
  const totalPagesNow = doc.internal.getNumberOfPages();
  for (const entry of tocEntries) {
    const label = `${entry.num}. ${entry.title}`;
    const pageNum = Number.isFinite(entry.page) && entry.page > 0 ? entry.page : totalPagesNow;
    const pageLabel = `pág. ${pageNum}`;

    // Page label FIRST (en caso de que algo falle después, queda renderizado)
    doc.setTextColor(...C.muted);
    doc.text(pageLabel, pageW - margin, tocY, { align: "right" });

    // Title después
    doc.setTextColor(...C.text);
    doc.text(label, margin + 2, tocY);

    // Línea punteada entre título y número de página
    const labelEndX = margin + 2 + doc.getTextWidth(label) + 2;
    const pageStartX = pageW - margin - doc.getTextWidth(pageLabel) - 2;
    if (pageStartX > labelEndX) {
      doc.setFillColor(...C.muted);
      const dotSpacing = 1.5;
      for (let dx = labelEndX; dx < pageStartX; dx += dotSpacing) {
        doc.circle(dx, tocY - 0.8, 0.15, "F");
      }
    }

    tocY += 4.5;
  }

  /* ═══════════════════════════════════════
     Footer en todas las páginas
     ═══════════════════════════════════════ */
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.text(
      `Generado por HormiQual — ${new Date().toLocaleString("es-AR", { hour12: false })}`,
      margin,
      pageH - 8,
    );
    doc.text(
      `Pág. ${p} / ${totalPages}`,
      pageW - margin,
      pageH - 8,
      { align: "right" },
    );
  }

  doc.save(`Paston_Prueba_${dateStr.replace(/\//g, "-")}.pdf`);
}
