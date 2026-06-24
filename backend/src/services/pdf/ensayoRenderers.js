// src/services/pdf/ensayoRenderers.js
/**
 * Renderers por tipo de ensayo para el PDF individual y batch.
 *
 * Cada renderer recibe un `doc` (pdfkit), un `data` con la info del ensayo
 * normalizada y un `contexto` con paleta de colores + opciones de impresión.
 * Escribe su sección en `doc` y devuelve void (puede ser async).
 *
 * Registry:
 *   - granulometria:           IRAM1505_GRANULOMETRIA (con gráfico curva + huso o banda IRAM)
 *   - carasFractura:           IRAM1851_CARAS_FRACTURA (dos criterios + tabla por T)
 *   - densidadAbsorcion:       IRAM1520, IRAM1533 (2 valores principales)
 *   - generic:                 fallback para cualquier otro tipo (extrae valor principal + cumple + limitesDNV)
 *
 * Mapeo codigo → renderer en `renderPorCodigo`.
 */

'use strict';

const { renderizarGraficoGranulometria } = require('./granulometriaChart');
const { evaluarCurvaContraHuso } = require('../husoEvalService');

// ═══════════════════════════════════════════════════════════════════════════
// Helpers comunes
// ═══════════════════════════════════════════════════════════════════════════

const C = {
    primary: '#1e40af',
    dark: '#1e293b',
    text: '#334155',
    muted: '#94a3b8',
    border: '#e2e8f0',
    lightBg: '#f8fafc',
    green: '#16a34a',
    orange: '#f97316',
    red: '#dc2626',
    warning: '#b45309',
    warningBg: '#fef3c7',
};

const fmt = {
    num: (v, d = 2) => v == null || isNaN(Number(v)) ? '—' : Number(v).toFixed(d),
    date: (d) => {
        if (!d) return '—';
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return String(d);
        return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },
    bool: (v) => v ? 'Sí' : 'No',
    cumpleColor: (cumple) => ({
        CUMPLE: C.green,
        NO_CUMPLE: C.red,
        NO_EVAL: C.muted,
        PENDIENTE: C.muted,
    }[cumple] || C.text),
};

/** Extrae el valor numérico principal de un resultado JSON via heurística. */
function extraerValorPrincipal(resultado) {
    if (!resultado) return null;
    const claves = [
        'valor', 'pct', 'porcentaje',
        'desgastePct', 'perdidaPct',
        'equivalenteArenaPct', 'eaPct',
        'coeficientePulimento', 'cpa',
        'indiceLajasPct', 'indiceElongacionPct',
        'absorcionPct', 'densidadAparente', 'densidad',
        'polvoAdheridoPct',
        'azulMetilenoGKg', 'mbgKg', 'mb',
        'microDevalPct',
        'superficieCubiertaPct', 'adherenciaPct',
        'relacionSecaHumedaPct',
    ];
    for (const k of claves) {
        if (resultado[k] != null && !isNaN(Number(resultado[k]))) return Number(resultado[k]);
    }
    return null;
}

/** Formatea limitesDNV a texto legible para renderizar como columna. */
function formatearLimiteDNV(limites) {
    if (!limites) return '—';
    const l = typeof limites === 'string' ? JSON.parse(limites) : limites;
    if (l.operador === 'obligatorio') return 'Obligatorio';
    if (l.operador === 'huso_dependiente') return 'Según huso del tramo';
    if (l.operador === 'categorico') return `Debe ser: ${l.valorEsperado ?? '—'}`;

    const op = { max_menor_igual: '≤', min_mayor_igual: '≥' }[l.operador] || '';
    const u = l.unidad ? ` ${l.unidad}` : '';
    const partes = [];
    if (l.limite != null) partes.push(`${op} ${l.limite}${u}`);
    if (l.porClaseTransito) {
        const t = l.porClaseTransito;
        partes.push(['T1', 'T2', 'T3', 'T4'].filter((k) => t[k] != null).map((k) => `${k}: ${op}${t[k]}`).join(' / ') + u);
    }
    if (l.porOrigenRoca) {
        const items = Object.entries(l.porOrigenRoca).map(([k, v]) => `${k.toLowerCase()}: ${op}${v}${u}`);
        partes.push(`(${items.join(', ')})`);
    }
    return partes.length > 0 ? partes.join('  ') : '—';
}

