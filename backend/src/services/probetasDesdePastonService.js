'use strict';

/**
 * probetasDesdePastonService.js — PR12
 *
 * Genera registros `Probeta` a partir de un `PastonPrueba`, programando los
 * días de rotura típicos (7, 28 — configurable). Cada Probeta queda en
 * estado "Curando" (idEstadoProbeta=1, default del modelo) y aparece luego
 * en la pantalla de Prensa para programar la rotura.
 *
 * Idempotente: si el pastón ya tiene N probetas para el día X, no agrega
 * duplicados — solo completa hasta el cupo declarado por la planificación.
 */

const DEFAULT_DIAS_ROTURA = [7, 28];

/**
 * Crea probetas para un pastón.
 *
 * @param {object} db
 * @param {number} idPastonPrueba
 * @param {object} [opts]
 * @param {number[]} [opts.diasRotura=[7,28]] - Días en los que se romperá cada lote.
 * @param {number} [opts.cantidadPorDia] - Cuántas probetas por cada día.
 *   Si no se pasa, se usa `paston.probetasMoldeadas / diasRotura.length` (≥1).
 * @returns {Promise<{ created: number, skipped: number, probetas: Array }>}
 */
async function generarProbetas(db, idPastonPrueba, opts = {}) {
    if (!db.PastonPrueba || !db.Probeta) {
        throw Object.assign(new Error('Modelos PastonPrueba o Probeta no disponibles'), { statusCode: 500 });
    }
    const paston = await db.PastonPrueba.findByPk(idPastonPrueba);
    if (!paston) {
        throw Object.assign(new Error('Pastón no encontrado'), { statusCode: 404 });
    }

    const diasRotura = Array.isArray(opts.diasRotura) && opts.diasRotura.length > 0
        ? opts.diasRotura.map(Number).filter((d) => d > 0)
        : DEFAULT_DIAS_ROTURA;

    // Cantidad por día: si el caller la indica, manda. Si no, derivamos de
    // probetasMoldeadas (legacy, solo si está poblado) o sumamos las
    // declaradas en mediciones; fallback 1 por día.
    let cantidadPorDia = Number(opts.cantidadPorDia) || 0;
    if (!cantidadPorDia) {
        const declaradoLegacy = Number(paston.probetasMoldeadas) || 0;
        if (declaradoLegacy > 0) {
            cantidadPorDia = Math.max(1, Math.floor(declaradoLegacy / diasRotura.length));
        } else if (db.MedicionPaston) {
            const meds = await db.MedicionPaston.findAll({
                where: { idPastonPrueba },
                attributes: ['probetasMoldeadas'],
                raw: true,
            });
            const sumaMed = meds.reduce((acc, m) => acc + (Number(m.probetasMoldeadas) || 0), 0);
            if (sumaMed > 0) cantidadPorDia = Math.max(1, Math.floor(sumaMed / diasRotura.length));
        }
        if (!cantidadPorDia) cantidadPorDia = 1;
    }

    // Fecha base para programar la rotura: fecha del pastón o hoy si no.
    const fechaBase = paston.fecha ? new Date(paston.fecha) : new Date();
    if (isNaN(fechaBase.getTime())) {
        throw Object.assign(new Error('Fecha del pastón inválida'), { statusCode: 422 });
    }

    // Probetas existentes generadas previamente (para idempotencia por día).
    const existentes = await db.Probeta.findAll({
        where: { idPastonPrueba },
        attributes: ['idProbeta', 'diasRotura'],
        raw: true,
    });
    const existentesPorDia = {};
    for (const p of existentes) {
        const d = Number(p.diasRotura) || null;
        if (d == null) continue;
        existentesPorDia[d] = (existentesPorDia[d] || 0) + 1;
    }

    const probetasCreadas = [];
    let skipped = 0;
    let secuencia = existentes.length;
    for (const dias of diasRotura) {
        const yaTiene = existentesPorDia[dias] || 0;
        const aCrear = Math.max(0, cantidadPorDia - yaTiene);
        if (aCrear === 0) {
            skipped += yaTiene;
            continue;
        }
        const fechaRot = new Date(fechaBase);
        fechaRot.setDate(fechaRot.getDate() + dias);
        for (let i = 0; i < aCrear; i++) {
            secuencia += 1;
            const nombre = `P${paston.idPastonPrueba}-${dias}d-${secuencia}`.slice(0, 10);
            const probeta = await db.Probeta.create({
                nombre,
                idPastonPrueba: paston.idPastonPrueba,
                idEstadoProbeta: 1, // Curando (default)
                diasRotura: dias,
                fechaRotura: fechaRot,
                observaciones: `Generada automáticamente del pastón #${paston.idPastonPrueba} (PR12).`,
            });
            probetasCreadas.push(probeta.get({ plain: true }));
        }
    }

    return {
        created: probetasCreadas.length,
        skipped,
        probetas: probetasCreadas,
        diasRotura,
        cantidadPorDia,
    };
}

module.exports = {
    generarProbetas,
    DEFAULT_DIAS_ROTURA,
};
