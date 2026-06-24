'use strict';

/**
 * rasMetaSyncService.js
 *
 * Sincroniza `AgregadoMeta.evaluacionRas` desde los ensayos vigentes del
 * agregado (IRAM 1649 petrográfico, IRAM 1674 RAS acelerado, IRAM 1874-3
 * barra mortero acelerado). Se invoca después de crear, actualizar o
 * desactivar un ensayo de tipo RAS.
 *
 * Antes el campo `evaluacionRas` era estático: el usuario lo elegía al
 * cargar el agregado en un dropdown del form. Eso era frágil porque
 * (a) duplicaba información que ya vive en los ensayos, (b) podía quedar
 * desactualizado si los ensayos cambiaban después.
 *
 * Mapeo nivelR (rasEvalEngine) → AgregadoMeta.evaluacionRas:
 *   - R0 → NO_REACTIVO
 *   - R1 / R2 / R3 → POTENCIALMENTE_REACTIVO
 *   - null (sin ensayos relevantes) → NO_EVALUADO
 *
 * El servicio es idempotente y silencioso: si no hay ensayos RAS o no hay
 * meta, no hace nada. Si el valor calculado coincide con el persistido,
 * no escribe.
 */

const { determinarNivelR } = require('../domain/durabilidad/rasEvalEngine');

const CODIGOS_RAS_PETROGRAFICO = new Set([
    'IRAM1649_EXAMEN_PETROGRAFICO',
]);
// IRAM 1674:1997 — Barra de mortero, método acelerado (16 días, NaOH 1N a 80 °C).
// NOTA: `IRAM1874_3_RAP_BARRA_MORTERO_ACELERADO` se quitó del set en 2026-05-04
// tras la auditoría de IRAM 1874:2004 (ver docs/normativa/IRAM_RAS_alcances.md):
// la Parte 3 de IRAM 1874 es "Estabilidad de rocas basálticas", NO RAS. La parte
// de RAS sería la Parte 2 (todavía no publicada o no incorporada al sistema).
const CODIGOS_RAS_MORTERO_ACELERADO = new Set([
    'IRAM1674_RAS_ACELERADO',
]);
// IRAM 1700:1997 — Prismas de hormigón a 38 °C (NO es método químico, a pesar del
// nombre legacy del código). El handler interpreta correctamente como prisma.
// Renombrar el código a `IRAM1700_PRISMA_HORMIGON_RAA` queda pendiente para PR1.5.
const CODIGOS_RAS_PRISMA_HORMIGON = new Set([
    'IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA',
]);

const TODOS_CODIGOS_RAS = new Set([
    ...CODIGOS_RAS_PETROGRAFICO,
    ...CODIGOS_RAS_MORTERO_ACELERADO,
    ...CODIGOS_RAS_PRISMA_HORMIGON,
]);

/**
 * @returns {boolean} true si el código del ensayo dispara recálculo RAS.
 */
function esCodigoRas(codigo) {
    return !!codigo && TODOS_CODIGOS_RAS.has(codigo);
}

function _safeParseResultado(ensayo) {
    let r = ensayo.resultado;
    if (typeof r === 'string') {
        try { r = JSON.parse(r); } catch { return {}; }
    }
    return r || {};
}

function _agregarSeñalesDesdeEnsayo(senales, ensayo, codigo) {
    const r = _safeParseResultado(ensayo);

    if (CODIGOS_RAS_PETROGRAFICO.has(codigo)) {
        if (r.conclusion === 'cumple' || r.conclusion === 'no_cumple_reactivo') {
            senales.petrografico = r.conclusion;
        }
        return;
    }
    if (CODIGOS_RAS_MORTERO_ACELERADO.has(codigo)) {
        const v = r.expansion16d ?? r.valor;
        if (v != null && Number.isFinite(Number(v))) {
            const num = Number(v);
            if (senales.morteroAceleradoExpansion16dPct == null
                || num > senales.morteroAceleradoExpansion16dPct) {
                senales.morteroAceleradoExpansion16dPct = num;
            }
        }
        return;
    }
    if (CODIGOS_RAS_PRISMA_HORMIGON.has(codigo)) {
        const v = r.expansionFinal ?? r.expansion ?? r.valor;
        if (v != null && Number.isFinite(Number(v))) {
            const num = Number(v);
            if (senales.prismaHormigonExpansionFinalPct == null
                || num > senales.prismaHormigonExpansionFinalPct) {
                senales.prismaHormigonExpansionFinalPct = num;
            }
        }
    }
}

