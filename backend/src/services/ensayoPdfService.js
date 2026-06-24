// src/services/ensayoPdfService.js
/**
 * Generador de PDFs para ensayos individuales de agregados + batch.
 *
 * API:
 *   - generarPdfEnsayoIndividual(db, idAgregadoEnsayo, opciones)
 *       Devuelve Buffer con header del agregado + una sección del ensayo.
 *
 *   - generarPdfEnsayosBatch(db, { idAgregado, ensayos, opcionesGlobales })
 *       Devuelve Buffer con header del agregado + N secciones (una por ensayo).
 *
 * Opciones por ensayo (aplican a granulometría):
 *   { contextos: ['HORMIGON', 'TBS'], idHusoDNV?: number }
 */

'use strict';

const PDFDocument = require('pdfkit');
const { renderPorCodigo } = require('./pdf/ensayoRenderers');

const C = {
    primary: '#1e40af',
    dark: '#1e293b',
    text: '#334155',
    muted: '#94a3b8',
    border: '#e2e8f0',
    green: '#16a34a',
    warning: '#b45309',
};

const fmt = {
    date: (d) => {
        if (!d) return '—';
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return String(d);
        return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },
    num: (v, d = 2) => v == null || isNaN(Number(v)) ? '—' : Number(v).toFixed(d),
};

// ─── Carga de datos ───────────────────────────────────────────────────────

async function cargarAgregado(db, idAgregado) {
    const ag = await db.Agregado.findByPk(idAgregado, {
        include: [
            { model: db.AgregadoFino, as: 'agregadoFino', required: false },
            { model: db.AgregadoGrueso, as: 'agregadoGrueso', required: false },
            { model: db.Planta, as: 'planta', required: false },
        ],
    });
    if (!ag) throw new Error(`Agregado #${idAgregado} no encontrado`);

    const categoria = ag.agregadoFino ? 'FINO' : (ag.agregadoGrueso ? 'GRUESO' : null);

    // Auditoría 01-calidad C15 (sesión 2026-05-07): unificar fuente de
    // densidad/absorción con la ficha técnica del frontend, que usa el
    // último ensayo IRAM 1520 (AF) o IRAM 1533 (AG). Antes este service
    // usaba `ag.densidad` legacy de la raíz del modelo Agregado, que no
    // se actualiza al ingresar nuevos ensayos. Si existe ensayo, prevalece;
    // sino fallback al legacy.
    let densidadFromEnsayo = null;
    let absorcionFromEnsayo = null;
    if (categoria && db.AgregadoEnsayo && db.AgregadoEnsayoTipo) {
        try {
            const codigoBuscado = categoria === 'FINO'
                ? 'IRAM1520_DENSIDAD_ABSORCION_FINO'
                : 'IRAM1533_DENSIDAD_GRUESO';
            const ensayo = await db.AgregadoEnsayo.findOne({
                where: { legacyAgregadoId: idAgregado, isActive: true },
                include: [{
                    model: db.AgregadoEnsayoTipo,
                    as: 'tipo',
                    where: { codigo: codigoBuscado },
                    required: true,
                }],
                order: [['fechaEnsayo', 'DESC']],
            });
            if (ensayo?.resultado) {
                let r = ensayo.resultado;
                if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
                if (r) {
                    densidadFromEnsayo = r.densidadRelativaAparenteSSS ?? r.densidadRelativaReal ?? null;
                    absorcionFromEnsayo = r.absorcionPct ?? null;
                }
            }
        } catch { /* fallback a legacy si lookup falla */ }
    }

    return {
        idAgregado: ag.idAgregado,
        nombre: ag.nombre,
        origen: ag.origen,
        densidad: densidadFromEnsayo ?? ag.densidad,
        densidadFuente: densidadFromEnsayo != null ? 'ensayo' : (ag.densidad != null ? 'legacy' : null),
        absorcion: absorcionFromEnsayo ?? ag.absorcion,
        absorcionFuente: absorcionFromEnsayo != null ? 'ensayo' : (ag.absorcion != null ? 'legacy' : null),
        moduloFinura: ag.moduloFinura,
        ida: ag.ida,
        idaModo: ag.idaModo,
        aptitudes: Array.isArray(ag.aptitudes) ? ag.aptitudes : (() => { try { return JSON.parse(ag.aptitudes); } catch { return []; } })(),
        origenRoca: ag.origenRoca,
        esCalizo: !!ag.esCalizo,
        categoria,
        planta: ag.planta?.nombre ?? null,
    };
}