function drawSectionHeader(doc, titulo, subtitulo) {
    const margin = doc.page.margins.left;
    doc.fillColor(C.primary).fontSize(12).font('Helvetica-Bold');
    doc.text(titulo, margin, doc.y);
    if (subtitulo) {
        doc.fillColor(C.muted).fontSize(9).font('Helvetica');
        doc.text(subtitulo, margin, doc.y);
    }
    doc.moveDown(0.2);
    doc.strokeColor(C.border).lineWidth(0.5);
    doc.moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).stroke();
    doc.moveDown(0.2);
}

function drawFila(doc, label, value, valueColor = C.text) {
    const margin = doc.page.margins.left;
    doc.fillColor(C.text).font('Helvetica-Bold').fontSize(9);
    doc.text(label, margin, doc.y, { continued: true, width: 220 });
    doc.fillColor(valueColor).font('Helvetica').text(`  ${value}`);
}

function drawKeyValues(doc, filas) {
    doc.fontSize(9);
    for (const [label, value, color] of filas) {
        drawFila(doc, label, value, color);
    }
}

function drawEnsayoMetadata(doc, ensayo) {
    doc.fillColor(C.muted).fontSize(8).font('Helvetica');

    // "Cumple" solo se muestra si hay evaluación real (CUMPLE / NO_CUMPLE).
    // Cuando el ensayo es TBS-only queda en NO_EVAL y no corresponde mostrarlo
    // acá porque la evaluación contra huso DNV aparece debajo, en su propia
    // sección. PENDIENTE se comporta igual.
    let cumpleLabel = null;
    if (ensayo.cumple === 'CUMPLE' || ensayo.cumple === 'NO_CUMPLE') {
        const etiqueta = ensayo.cumple === 'CUMPLE' ? 'CUMPLE' : 'NO CUMPLE';
        cumpleLabel = `Evaluación IRAM 1627: ${etiqueta}`;
    }

    const parts = [
        `Fecha ensayo: ${fmt.date(ensayo.fechaEnsayo)}`,
        ensayo.fechaVencimiento ? `Vencimiento: ${fmt.date(ensayo.fechaVencimiento)}` : null,
        ensayo.laboratorio ? `Lab: ${ensayo.laboratorio}` : null,
        ensayo.nroInforme ? `Informe: ${ensayo.nroInforme}` : null,
        cumpleLabel,
    ].filter(Boolean);
    doc.text(parts.join('  ·  '), doc.page.margins.left, doc.y);
    doc.moveDown(0.3);
}

// ═══════════════════════════════════════════════════════════════════════════
// Renderer: Granulometría
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Para granulometría, el data incluye:
 *   ensayo: { fechaEnsayo, cumple, contextoAplicacion, resultado: { granulometria: { tamices: [...] } } }
 *   opciones: {
 *     contextos: ['HORMIGON' | 'TBS'],         // uno o ambos
 *     idHusoDNV?: number,                        // requerido si 'TBS' en contextos
 *     husoDNV?: { codigo, tmnMm, puntos },       // preloaded
 *     bandasIRAM?: { bandaA, bandaB, bandaC },   // preloaded (si HORMIGON)
 *     warningMismatchSerie?: string,             // texto si la serie del ensayo no matchea el contexto
 *   }
 */
