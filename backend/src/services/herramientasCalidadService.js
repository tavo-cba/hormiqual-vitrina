'use strict';

/**
 * herramientasCalidadService.js (sesión 2026-05-10) — fachada de
 * Herramientas (Calidad → Herramientas) que expone los engines
 * puros del dominio sin requerir que el cliente consulte y procese
 * los catálogos por su cuenta.
 *
 * Hoy cubre:
 *   - HER-20: Tabla 2.5 Durabilidad CIRSOC 200:2024 §2.2.4.
 *   - HER-22: Tabla 4.3 Aire incorporado CIRSOC 200:2024 §4.3.
 *
 * El service carga la fila del catálogo `DurabilidadExposicion` o
 * `AireDurabilidad` desde `req.db`, invoca el engine puro y devuelve
 * el resultado tal cual. Sin lógica de negocio adicional.
 */

const {
    verificarDurabilidad,
    verificarAirePorTMN,
    verificarPulverulentoMinimo,
} = require('../domain/durabilidadCirsoc25Engine');
const { estimarAC } = require('../domain/dosificacion/dosificacionCalcEngine');

/**
 * HER-20 — Verificación contra Tabla 2.5 (durabilidad).
 *
 * @param {Object} db
 * @param {Object} params { claseExposicion, tipoEstructural, ac?, fc? }
 * @returns {Promise<Object>} resultado del engine `verificarDurabilidad`.
 */
async function verificarTabla25(db, params = {}) {
    const clase = String(params.claseExposicion || '').toUpperCase();
    if (!clase) {
        return verificarDurabilidad({});
    }
    const durRow = await db.DurabilidadExposicion.findOne({
        where: { codigo: clase, vigente: true },
        raw: true,
    });
    return verificarDurabilidad({
        claseExposicion: clase,
        tipoEstructural: params.tipoEstructural,
        ac: params.ac,
        fc: params.fc,
        durRow,
    });
}

/**
 * HER-22 — Verificación contra Tabla 4.3 (aire incorporado por TMN).
 *
 * @param {Object} db
 * @param {Object} params { tmnMm, claseExposicion, airePct?, fceMpa? }
 * @returns {Promise<Object>} resultado del engine `verificarAirePorTMN`.
 */
async function verificarTabla43(db, params = {}) {
    const aireDurabilidad = db.AireDurabilidad
        ? (await db.AireDurabilidad.findAll({ raw: true }))
        : [];
    return verificarAirePorTMN({
        tmnMm: params.tmnMm,
        claseExposicion: params.claseExposicion,
        airePct: params.airePct,
        fceMpa: params.fceMpa,
        aireDurabilidad,
    });
}

/**
 * HER-24 — Verificación contra Tabla 4.4 (material pulverulento mínimo).
 *
 * @param {Object} db
 * @param {Object} params { tmnMm, cementoKg?, adicionesKg?, finosAgregadoKg?, agregados?,
 *                          fcMpa?, metodoColocacion?, claseExposicion? }
 * @returns {Promise<Object>} resultado del engine `verificarPulverulentoMinimo`.
 */
async function verificarTabla44(db, params = {}) {
    const pulverulentoMinimo = db.PulverulentoMinimo
        ? (await db.PulverulentoMinimo.findAll({ raw: true }))
        : [];
    return verificarPulverulentoMinimo({
        tmnMm: params.tmnMm,
        cementoKg: params.cementoKg,
        adicionesKg: params.adicionesKg,
        finosAgregadoKg: params.finosAgregadoKg,
        agregados: params.agregados,
        fcMpa: params.fcMpa,
        metodoColocacion: params.metodoColocacion,
        claseExposicion: params.claseExposicion,
        pulverulentoMinimo,
    });
}

/**
 * Lista compacta de clases de exposición (para llenar dropdowns).
 */
async function listarClasesExposicion(db) {
    const rows = await db.DurabilidadExposicion.findAll({
        where: { vigente: true },
        order: [['orden', 'ASC']],
        attributes: ['id', 'codigo', 'grupo', 'descripcionCorta', 'descripcionMedio',
                     'acMaxSimple', 'acMaxArmado', 'acMaxPretensado',
                     'fcminSimple', 'fcminArmado', 'fcminPretensado',
                     'requiereAireTabla43'],
        raw: true,
    });
    // Alias `descripcion` para mantener back-compat con consumers viejos (UI dropdowns).
    return rows.map((r) => ({ ...r, descripcion: r.descripcionCorta || r.descripcionMedio || '' }));
}