function nivelRaEnumMeta(nivelR) {
    if (!nivelR) return 'NO_EVALUADO';
    if (nivelR === 'R0') return 'NO_REACTIVO';
    return 'POTENCIALMENTE_REACTIVO';
}

/**
 * Recomputa `AgregadoMeta.evaluacionRas` para un agregado, leyendo los
 * ensayos RAS vigentes y aplicando rasEvalEngine.determinarNivelR (peor caso).
 *
 * @param {object} db - Tenant DB.
 * @param {number} legacyAgregadoId
 * @returns {Promise<{ valorAnterior, valorNuevo, escrito, nivelR, fuente, detalle }>}
 */
async function recomputarRasParaAgregado(db, legacyAgregadoId) {
    if (!db?.AgregadoMeta || !db?.AgregadoEnsayo || !db?.AgregadoEnsayoTipo) {
        return { valorAnterior: null, valorNuevo: null, escrito: false, nivelR: null, fuente: 'no_models', detalle: [] };
    }
    if (!legacyAgregadoId) {
        return { valorAnterior: null, valorNuevo: null, escrito: false, nivelR: null, fuente: 'no_id', detalle: [] };
    }

    // 1. Levantar tipos RAS para mapear idAgregadoEnsayoTipo → codigo.
    const tipos = await db.AgregadoEnsayoTipo.findAll({
        where: { codigo: Array.from(TODOS_CODIGOS_RAS) },
        attributes: ['idAgregadoEnsayoTipo', 'codigo'],
    });
    if (!tipos || tipos.length === 0) {
        return { valorAnterior: null, valorNuevo: 'NO_EVALUADO', escrito: false, nivelR: null, fuente: 'sin_tipos_ras', detalle: [] };
    }
    const idsTiposRas = tipos.map((t) => t.idAgregadoEnsayoTipo);
    const codigoPorTipo = new Map(tipos.map((t) => [t.idAgregadoEnsayoTipo, t.codigo]));

    // 2. Levantar ensayos vigentes del agregado para esos tipos.
    const ensayos = await db.AgregadoEnsayo.findAll({
        where: {
            legacyAgregadoId,
            isActive: true,
            idAgregadoEnsayoTipo: idsTiposRas,
        },
        order: [['fechaEnsayo', 'DESC']],
    });

    // 3. Quedarme con el más reciente por tipo (snapshot vigente).
    const masRecientePorTipo = new Map();
    for (const e of ensayos) {
        if (!masRecientePorTipo.has(e.idAgregadoEnsayoTipo)) {
            masRecientePorTipo.set(e.idAgregadoEnsayoTipo, e);
        }
    }

    // 4. Construir señales para el motor.
    const senales = {};
    for (const [tipoId, ensayo] of masRecientePorTipo.entries()) {
        const codigo = codigoPorTipo.get(tipoId);
        if (codigo) _agregarSeñalesDesdeEnsayo(senales, ensayo, codigo);
    }

    const determinacion = determinarNivelR(senales);
    const valorNuevo = nivelRaEnumMeta(determinacion.nivelR);

    // 5. Persistir si cambió.
    const meta = await db.AgregadoMeta.findOne({ where: { legacyAgregadoId } });
    const valorAnterior = meta?.evaluacionRas || null;
    if (!meta) {
        return {
            valorAnterior: null,
            valorNuevo,
            escrito: false,
            nivelR: determinacion.nivelR,
            fuente: 'sin_meta',
            detalle: determinacion.detalle,
        };
    }
    if (valorAnterior === valorNuevo) {
        return {
            valorAnterior,
            valorNuevo,
            escrito: false,
            nivelR: determinacion.nivelR,
            fuente: determinacion.fuente,
            detalle: determinacion.detalle,
        };
    }
    await meta.update({ evaluacionRas: valorNuevo });
    return {
        valorAnterior,
        valorNuevo,
        escrito: true,
        nivelR: determinacion.nivelR,
        fuente: determinacion.fuente,
        detalle: determinacion.detalle,
    };
}

module.exports = {
    recomputarRasParaAgregado,
    esCodigoRas,
    nivelRaEnumMeta,
    TODOS_CODIGOS_RAS,
    CODIGOS_RAS_PETROGRAFICO,
    CODIGOS_RAS_MORTERO_ACELERADO,
    CODIGOS_RAS_PRISMA_HORMIGON,
};