async function renderGranulometria(doc, { ensayo, opciones = {} }) {
    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width - margin * 2;
    const g = ensayo.resultado?.granulometria || {};
    const tamices = (g.tamices || []).filter((t) => t.habilitado !== false);
    const contextos = opciones.contextos?.length ? opciones.contextos : ['HORMIGON'];

    // Título con formato amigable: "Granulometría — IRAM 1505" (antes era código
    // interno + nombre, que resultaba confuso en la lectura).
    const titulo = ensayo.tipoNombre || 'Granulometría';
    const norma = ensayo.tipoNormaRef || 'IRAM 1505';
    drawSectionHeader(doc, norma ? `${titulo} — ${norma}` : titulo);
    drawEnsayoMetadata(doc, ensayo);

    doc.moveDown(0.3);

    // Banner del contexto de impresión — dominante para que sea obvio qué vistas se generaron
    const etiquetasCtx = { HORMIGON: 'Hormigón (IRAM 1627)', TBS: 'TBS (Huso DNV)' };
    const textoContextos = contextos.map((c) => etiquetasCtx[c] || c).join(' · ');
    doc.save();
    const bannerY = doc.y;
    doc.fillColor('#eff6ff').rect(margin, bannerY, pageWidth, 22).fill();
    doc.fillColor(C.primary).fontSize(9).font('Helvetica-Bold');
    doc.text(`Impresión: ${textoContextos}`, margin + 8, bannerY + 6, { width: pageWidth - 16 });
    doc.restore();
    doc.y = bannerY + 28;

    if (opciones.warningMismatchSerie) {
        doc.fillColor(C.warning).fontSize(8).font('Helvetica-Oblique');
        doc.text(`⚠ ${opciones.warningMismatchSerie}`, margin, doc.y, { width: pageWidth });
        doc.fillColor(C.text);
        doc.moveDown(0.4);
    }
    if (opciones.warningAptitudAgregado) {
        doc.fillColor(C.warning).fontSize(8).font('Helvetica-Oblique');
        doc.text(`⚠ ${opciones.warningAptitudAgregado}`, margin, doc.y, { width: pageWidth });
        doc.fillColor(C.text);
        doc.moveDown(0.4);
    }

    doc.moveDown(0.3);

    // Tabla de tamices
    const colTamiz = margin;
    const colAb = margin + 90;
    const colPasa = margin + 175;
    const colRet = margin + 235;
    const colAcum = margin + 310;
    const tableWidth = 385;
    const ROW_H = 14;

    const headerY = doc.y;
    // Header con fondo más saturado
    doc.fillColor('#dbeafe').rect(margin, headerY - 2, tableWidth, ROW_H + 2).fill();
    doc.fillColor(C.primary).fontSize(8).font('Helvetica-Bold');
    doc.text('Tamiz', colTamiz + 4, headerY + 2, { width: 85 });
    doc.text('Abertura (mm)', colAb, headerY + 2, { width: 80 });
    doc.text('% pasa', colPasa, headerY + 2, { width: 55 });
    doc.text('% ret. parc.', colRet, headerY + 2, { width: 70 });
    doc.text('% ret. acum.', colAcum, headerY + 2, { width: 70 });
    doc.y = headerY + ROW_H;

    doc.strokeColor(C.border).lineWidth(0.4);
    doc.moveTo(margin, doc.y).lineTo(margin + tableWidth, doc.y).stroke();

    doc.fontSize(8).font('Helvetica');
    for (let idx = 0; idx < tamices.length; idx++) {
        const t = tamices[idx];
        if (doc.y > doc.page.height - 100) doc.addPage();
        const rowTop = doc.y;
        // Zebra: filas pares con fondo gris muy suave
        if (idx % 2 === 1) {
            doc.fillColor('#f8fafc').rect(margin, rowTop, tableWidth, ROW_H).fill();
        }
        doc.fillColor(C.text);
        const y0 = rowTop + 3;
        doc.text(t.tamiz || '—', colTamiz + 4, y0, { width: 85 });
        doc.text(fmt.num(t.aberturaMm, 2), colAb, y0, { width: 80 });
        doc.text(fmt.num(t.pasaPct, 1), colPasa, y0, { width: 55 });
        doc.text(fmt.num(t.retenidoParcialPct, 1), colRet, y0, { width: 70 });
        doc.text(fmt.num(t.retenidoAcumPct, 1), colAcum, y0, { width: 70 });
        doc.y = rowTop + ROW_H;
        // Línea divisoria suave
        doc.strokeColor(C.border).lineWidth(0.2);
        doc.moveTo(margin, doc.y).lineTo(margin + tableWidth, doc.y).stroke();
    }
    doc.moveDown(0.6);

    // Módulo finura / TMN si están calculados
    if (g.reportado) {
        const r = g.reportado;
        doc.fillColor(C.muted).fontSize(8).font('Helvetica');
        const reportadoParts = [];
        if (r.moduloFinura != null) reportadoParts.push(`MF: ${fmt.num(r.moduloFinura, 2)}`);
        if (r.tmnMm != null) reportadoParts.push(`TMN: ${fmt.num(r.tmnMm, 2)} mm`);
        if (reportadoParts.length) doc.text(reportadoParts.join('  ·  '), margin, doc.y);
        doc.moveDown(0.6);
    } else {
        doc.moveDown(0.4);
    }

    // Gráficos por contexto
    // Helper para dibujar un gráfico con altura conocida y avanzar el cursor correctamente
    // (pdfkit no avanza doc.y cuando recibe coordenadas absolutas).
    //
    // El canvas del renderer es 900×480 px (aspect 900/480 = 1.875).
    // Mantengo ese aspect en la inserción para que no se deforme.
    const CHART_W = pageWidth * 0.88;
    const CHART_H = CHART_W * (480 / 900);

    const drawChart = async (titulo, buffer) => {
        if (doc.y + CHART_H + 50 > doc.page.height - doc.page.margins.bottom) doc.addPage();
        doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold');
        doc.text(titulo, margin, doc.y);
        doc.moveDown(0.4);
        const imgX = margin + (pageWidth - CHART_W) / 2;
        const imgY = doc.y;
        doc.image(buffer, imgX, imgY, { width: CHART_W, height: CHART_H });
        doc.y = imgY + CHART_H + 16;
    };

    for (const ctx of contextos) {
        if (ctx === 'TBS' && opciones.husoDNV) {
            const curvaEnsayo = tamices
                .filter((t) => t.pasaPct != null)
                .map((t) => ({ aberturaMm: Number(t.aberturaMm), pasaPct: Number(t.pasaPct) }));
            try {
                const img = await renderizarGraficoGranulometria({
                    tamicesReferencia: opciones.husoDNV.puntos,
                    curva: curvaEnsayo,
                    banda: opciones.husoDNV.puntos,
                    // El foco del gráfico es el huso apuntado → labels del eje X
                    // restringidas a sus aberturas para evitar solape con la
                    // serie completa TBS-DNV (12.5/13.2/16, 25/26.5, etc.).
                    husoAberturas: opciones.husoDNV.puntos
                        .map((p) => Number(p.aberturaMm))
                        .filter((n) => !isNaN(n)),
                    etiquetaCurva: 'Curva medida',
                    etiquetaBanda: 'Huso DNV',
                });
                await drawChart(`Curva vs Huso DNV ${opciones.husoDNV.codigo}`, img);
            } catch (e) {
                doc.fillColor(C.red).fontSize(9).text(`No se pudo generar el gráfico TBS: ${e.message}`);
                doc.fillColor(C.text);
                doc.moveDown(0.3);
            }

            // Evaluación contra huso DNV
            try {
                const evalHuso = evaluarCurvaContraHuso(curvaEnsayo, opciones.husoDNV.puntos);
                drawEvaluacionHuso(doc, evalHuso, opciones.husoDNV.codigo);
            } catch (e) {
                doc.fillColor(C.red).fontSize(9).text(`No se pudo evaluar vs huso: ${e.message}`);
                doc.fillColor(C.text);
            }
        }

        if (ctx === 'HORMIGON' && opciones.bandasIRAM) {
            try {
                const banda = opciones.bandasIRAM.envolvente || opciones.bandasIRAM.bandaA || [];
                const tamicesRef = banda.length > 0
                    ? banda
                    : tamices.map((t) => ({ aberturaMm: Number(t.aberturaMm), designacion: t.tamiz }));
                const img = await renderizarGraficoGranulometria({
                    tamicesReferencia: tamicesRef,
                    curva: tamices.filter((t) => t.pasaPct != null).map((t) => ({ aberturaMm: Number(t.aberturaMm), pasaPct: Number(t.pasaPct) })),
                    banda: banda.length > 0 ? banda : null,
                    etiquetaCurva: 'Curva medida',
                    etiquetaBanda: 'Banda IRAM 1627',
                });
                await drawChart('Curva vs bandas IRAM 1627', img);
            } catch (e) {
                doc.fillColor(C.red).fontSize(9).text(`No se pudo generar el gráfico Hormigón: ${e.message}`);
                doc.fillColor(C.text);
                doc.moveDown(0.3);
            }
        }
        if (ctx === 'HORMIGON' && !opciones.bandasIRAM) {
            // No hay banda IRAM cargada — ploteamos solo la curva medida
            try {
                const tamicesRef = tamices.map((t) => ({ aberturaMm: Number(t.aberturaMm), designacion: t.tamiz }));
                const img = await renderizarGraficoGranulometria({
                    tamicesReferencia: tamicesRef,
                    curva: tamices.filter((t) => t.pasaPct != null).map((t) => ({ aberturaMm: Number(t.aberturaMm), pasaPct: Number(t.pasaPct) })),
                    banda: null,
                    etiquetaCurva: 'Curva medida',
                });
                await drawChart('Curva medida (sin banda de referencia)', img);
            } catch (e) {
                doc.fillColor(C.red).fontSize(9).text(`No se pudo generar el gráfico: ${e.message}`);
                doc.fillColor(C.text);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Renderer: Caras de fractura (IRAM 1851) — dos criterios
// ═══════════════════════════════════════════════════════════════════════════

async function renderCarasFractura(doc, { ensayo }) {
    const margin = doc.page.margins.left;
    drawSectionHeader(doc, ensayo.tipoNormaRef ? `${ensayo.tipoNombre} — ${ensayo.tipoNormaRef}` : (ensayo.tipoNombre || ensayo.tipoCodigo));
    drawEnsayoMetadata(doc, ensayo);

    const r = ensayo.resultado || {};
    const porcMin3Caras = r.porcentajeMin3Caras ?? r.porc3Caras ?? r.valor3Caras ?? null;
    const porcMin1Cara = r.porcentajeMin1Cara ?? r.porc1Cara ?? r.valor1Cara ?? null;

    drawKeyValues(doc, [
        ['% con ≥ 3 caras de fractura', fmt.num(porcMin3Caras, 1) + ' %'],
        ['% con ≥ 1 cara de fractura', fmt.num(porcMin1Cara, 1) + ' %'],
    ]);

    // Mostrar límites DNV por T1-T4 si los hay
    const limites = ensayo.limitesDNV;
    if (limites?.criterios) {
        doc.moveDown(0.3);
        doc.fillColor(C.dark).fontSize(9).font('Helvetica-Bold');
        doc.text('Criterios DNV:', margin, doc.y);
        doc.fillColor(C.muted).font('Helvetica').fontSize(8);
        for (const c of limites.criterios) {
            doc.text(`• ${c.descripcion}: ${formatearLimiteDNV(c)}`, margin + 10, doc.y);
        }
        doc.fillColor(C.text);
    }
    doc.moveDown(0.3);
}

// ═══════════════════════════════════════════════════════════════════════════
// Renderer: Densidad + Absorción (IRAM 1520 / 1533)
// ═══════════════════════════════════════════════════════════════════════════

async function renderDensidadAbsorcion(doc, { ensayo }) {
    drawSectionHeader(doc, ensayo.tipoNormaRef ? `${ensayo.tipoNombre} — ${ensayo.tipoNormaRef}` : (ensayo.tipoNombre || ensayo.tipoCodigo));
    drawEnsayoMetadata(doc, ensayo);

    const r = ensayo.resultado || {};
    const filas = [
        ['Densidad relativa', fmt.num(r.densidadRelativa ?? r.densidad, 3)],
        ['Densidad SSS', fmt.num(r.densidadSSS ?? r.densidadRelativaSSS, 3)],
        ['Densidad aparente', fmt.num(r.densidadAparente, 3)],
        ['Absorción (%)', fmt.num(r.absorcionPct ?? r.absorcion, 2)],
    ].filter((f) => f[1] !== '—');

    drawKeyValues(doc, filas);

    if (ensayo.limitesDNV) {
        doc.moveDown(0.2);
        drawFila(doc, 'Límite DNV', formatearLimiteDNV(ensayo.limitesDNV));
    }
    doc.moveDown(0.3);
}

// ═══════════════════════════════════════════════════════════════════════════
// Renderer: Genérico (fallback)
// ═══════════════════════════════════════════════════════════════════════════

async function renderGenericoEnsayo(doc, { ensayo }) {
    drawSectionHeader(doc, ensayo.tipoNormaRef ? `${ensayo.tipoNombre} — ${ensayo.tipoNormaRef}` : (ensayo.tipoNombre || ensayo.tipoCodigo));
    drawEnsayoMetadata(doc, ensayo);

    const r = ensayo.resultado || {};
    const valorPrincipal = extraerValorPrincipal(r);

    const filas = [];
    if (valorPrincipal != null) {
        const unidad = ensayo.limitesDNV?.unidad || r.unidad || '';
        filas.push(['Valor', `${fmt.num(valorPrincipal, 2)} ${unidad}`.trim()]);
    }

    // Limite DNV
    if (ensayo.limitesDNV) {
        filas.push(['Límite DNV', formatearLimiteDNV(ensayo.limitesDNV)]);
    }
    if (ensayo.tipoNormaRef) {
        filas.push(['Norma', ensayo.tipoNormaRef]);
    }

    // Otros campos numéricos del resultado, si los hay
    const extrasConocidos = new Set([
        'valor', 'unidad', '_evaluacion', '_evaluacionContexto', '_warnings',
        'granulometria', 'porcentajeMin3Caras', 'porc3Caras', 'valor3Caras',
        'porcentajeMin1Cara', 'porc1Cara', 'valor1Cara',
    ]);
    const otrosKeys = Object.keys(r).filter((k) => !extrasConocidos.has(k) && !k.startsWith('_'));
    for (const k of otrosKeys) {
        const v = r[k];
        if (v == null || typeof v === 'object') continue;
        if (typeof v === 'number') filas.push([k, fmt.num(v, 3)]);
        else filas.push([k, String(v)]);
    }

    drawKeyValues(doc, filas);
    doc.moveDown(0.3);

    if (ensayo.observaciones) {
        doc.fillColor(C.muted).fontSize(8).font('Helvetica-Oblique');
        doc.text(`Observaciones: ${ensayo.observaciones}`, doc.page.margins.left);
        doc.fillColor(C.text);
        doc.moveDown(0.2);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper de evaluación (tabla por tamiz + veredicto global)
// ═══════════════════════════════════════════════════════════════════════════

function drawEvaluacionHuso(doc, evaluacion, husoCodigo) {
    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width - margin * 2;

    if (doc.y > doc.page.height - 220) doc.addPage();

    doc.fillColor(C.dark).fontSize(10).font('Helvetica-Bold');
    doc.text(`Evaluación contra Huso DNV ${husoCodigo}`, margin, doc.y);
    doc.moveDown(0.3);

    // Tabla: tamiz | % pasa medido | Rango huso | Estado
    const colTam = margin;
    const colPasa = margin + 100;
    const colRango = margin + 180;
    const colEstado = margin + 290;
    const tableWidth = 420;
    const ROW_H = 14;

    const headerY = doc.y;
    doc.fillColor('#dbeafe').rect(margin, headerY - 2, tableWidth, ROW_H + 2).fill();
    doc.fillColor(C.primary).fontSize(8).font('Helvetica-Bold');
    doc.text('Tamiz', colTam + 4, headerY + 2, { width: 95 });
    doc.text('% pasa medido', colPasa, headerY + 2, { width: 75 });
    doc.text('Rango huso', colRango, headerY + 2, { width: 105 });
    doc.text('Estado', colEstado, headerY + 2, { width: 125 });
    doc.y = headerY + ROW_H;

    doc.strokeColor(C.border).lineWidth(0.4);
    doc.moveTo(margin, doc.y).lineTo(margin + tableWidth, doc.y).stroke();

    doc.fontSize(8).font('Helvetica');
    let hayInterpolados = false;
    for (let i = 0; i < evaluacion.filas.length; i++) {
        const f = evaluacion.filas[i];
        if (f.interpolado) hayInterpolados = true;
        if (doc.y > doc.page.height - 80) doc.addPage();
        const rowTop = doc.y;
        if (i % 2 === 1) {
            doc.fillColor('#f8fafc').rect(margin, rowTop, tableWidth, ROW_H).fill();
        }
        const y0 = rowTop + 3;
        const tamLabel = f.designacion || `${f.aberturaMm} mm`;
        const rangoLabel = `${fmt.num(f.min, 0)}–${fmt.num(f.max, 0)}%`;

        let estadoColor = C.green;
        let estadoText = '✓ Cumple';
        if (!f.cumple) {
            estadoColor = C.red;
            if (f.motivo === 'por_debajo') estadoText = `✗ Por debajo (${fmt.num(f.desvio, 1)})`;
            else if (f.motivo === 'por_encima') estadoText = `✗ Por encima (+${fmt.num(f.desvio, 1)})`;
            else if (f.motivo === 'sin_dato') estadoText = '○ Sin dato';
        }

        doc.fillColor(C.text).font('Helvetica');
        doc.text(tamLabel, colTam + 4, y0, { width: 95 });

        // Celda % pasa: valores medidos en normal, interpolados en itálica muted
        // con etiqueta "(interp.)" para que sea obvio el origen.
        if (f.pasaMedido == null) {
            doc.fillColor(C.muted).text('—', colPasa, y0, { width: 75 });
        } else if (f.interpolado) {
            doc.fillColor(C.muted).font('Helvetica-Oblique');
            doc.text(`${fmt.num(f.pasaMedido, 1)}  (interp.)`, colPasa, y0, { width: 75 });
            doc.font('Helvetica').fillColor(C.text);
        } else {
            doc.font('Helvetica-Bold');
            doc.text(fmt.num(f.pasaMedido, 1), colPasa, y0, { width: 75 });
            doc.font('Helvetica');
        }

        doc.fillColor(C.text).text(rangoLabel, colRango, y0, { width: 105 });
        doc.fillColor(estadoColor).font('Helvetica-Bold');
        doc.text(estadoText, colEstado, y0, { width: 125 });
        doc.fillColor(C.text).font('Helvetica');
        doc.y = rowTop + ROW_H;
        doc.strokeColor(C.border).lineWidth(0.2);
        doc.moveTo(margin, doc.y).lineTo(margin + tableWidth, doc.y).stroke();
    }
    doc.moveDown(0.3);

    // Leyenda aclarando la convención de valores interpolados
    if (hayInterpolados) {
        doc.fillColor(C.muted).fontSize(7.5).font('Helvetica-Oblique');
        doc.text(
            'Los valores en itálica (interp.) son interpolados logarítmicamente desde los tamices medidos adyacentes, ' +
            'porque el tamiz del huso no está en la serie usada en el ensayo. Cuentan en la evaluación de cumplimiento.',
            margin, doc.y, { width: pageWidth },
        );
        doc.fillColor(C.text).font('Helvetica');
        doc.moveDown(0.4);
    } else {
        doc.moveDown(0.1);
    }

    // Veredicto global
    const veredictoColor = evaluacion.cumple ? C.green : C.red;
    const veredictoBg = evaluacion.cumple ? '#f0fdf4' : '#fef2f2';
    const verBox = doc.y;
    doc.fillColor(veredictoBg).rect(margin, verBox, pageWidth, 24).fill();
    doc.fillColor(veredictoColor).fontSize(10).font('Helvetica-Bold');
    const textoVer = evaluacion.cumple
        ? '✓ La curva cumple con el huso DNV en todos los tamices.'
        : `✗ La curva NO cumple con el huso DNV — ${evaluacion.violaciones.length} tamiz${evaluacion.violaciones.length !== 1 ? 'es' : ''} fuera del rango.`;
    doc.text(textoVer, margin + 8, verBox + 7, { width: pageWidth - 16 });
    doc.fillColor(C.text).font('Helvetica');
    doc.y = verBox + 28;
    doc.moveDown(0.3);
}

// ═══════════════════════════════════════════════════════════════════════════
// Registry + dispatcher
// ═══════════════════════════════════════════════════════════════════════════

const REGISTRY = {
    IRAM1505_GRANULOMETRIA: renderGranulometria,
    IRAM1851_CARAS_FRACTURA: renderCarasFractura,
    IRAM1520_DENSIDAD_ABSORCION_FINO: renderDensidadAbsorcion,
    IRAM1533_DENSIDAD_GRUESO: renderDensidadAbsorcion,
};

async function renderPorCodigo(doc, ctx) {
    const codigo = ctx.ensayo?.tipoCodigo;
    const renderer = REGISTRY[codigo] || renderGenericoEnsayo;
    await renderer(doc, ctx);
}

module.exports = {
    renderPorCodigo,
    renderGranulometria,
    renderGenericoEnsayo,
    // Helpers exportados para testing
    extraerValorPrincipal,
    formatearLimiteDNV,
};