/**
 * Lista de TMN tabulados en Tabla 4.3 (los únicos con verificación
 * de aire). Para el dropdown del frontend.
 */
async function listarTmnTabla43(db) {
    if (!db.AireDurabilidad) return [];
    const rows = await db.AireDurabilidad.findAll({
        attributes: ['tmnMm'],
        group: ['tmnMm'],
        order: [['tmnMm', 'ASC']],
        raw: true,
    });
    return rows.map((r) => Number(r.tmnMm)).filter(Number.isFinite);
}

/**
 * HER-21 — Estima la relación a/c desde una resistencia objetivo (MPa)
 * a una edad dada, usando las curvas genéricas ICPA (CurvaACResistencia)
 * cargadas para el tenant. El motor reutiliza `estimarAC` del dominio
 * (mismo path que el motor de dosificación HormiQual / sugerenciaMezcla),
 * así la calculadora del laboratorio devuelve EXACTAMENTE el a/c que
 * usaría el motor para esa combinación familia × edad × resistencia.
 *
 * @param {Object} db
 * @param {Object} params { resistenciaMpa, edadDias?, familiaCemento? }
 * @returns {Promise<Object>} resultado del engine `estimarAC` con campos:
 *   { acEstimado, metodo, curvasUsadas, warning?, error?, fuente }
 */
async function estimarACDesdeFc(db, params = {}) {
    const out = {
        acEstimado: null,
        metodo: 'SIN_DATOS',
        curvasUsadas: [],
        edadDias: null,
        familiaCemento: null,
        resistenciaMpa: null,
        fuente: 'CurvaACResistencia (Ábaco 2 ICPA genérico)',
        advertencias: [],
    };

    const resistenciaMpa = Number(params.resistenciaMpa);
    if (!Number.isFinite(resistenciaMpa) || resistenciaMpa <= 0) {
        out.advertencias.push('Resistencia objetivo no provista o no positiva.');
        return out;
    }
    out.resistenciaMpa = resistenciaMpa;

    const edadDias = Number(params.edadDias) > 0 ? Math.round(Number(params.edadDias)) : 28;
    out.edadDias = edadDias;

    const familiaCemento = params.familiaCemento ? String(params.familiaCemento).trim() : null;
    out.familiaCemento = familiaCemento;

    if (!db.CurvaACResistencia) {
        out.advertencias.push('Catálogo CurvaACResistencia no disponible para este tenant.');
        return out;
    }

    const curvas = await db.CurvaACResistencia.findAll({
        where: { activo: true },
        raw: true,
    });
    if (!curvas || curvas.length === 0) {
        out.advertencias.push('Sin curvas a/c-resistencia cargadas. Cargá curvas ICPA en Configuración.');
        return out;
    }

    const r = estimarAC(curvas, resistenciaMpa, edadDias, familiaCemento);
    out.acEstimado = r?.acEstimado ?? null;
    out.metodo = r?.metodo || 'SIN_DATOS';
    out.curvasUsadas = r?.curvasUsadas || [];
    if (r?.warning) out.advertencias.push(r.warning);
    if (r?.error)   out.advertencias.push(r.error);

    return out;
}

/**
 * HER-21 — Lista las combinaciones (familiaCemento, edadDias) disponibles
 * en `CurvaACResistencia` para llenar los dropdowns del frontend.
 */
async function listarCurvasAC(db) {
    if (!db.CurvaACResistencia) return { familias: [], edades: [] };
    const rows = await db.CurvaACResistencia.findAll({
        where: { activo: true },
        attributes: ['familiaCemento', 'edadDias'],
        raw: true,
    });
    const familias = Array.from(new Set(rows.map((r) => r.familiaCemento || ''))).sort();
    const edades = Array.from(new Set(rows.map((r) => Number(r.edadDias))))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    return { familias, edades };
}

/**
 * HER-24 — Catálogo `PulverulentoMinimo` para llenar el dropdown del
 * frontend (TMN y mínimo asociado, así la calculadora puede mostrar la
 * tabla completa).
 */
async function listarPulverulentoMinimo(db) {
    if (!db.PulverulentoMinimo) return [];
    return db.PulverulentoMinimo.findAll({
        attributes: ['tmnMm', 'minimoKgM3'],
        order: [['tmnMm', 'ASC']],
        raw: true,
    });
}

module.exports = {
    verificarTabla25,
    verificarTabla43,
    verificarTabla44,
    estimarACDesdeFc,
    listarClasesExposicion,
    listarTmnTabla43,
    listarPulverulentoMinimo,
    listarCurvasAC,
};