async function cargarEnsayoConTipo(db, idAgregadoEnsayo) {
    const e = await db.AgregadoEnsayo.findByPk(idAgregadoEnsayo, {
        include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
    });
    if (!e) throw new Error(`AgregadoEnsayo #${idAgregadoEnsayo} no encontrado`);

    let resultado = e.resultado;
    if (typeof resultado === 'string') {
        try { resultado = JSON.parse(resultado); } catch { resultado = null; }
    }

    let limites = e.tipo?.limitesDNV;
    if (typeof limites === 'string') {
        try { limites = limites ? JSON.parse(limites) : null; } catch { limites = null; }
    }

    return {
        idAgregadoEnsayo: e.idAgregadoEnsayo,
        legacyAgregadoId: e.legacyAgregadoId,
        fechaEnsayo: e.fechaEnsayo,
        fechaVencimiento: e.fechaVencimiento,
        laboratorio: e.laboratorio,
        nroInforme: e.nroInforme,
        observaciones: e.observaciones,
        cumple: e.cumple,
        contextoAplicacion: e.contextoAplicacion,
        resultado,
        tipoCodigo: e.tipo?.codigo,
        tipoNombre: e.tipo?.nombre,
        tipoNormaRef: e.tipo?.normaRef,
        limitesDNV: limites,
    };
}

async function cargarHusoDNV(db, idHusoDNV) {
    if (!idHusoDNV) return null;
    const huso = await db.HusoDNV.findByPk(idHusoDNV, {
        include: [{ model: db.HusoDNVPunto, as: 'puntos', include: [{ model: db.Tamiz, as: 'tamiz' }] }],
    });
    if (!huso) return null;
    return {
        idHusoDNV: huso.idHusoDNV,
        codigo: huso.codigo,
        nombre: huso.nombre,
        tipoTBS: huso.tipoTBS,
        capa: huso.capa,
        tmnMm: Number(huso.tmnMm),
        puntos: (huso.puntos || []).map((p) => ({
            aberturaMm: Number(p.tamiz?.aberturaMm),
            designacion: p.tamiz?.designacion,
            pasaPctMin: Number(p.pasaPctMin),
            pasaPctMax: Number(p.pasaPctMax),
        })).sort((a, b) => (b.aberturaMm ?? 0) - (a.aberturaMm ?? 0)),
    };
}

// ─── Warning: curva vs serie esperada ────────────────────────────────────

function detectarMismatchSerieTamices(ensayo, contextos) {
    if (!contextos?.includes('TBS')) return null;
    const serie = ensayo.resultado?.granulometria?.serieTamices;
    if (serie && serie !== 'TBS_DNV') {
        return `La curva fue cargada con serie ${serie} (no TBS-DNV). El gráfico vs huso DNV interpola desde los tamices disponibles; puede no reflejar exactamente los tamices del Pliego.`;
    }
    return null;
}

// ─── Drawers del header del agregado ─────────────────────────────────────

function drawHeaderAgregado(doc, agregado) {
    const margin = doc.page.margins.left;
    const top = doc.page.margins.top;

    doc.fillColor(C.primary).fontSize(18).font('Helvetica-Bold');
    doc.text(agregado.nombre || `Agregado #${agregado.idAgregado}`, margin, top);

    doc.fillColor(C.muted).fontSize(9).font('Helvetica');
    const sub = [
        agregado.categoria ? `Categoría: ${agregado.categoria}` : null,
        agregado.planta ? `Planta: ${agregado.planta}` : null,
        agregado.origen ? `Origen: ${agregado.origen}` : null,
    ].filter(Boolean).join('  ·  ');
    if (sub) doc.text(sub, margin, top + 24);

    // Propiedades clave
    doc.fillColor(C.text).fontSize(9).font('Helvetica');
    const props = [
        agregado.densidad != null ? `δ = ${fmt.num(agregado.densidad, 2)} g/cm³` : null,
        agregado.absorcion != null ? `Abs. ${fmt.num(agregado.absorcion, 2)}%` : null,
        agregado.moduloFinura != null ? `MF ${fmt.num(agregado.moduloFinura, 2)}` : null,
        agregado.origenRoca ? `Origen roca: ${agregado.origenRoca}` : null,
        agregado.esCalizo ? 'CALIZO' : null,
    ].filter(Boolean).join('  ·  ');
    if (props) doc.text(props, margin, top + 42);

    // Aptitudes (informativo, tono muted)
    const aptLabels = { HORMIGON: 'Hormigón', TBS_RODAMIENTO: 'TBS rodamiento', TBS_NO_RODAMIENTO: 'TBS no rodamiento' };
    const aptText = (agregado.aptitudes || []).map((a) => aptLabels[a] || a).join(' · ');
    if (aptText) {
        doc.fillColor(C.muted).fontSize(8).font('Helvetica');
        doc.text(`Aptitudes declaradas: ${aptText}`, margin, top + 58);
    }

    doc.fillColor(C.text);
    doc.strokeColor(C.border).lineWidth(1);
    doc.moveTo(margin, top + 78).lineTo(doc.page.width - margin, top + 78).stroke();
    doc.y = top + 88;
}

function drawFooter(doc) {
    const margin = doc.page.margins.left;
    if (doc.y > doc.page.height - 50) doc.addPage();
    doc.moveDown(0.5);
    doc.strokeColor(C.border).lineWidth(0.8);
    doc.moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).stroke();
    doc.moveDown(0.3);
    doc.fillColor(C.muted).fontSize(8).font('Helvetica');
    doc.text(`Documento generado el ${fmt.date(new Date())}  ·  HormiQual`, margin);
}

// PR9.3 — Banner del modo de evaluación dual.
// PRESTACIONAL (default): catálogo del tenant soberano. Banner discreto.
// PRESCRIPTIVO: verificación normativa estricta. Banner destacado.
function drawBannerModoEvaluacion(doc, modoEvaluacion) {
    const modo = String(modoEvaluacion || 'PRESTACIONAL').toUpperCase() === 'PRESCRIPTIVO'
        ? 'PRESCRIPTIVO'
        : 'PRESTACIONAL';
    const margin = doc.page.margins.left;
    const w = doc.page.width - 2 * margin;
    const startY = doc.y;

    if (modo === 'PRESCRIPTIVO') {
        doc.save();
        doc.fillColor('#fff3cd').strokeColor('#dcaa32').lineWidth(0.8);
        doc.rect(margin, startY, w, 22).fillAndStroke();
        doc.fillColor('#856404').fontSize(8).font('Helvetica-Bold');
        doc.text('VERIFICACIÓN NORMATIVA ESTRICTA', margin + 4, startY + 4, { width: w - 8 });
        doc.fontSize(7).font('Helvetica');
        doc.text('Aplica todas las exigencias de CIRSOC 200:2024 e IRAM. Puede señalar verificaciones más amplias que las del plan de control de calidad habitual de la planta.',
            margin + 4, startY + 12, { width: w - 8 });
        doc.restore();
        doc.y = startY + 26;
    } else {
        doc.save();
        doc.fillColor('#e8f4fa').strokeColor('#b4d2e6').lineWidth(0.5);
        doc.rect(margin, startY, w, 14).fillAndStroke();
        doc.fillColor('#3c5a78').fontSize(7).font('Helvetica');
        doc.text('Evaluación según el plan de control de calidad de la planta productora.',
            margin + 4, startY + 4, { width: w - 8 });
        doc.restore();
        doc.y = startY + 18;
    }
    doc.fillColor(C.text);
}

// ─── Entry points ─────────────────────────────────────────────────────────

async function _renderEnsayoSection(doc, { db, idAgregadoEnsayo, opciones = {}, agregado = null }) {
    const ensayo = await cargarEnsayoConTipo(db, idAgregadoEnsayo);

    // Para granulometría, preparar huso + bandas según contextos
    const ctx = { ensayo, opciones: { ...opciones } };
    if (ensayo.tipoCodigo === 'IRAM1505_GRANULOMETRIA') {
        const contextos = opciones.contextos?.length ? opciones.contextos : ['HORMIGON'];
        ctx.opciones.contextos = contextos;
        if (contextos.includes('TBS') && opciones.idHusoDNV) {
            ctx.opciones.husoDNV = await cargarHusoDNV(db, opciones.idHusoDNV);
        }
        if (contextos.includes('HORMIGON')) {
            // Bandas IRAM: por ahora enviamos solo la envolvente a partir de los tamices
            // del ensayo. Una futura mejora sería cargar las bandas oficiales A/B/C
            // desde CurvaGranulometrica cuando estén parametrizadas.
            ctx.opciones.bandasIRAM = null; // dibuja curva sin banda si no hay data
        }
        ctx.opciones.warningMismatchSerie = detectarMismatchSerieTamices(ensayo, contextos);

        // Warning si las aptitudes del agregado no matchean los contextos pedidos
        if (agregado) {
            const apt = agregado.aptitudes || [];
            const warnings = [];
            if (contextos.includes('TBS') && !apt.some((a) => typeof a === 'string' && a.startsWith('TBS'))) {
                warnings.push('El agregado no tiene aptitudes TBS declaradas en su ficha. Al imprimir en contexto TBS conviene actualizar las aptitudes del agregado antes de usarlo en una Dotación de Obra.');
            }
            if (contextos.includes('HORMIGON') && !apt.includes('HORMIGON')) {
                warnings.push('El agregado no declara aptitud HORMIGON en su ficha.');
            }
            if (warnings.length > 0) {
                ctx.opciones.warningAptitudAgregado = warnings.join(' ');
            }
        }
    }

    await renderPorCodigo(doc, ctx);
}

/**
 * PDF de un único ensayo con header del agregado.
 *
 * @param {Object} opciones - Opciones del ensayo. Acepta `modoEvaluacion`
 *   ('PRESTACIONAL' default | 'PRESCRIPTIVO') para banner PR9.3.
 */
async function generarPdfEnsayoIndividual(db, idAgregadoEnsayo, opciones = {}) {
    const ensayo = await cargarEnsayoConTipo(db, idAgregadoEnsayo);
    const agregado = await cargarAgregado(db, ensayo.legacyAgregadoId);

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
            Title: `Ensayo ${ensayo.tipoCodigo || idAgregadoEnsayo} — ${agregado.nombre || 'Agregado'}`,
            Author: 'HormiQual',
        },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on('end', resolve));

    drawHeaderAgregado(doc, agregado);
    drawBannerModoEvaluacion(doc, opciones.modoEvaluacion);
    await _renderEnsayoSection(doc, { db, idAgregadoEnsayo, opciones, agregado });
    drawFooter(doc);

    doc.end();
    await done;
    return Buffer.concat(chunks);
}

/**
 * PDF batch: header del agregado + múltiples ensayos.
 *
 * @param {Object} params
 * @param {number} params.idAgregado
 * @param {Array<{idAgregadoEnsayo, opciones?}>} params.ensayos
 * @param {string} [params.modoEvaluacion] - 'PRESTACIONAL' (default) | 'PRESCRIPTIVO' (PR9.3).
 */
async function generarPdfEnsayosBatch(db, { idAgregado, ensayos = [], modoEvaluacion } = {}) {
    if (!idAgregado) throw new Error('idAgregado es obligatorio');
    if (!Array.isArray(ensayos) || ensayos.length === 0) throw new Error('ensayos vacío');

    const agregado = await cargarAgregado(db, idAgregado);

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
            Title: `Ensayos — ${agregado.nombre || `Agregado #${idAgregado}`}`,
            Author: 'HormiQual',
        },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on('end', resolve));

    drawHeaderAgregado(doc, agregado);
    drawBannerModoEvaluacion(doc, modoEvaluacion);

    for (let i = 0; i < ensayos.length; i++) {
        const { idAgregadoEnsayo, opciones } = ensayos[i];
        if (i > 0 && doc.y > doc.page.height - 300) doc.addPage();
        await _renderEnsayoSection(doc, { db, idAgregadoEnsayo, opciones, agregado });
        doc.moveDown(0.3);
    }

    drawFooter(doc);
    doc.end();
    await done;
    return Buffer.concat(chunks);
}

module.exports = {
    generarPdfEnsayoIndividual,
    generarPdfEnsayosBatch,
    cargarAgregado,
    cargarEnsayoConTipo,
    cargarHusoDNV,
};
