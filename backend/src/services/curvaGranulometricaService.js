'use strict';

const {
  TAMICES_IRAM,
  TAMICES_ASTM,
  normalizeFormulaParams,
  resolveFormula,
  FORMULA_MAP,
} = require('./granulometriaCalc');
const {
  normalizeSieveSet,
  EQUIVALENT_SIEVES,
} = require('../catalog/tamicesCatalog');
const {
  sanitizeCurvaPayload,
  validatePuntosBySpecMode,
  ValidationError,
} = require('../helpers/curvaValidation');

/* ═══════════════════════════════════════════════════════════
   Fórmulas de curvas teóricas — delegadas a granulometriaCalc
   ═══════════════════════════════════════════════════════════ */

// Re-export normalizeParams para backward compat dentro del servicio
const normalizeParams = normalizeFormulaParams;

/**
 * Genera los puntos calculados para una curva TEORICA.
 * Devuelve con targetPct (specMode OBJETIVO) y pasaPct (compat).
 * Tamices con abertura > cutoff (dmax / Dmax / tmnMm) se marcan isNA=true.
 */
function generarPuntosTeorica(curva) {
  const raw = curva.parametros || {};
  const params = normalizeParams(raw);
  const formulaKey = params.formulaKey || params.formula;
  const fn = resolveFormula(formulaKey);
  if (!fn) return [];

  const rounding = params.rounding != null ? params.rounding : 1; // decimales
  const factor = Math.pow(10, rounding);

  // Cutoff: tamices con abertura > cutoffMm → isNA
  const cutoffMm = params.D || params.dmax || curva.tmnMm || null;

  const serie = curva.serieTamices === 'ASTM' ? TAMICES_ASTM : TAMICES_IRAM;
  return serie.map((t, i) => {
    const exceedsCutoff = cutoffMm != null && t.aberturaMm > cutoffMm;
    if (exceedsCutoff) {
      return {
        tamiz: t.tamiz,
        aberturaMm: t.aberturaMm,
        targetPct: null,
        pasaPct: null,
        limInfPct: null,
        limSupPct: null,
        isNA: true,
        orden: i,
      };
    }
    let val = fn(t.aberturaMm, params);
    val = Math.max(0, Math.min(100, val)); // clamp 0..100
    const rounded = Math.round(val * factor) / factor;
    return {
      tamiz: t.tamiz,
      aberturaMm: t.aberturaMm,
      targetPct: rounded,
      pasaPct: rounded, // compatibilidad con comparación
      limInfPct: null,
      limSupPct: null,
      isNA: false,
      orden: i,
    };
  });
}

/* ═══════════════════════════════════════════════════════════
   Backfill: asegurar grilla ASTM completa en curvas existentes
   ═══════════════════════════════════════════════════════════ */

/**
 * Para curvas ASTM (no TEORICA), garantiza que todos los tamices de
 * la serie ASTM estén presentes como puntos. Los que falten se agregan
 * como isNA=true con valores null (backfill sin persistir).
 * Esto permite que curvas guardadas antes de agregar 4"/3½" muestren
 * esas filas al abrirlas.
 */
function ensureASTMGrid(plain) {
  if (!plain || plain.serieTamices !== 'ASTM') return plain;
  if (plain.tipo === 'TEORICA') return plain; // teóricas se generan completas

  const puntos = plain.puntos || [];
  const existingAberturas = new Set(puntos.map(p => p.aberturaMm));
  let maxOrden = puntos.reduce((mx, p) => Math.max(mx, p.orden ?? 0), -1);
  let changed = false;

  for (const t of TAMICES_ASTM) {
    if (!existingAberturas.has(t.aberturaMm)) {
      maxOrden++;
      puntos.push({
        tamiz: t.tamiz,
        aberturaMm: t.aberturaMm,
        pasaPct: null,
        limInfPct: null,
        limSupPct: null,
        targetPct: null,
        isNA: true,
        orden: maxOrden,
      });
      changed = true;
    }
  }

  if (changed) {
    // Re-sort by aberturaMm descending and re-assign orden
    puntos.sort((a, b) => b.aberturaMm - a.aberturaMm);
    puntos.forEach((p, i) => { p.orden = i; });
    plain.puntos = puntos;
  }

  return plain;
}

/* ═══════════════════════════════════════════════════════════
   CRUD
   ═══════════════════════════════════════════════════════════ */

const getCurvas = async (db, { tipo, isActive, serieTamices, uso, tmnMm, estadoDatos, curveLetter, idCurvaSet } = {}) => {
  const where = {};
  if (tipo) where.tipo = tipo;
  if (isActive !== undefined) where.isActive = isActive;
  if (serieTamices) where.serieTamices = serieTamices;
  if (uso) where.uso = uso;
  if (tmnMm !== undefined && tmnMm !== null) where.tmnMm = Number(tmnMm);
  if (estadoDatos) where.estadoDatos = estadoDatos;
  if (curveLetter) where.curveLetter = curveLetter;
  if (idCurvaSet !== undefined && idCurvaSet !== null) {
    if (idCurvaSet === 'any') {
      const { Op } = require('sequelize');
      where.idCurvaSet = { [Op.ne]: null };
    } else {
      where.idCurvaSet = Number(idCurvaSet);
    }
  }

  const curvas = await db.CurvaGranulometrica.findAll({
    where,
    include: [
      { model: db.CurvaPunto, as: 'puntos', order: [['orden', 'ASC']] },
      { model: db.CurvaSet, as: 'set', required: false },
    ],
    order: [['nombre', 'ASC']],
  });

  return curvas.map(c => {
    const plain = c.get({ plain: true });
    if (plain.tipo === 'TEORICA') {
      plain.puntosCalculados = generarPuntosTeorica(plain);
    }
    ensureASTMGrid(plain);
    return plain;
  });
};

const getCurva = async (db, id) => {
  const curva = await db.CurvaGranulometrica.findByPk(id, {
    include: [
      { model: db.CurvaPunto, as: 'puntos', order: [['orden', 'ASC']] },
      { model: db.CurvaSet, as: 'set', required: false },
    ],
  });
  if (!curva) return null;

  const plain = curva.get({ plain: true });
  if (plain.tipo === 'TEORICA') {
    plain.puntosCalculados = generarPuntosTeorica(plain);
  }
  ensureASTMGrid(plain);
  return plain;
};

const createCurva = async (db, data) => {
  // 1. Sanitize payload
  sanitizeCurvaPayload(data);

  // 2. For TEORICA: force specMode=OBJETIVO and generate points from formula
  if (data.tipo === 'TEORICA') {
    data.specMode = 'OBJETIVO';
    const generados = generarPuntosTeorica({
      parametros: data.parametros,
      serieTamices: data.serieTamices || 'IRAM',
      tmnMm: data.tmnMm ?? null,
    });
    if (generados.length > 0) {
      data.puntos = generados;
    }
  }

  // 3. Validate puntos according to specMode (only for BANDA/TABULADA with puntos)
  if (data.tipo !== 'TEORICA' && Array.isArray(data.puntos) && data.puntos.length > 0) {
    validatePuntosBySpecMode(data.specMode || 'RANGO', data.puntos);
  }

  const t = await db.sequelize.transaction();
  try {
    const curva = await db.CurvaGranulometrica.create({
      nombre: data.nombre,
      tipo: data.tipo,
      specMode: data.specMode || 'RANGO',
      serieTamices: data.serieTamices || 'IRAM',
      uso: data.uso || null,
      tmnMm: data.tmnMm ?? null,
      curveLetter: data.curveLetter || null,
      origenDatos: data.origenDatos || null,
      estadoDatos: data.estadoDatos || 'COMPLETO',
      normaRef: data.normaRef || null,
      parametros: data.parametros || null,
      metadata: data.metadata || null,
      isDefault: data.isDefault || false,
      isActive: data.isActive !== false,
      version: data.version || '1.0',
      idCurvaSet: data.idCurvaSet || null,
    }, { transaction: t });

    if (data.puntos && data.puntos.length > 0) {
      const puntos = data.puntos.map((p, i) => ({
        idCurva: curva.idCurva,
        tamiz: p.tamiz,
        aberturaMm: p.aberturaMm ?? null,
        pasaPct: p.pasaPct ?? null,
        limInfPct: p.limInfPct ?? null,
        limSupPct: p.limSupPct ?? null,
        targetPct: p.targetPct ?? null,
        isNA: p.isNA === true,
        orden: p.orden ?? i,
      }));
      await db.CurvaPunto.bulkCreate(puntos, { transaction: t });
    }

    await t.commit();
    return getCurva(db, curva.idCurva);
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

const updateCurva = async (db, id, data) => {
  // 1. Sanitize payload
  sanitizeCurvaPayload(data);

  const t = await db.sequelize.transaction();
  try {
    const curva = await db.CurvaGranulometrica.findByPk(id);
    if (!curva) throw new Error('Curva no encontrada');

    const effectiveSpecMode = data.specMode !== undefined ? data.specMode : curva.specMode;
    const effectiveTipo = data.tipo || curva.tipo;

    // For TEORICA: force OBJETIVO and regenerate points from params
    if (effectiveTipo === 'TEORICA') {
      data.specMode = 'OBJETIVO';
      const effectiveParams = data.parametros || curva.parametros;
      const effectiveSerie = data.serieTamices || curva.serieTamices || 'IRAM';
      const effectiveTmn = data.tmnMm !== undefined ? (data.tmnMm ?? null) : (curva.tmnMm ?? null);
      const generados = generarPuntosTeorica({
        parametros: effectiveParams,
        serieTamices: effectiveSerie,
        tmnMm: effectiveTmn,
      });
      if (generados.length > 0) {
        data.puntos = generados;
      }
    }

    // 2. Validate puntos if they are being replaced
    if (data.puntos !== undefined && effectiveTipo !== 'TEORICA' && Array.isArray(data.puntos) && data.puntos.length > 0) {
      validatePuntosBySpecMode(data.specMode || effectiveSpecMode, data.puntos);
    }

    await curva.update({
      nombre: data.nombre,
      tipo: data.tipo,
      specMode: effectiveSpecMode,
      serieTamices: data.serieTamices || curva.serieTamices,
      uso: data.uso !== undefined ? data.uso : curva.uso,
      tmnMm: data.tmnMm !== undefined ? (data.tmnMm ?? null) : curva.tmnMm,
      curveLetter: data.curveLetter !== undefined ? (data.curveLetter || null) : curva.curveLetter,
      origenDatos: data.origenDatos !== undefined ? data.origenDatos : curva.origenDatos,
      estadoDatos: data.estadoDatos !== undefined ? data.estadoDatos : curva.estadoDatos,
      normaRef: data.normaRef ?? curva.normaRef,
      parametros: data.parametros ?? curva.parametros,
      metadata: data.metadata ?? curva.metadata,
      isDefault: data.isDefault ?? curva.isDefault,
      isActive: data.isActive ?? curva.isActive,
      version: data.version ?? curva.version,
      idCurvaSet: data.idCurvaSet !== undefined ? data.idCurvaSet : curva.idCurvaSet,
    }, { transaction: t });

    if (data.puntos !== undefined) {
      await db.CurvaPunto.destroy({ where: { idCurva: id }, transaction: t });
      if (data.puntos && data.puntos.length > 0) {
        const puntos = data.puntos.map((p, i) => ({
          idCurva: id,
          tamiz: p.tamiz,
          aberturaMm: p.aberturaMm ?? null,
          pasaPct: p.pasaPct ?? null,
          limInfPct: p.limInfPct ?? null,
          limSupPct: p.limSupPct ?? null,
          targetPct: p.targetPct ?? null,
          isNA: p.isNA === true,
          orden: p.orden ?? i,
        }));
        await db.CurvaPunto.bulkCreate(puntos, { transaction: t });
      }
    }

    await t.commit();
    return getCurva(db, id);
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

/**
 * Hard-delete: elimina la curva y sus puntos en cascada.
 * TODO: cuando curvaId se use en extracciones/ensayos/reportes,
 *       verificar referencias antes de borrar y devolver 409 si está en uso.
 */
const deleteCurva = async (db, id) => {
  const curva = await db.CurvaGranulometrica.findByPk(id);
  if (!curva) throw new Error('Curva no encontrada');

  const nombre = curva.nombre;
  const t = await db.sequelize.transaction();
  try {
    // Borrar puntos asociados
    await db.CurvaPunto.destroy({ where: { idCurva: id }, transaction: t });

    // Desvincular de set (si pertenecia a uno)
    // No borra el set, solo la relación
    await curva.destroy({ transaction: t });

    await t.commit();
    return { message: `Curva "${nombre}" eliminada` };
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

/* ═══════════════════════════════════════════════════════════
   Comparación de granulometría contra curva
   ═══════════════════════════════════════════════════════════ */

/**
 * Compara datos de granulometría contra una curva.
 * @param {Array} tamicesGrano - [{tamiz, aberturaMm, pasaPct}]
 * @param {Object} curva - curva completa con puntos/puntosCalculados
 * @returns {{tipo, desvios, metrica, cumple, tamicesFueraDeBanda}}
 */
function compararConCurva(tamicesGrano, curva) {
  if (!curva || !tamicesGrano || tamicesGrano.length === 0) return null;

  const tipoCurva = curva.tipo;
  const specMode = curva.specMode || 'RANGO';

  // Obtener los puntos de referencia de la curva
  let puntosCurva;
  if (tipoCurva === 'TEORICA') {
    puntosCurva = curva.puntosCalculados || generarPuntosTeorica(curva);
  } else {
    puntosCurva = (curva.puntos || []).filter(p => !p.isNA);
  }

  if (puntosCurva.length === 0) return null;

  // Normalizar tamices de la muestra
  const muestra = tamicesGrano
    .filter(t => t.pasaPct !== null && t.pasaPct !== undefined)
    .map(t => ({ aberturaMm: Number(t.aberturaMm), pasaPct: Number(t.pasaPct), tamiz: t.tamiz }));

  // Build equivalence map for matching (e.g., 13.2 ↔ 12.5)
  const equivMap = new Map();
  for (const [a, b] of EQUIVALENT_SIEVES) {
    equivMap.set(a, b);
    equivMap.set(b, a);
  }

  /** Find a punto in puntosCurva that matches abertura, considering equivalents */
  function findPuntoCurva(aberturaMm) {
    let p = puntosCurva.find(c => Math.abs(c.aberturaMm - aberturaMm) < 0.01);
    if (p) return p;
    const alt = equivMap.get(aberturaMm);
    if (alt != null) {
      p = puntosCurva.find(c => Math.abs(c.aberturaMm - alt) < 0.01);
    }
    return p || null;
  }

  if (tipoCurva === 'BANDA') {
    // Comparación con banda: cumple/no cumple — depends on specMode
    const tamicesFueraDeBanda = [];
    let todoCumple = true;

    for (const m of muestra) {
      const puntoBanda = findPuntoCurva(m.aberturaMm);
      if (!puntoBanda) continue;

      const limInf = puntoBanda.limInfPct;
      const limSup = puntoBanda.limSupPct;
      const target = puntoBanda.targetPct;

      let fuera = false;
      let desvio = 0;

      if (specMode === 'MAX_ONLY') {
        // Solo hay límite superior
        if (limSup !== null && limSup !== undefined && m.pasaPct > limSup) {
          fuera = true;
          desvio = m.pasaPct - limSup;
        }
      } else if (specMode === 'MIN_ONLY') {
        if (limInf !== null && limInf !== undefined && m.pasaPct < limInf) {
          fuera = true;
          desvio = m.pasaPct - limInf;
        }
      } else if (specMode === 'OBJETIVO') {
        // Usa targetPct — comparación por desvío (no cumple/no cumple)
        if (target !== null && target !== undefined) {
          desvio = m.pasaPct - target;
        }
        // Para OBJETIVO no se marca como "fuera", se reportan desvíos
      } else {
        // RANGO: limInf + limSup
        if (limInf !== null && limSup !== null) {
          if (m.pasaPct < limInf || m.pasaPct > limSup) {
            fuera = true;
            desvio = m.pasaPct < limInf ? m.pasaPct - limInf : m.pasaPct - limSup;
          }
        }
      }

      if (fuera) {
        todoCumple = false;
        tamicesFueraDeBanda.push({
          tamiz: m.tamiz,
          aberturaMm: m.aberturaMm,
          pasaPct: m.pasaPct,
          limInfPct: limInf,
          limSupPct: limSup,
          targetPct: target,
          desvio,
        });
      }
    }

    // Observaciones heurísticas para banda
    const observaciones = [];
    const fueraAberturas = tamicesFueraDeBanda.map(t => t.aberturaMm);
    const finosFuera = fueraAberturas.filter(a => a <= 0.6);
    const gruesosFuera = fueraAberturas.filter(a => a >= 9.5);
    if (finosFuera.length > 0 && tamicesFueraDeBanda.some(t => t.desvio > 0 && t.aberturaMm <= 0.6)) {
      observaciones.push('Exceso de finos: la muestra supera el límite superior en tamices finos');
    }
    if (finosFuera.length > 0 && tamicesFueraDeBanda.some(t => t.desvio < 0 && t.aberturaMm <= 0.6)) {
      observaciones.push('Déficit de finos: la muestra está por debajo del límite inferior en tamices finos');
    }
    if (gruesosFuera.length > 0) {
      observaciones.push('Tamices gruesos fuera de banda');
    }
    // Gap detection: consecutive sieves both out of band
    for (let i = 1; i < tamicesFueraDeBanda.length; i++) {
      const prev = tamicesFueraDeBanda[i - 1];
      const curr = tamicesFueraDeBanda[i];
      if (prev.aberturaMm / curr.aberturaMm <= 3) {
        observaciones.push(`Gap ${prev.tamiz}–${curr.tamiz}`);
      }
    }

    return {
      tipo: 'BANDA',
      curvaId: curva.idCurva,
      curvaNombre: curva.nombre,
      cumpleBanda: todoCumple,
      cumple: todoCumple,
      tamicesFueraDeBanda,
      observaciones,
      cantidadComparados: muestra.filter(m => findPuntoCurva(m.aberturaMm) != null).length,
    };
  } else {
    // TEORICA o TABULADA: calcular error por tamiz y métricas de ajuste
    const desvios = [];
    let sumSq = 0;
    let count = 0;

    for (const m of muestra) {
      const puntoCurva = findPuntoCurva(m.aberturaMm);
      if (!puntoCurva || puntoCurva.pasaPct === null) continue;

      const error = m.pasaPct - puntoCurva.pasaPct;
      desvios.push({
        tamiz: m.tamiz,
        aberturaMm: m.aberturaMm,
        pasaPctMuestra: m.pasaPct,
        pasaPctCurva: puntoCurva.pasaPct,
        error: Math.round(error * 100) / 100,
        errorAbs: Math.round(Math.abs(error) * 100) / 100,
      });
      sumSq += error * error;
      count++;
    }

    // ── Métricas de ajuste ──
    const sumAbsRaw = desvios.reduce((s, d) => s + d.errorAbs, 0);
    const rmse = count > 0 ? Math.round(Math.sqrt(sumSq / count) * 100) / 100 : null;
    const mae = count > 0 ? Math.round((sumAbsRaw / count) * 100) / 100 : null;
    const sumaAbs = count > 0 ? Math.round(sumAbsRaw * 100) / 100 : null;
    const maxDesvio = desvios.length > 0
      ? Math.round(Math.max(...desvios.map(d => d.errorAbs)) * 100) / 100
      : null;

    // R² (coeficiente de determinación)
    let r2 = null;
    if (count > 1) {
      const meanMuestra = desvios.reduce((s, d) => s + d.pasaPctMuestra, 0) / count;
      const ssTot = desvios.reduce((s, d) => s + Math.pow(d.pasaPctMuestra - meanMuestra, 2), 0);
      r2 = ssTot > 0 ? Math.round((1 - sumSq / ssTot) * 10000) / 10000 : null;
    }

    // Top-N peores tamices (sorted by errorAbs desc)
    const worstSieves = [...desvios].sort((a, b) => b.errorAbs - a.errorAbs).slice(0, 5);

    // Series para gráfico overlay (medida vs curva teórica)
    const seriesDesvios = [...desvios].sort((a, b) => a.aberturaMm - b.aberturaMm);
    const series = {
      medida: seriesDesvios.map(d => ({ aberturaMm: d.aberturaMm, pasaPct: d.pasaPctMuestra })),
      curvaRef: seriesDesvios.map(d => ({ aberturaMm: d.aberturaMm, pasaPct: d.pasaPctCurva })),
    };

    // Observaciones heurísticas para teórica/tabulada
    const observaciones = [];
    const finosDesvio = desvios.filter(d => d.aberturaMm <= 0.6 && d.errorAbs > 5);
    const gruesos = desvios.filter(d => d.aberturaMm >= 9.5 && d.errorAbs > 5);
    if (finosDesvio.length > 0) {
      const promSign = finosDesvio.reduce((s, d) => s + d.error, 0) / finosDesvio.length;
      observaciones.push(promSign > 0 ? 'Exceso de finos respecto a la curva' : 'Déficit de finos respecto a la curva');
    }
    if (gruesos.length > 0) {
      observaciones.push('Desvío significativo en tamices gruesos');
    }
    // Gap detection
    const sorted = [...desvios].sort((a, b) => b.aberturaMm - a.aberturaMm);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].errorAbs > 10 && sorted[i].errorAbs > 10 && sorted[i - 1].aberturaMm / sorted[i].aberturaMm <= 3) {
        observaciones.push(`Gap ${sorted[i - 1].tamiz}–${sorted[i].tamiz}`);
      }
    }

    return {
      tipo: tipoCurva,
      curvaId: curva.idCurva,
      curvaNombre: curva.nombre,
      tipoCurva,
      desvios,
      rmse,
      mae,
      r2,
      maxDesvio,
      worstSieves,
      metrica: rmse,
      sumaAbs,
      series,
      observaciones,
      cantidadComparados: count,
    };
  }
}

/**
 * Computa la envolvente de un conjunto de curvas hermanas (CurvaSet).
 * Para cada tamiz, limInf = min(all curves) y limSup = max(all curves).
 * @param {Array<Object>} curvasHermanas - array de curvas con puntos
 * @returns {Array<{tamiz, aberturaMm, limInfPct, limSupPct}>}
 */
function computeEnvolvente(curvasHermanas) {
  if (!curvasHermanas || curvasHermanas.length === 0) return [];

  const byAbertura = new Map(); // aberturaMm → { tamiz, vals: [] }

  for (const curva of curvasHermanas) {
    const puntos = curva.tipo === 'TEORICA'
      ? (curva.puntosCalculados || [])
      : (curva.puntos || []);
    for (const p of puntos) {
      if (p.isNA) continue;
      const val = p.pasaPct ?? p.targetPct ?? p.limInfPct ?? p.limSupPct;
      if (val == null) continue;
      const ab = Number(p.aberturaMm);
      if (!byAbertura.has(ab)) {
        byAbertura.set(ab, { tamiz: p.tamiz, aberturaMm: ab, vals: [] });
      }
      byAbertura.get(ab).vals.push(Number(val));
      // Also add limInf/limSup if they exist (for BANDA curves already with limits)
      if (p.limInfPct != null) byAbertura.get(ab).vals.push(Number(p.limInfPct));
      if (p.limSupPct != null) byAbertura.get(ab).vals.push(Number(p.limSupPct));
    }
  }

  return [...byAbertura.values()]
    .map(({ tamiz, aberturaMm, vals }) => ({
      tamiz,
      aberturaMm,
      limInfPct: Math.round(Math.min(...vals) * 100) / 100,
      limSupPct: Math.round(Math.max(...vals) * 100) / 100,
    }))
    .sort((a, b) => a.aberturaMm - b.aberturaMm);
}

/**
 * Obtiene las curvas hermanas de un CurvaSet, excluyendo curvas inactivas.
 */
const getCurvasHermanas = async (db, idCurvaSet) => {
  if (!idCurvaSet) return [];
  const curvas = await getCurvas(db, { idCurvaSet, isActive: true });
  return curvas;
};

/**
 * Genera puntos con validación explícita de parámetros.
 * Devuelve { puntos } o { error }.
 */
function generarPuntosTeoricaValidated(curva) {
  const raw = curva.parametros || {};
  const params = normalizeParams(raw);
  const formulaKey = params.formulaKey || params.formula;

  if (!formulaKey) {
    return { error: 'Falta el parámetro "formulaKey" / "formula" (FULLER_TALBOT / ANDREASEN / ANDREASEN_MOD / ROSIN_RAMMLER)' };
  }
  if (!resolveFormula(formulaKey)) {
    return { error: `Fórmula "${formulaKey}" no reconocida. Usar: FULLER_TALBOT, ANDREASEN, ANDREASEN_MOD, ROSIN_RAMMLER` };
  }

  const D = params.D || params.dmax;
  if (formulaKey !== 'ROSIN_RAMMLER' && (!D || D <= 0)) {
    return { error: 'Falta el parámetro "D" / "dmax" (D máx > 0)' };
  }
  if ((formulaKey === 'modified_aa' || formulaKey === 'ANDREASEN_MOD') && (!params.dmin || params.dmin <= 0)) {
    return { error: 'La fórmula requiere "dmin" (D mín > 0)' };
  }
  if (formulaKey === 'ROSIN_RAMMLER' && (!params.x || params.x <= 0)) {
    return { error: 'La fórmula Rosin-Rammler requiere "x" (parámetro de escala > 0)' };
  }
  if (formulaKey === 'ROSIN_RAMMLER' && (!params.k || params.k <= 0)) {
    return { error: 'La fórmula Rosin-Rammler requiere "k" (parámetro de forma > 0)' };
  }

  const rounding = params.rounding != null ? params.rounding : 1;
  const factor = Math.pow(10, rounding);
  const fn = resolveFormula(formulaKey);
  const serie = curva.serieTamices === 'ASTM' ? TAMICES_ASTM : TAMICES_IRAM;

  // Cutoff: tamices con abertura > cutoffMm → isNA
  const cutoffMm = D || curva.tmnMm || null;

  const puntos = serie.map((t, i) => {
    const exceedsCutoff = cutoffMm != null && t.aberturaMm > cutoffMm;
    if (exceedsCutoff) {
      return {
        tamiz: t.tamiz,
        aberturaMm: t.aberturaMm,
        targetPct: null,
        pasaPct: null,
        limInfPct: null,
        limSupPct: null,
        isNA: true,
        orden: i,
      };
    }
    let val = fn(t.aberturaMm, params);
    val = Math.max(0, Math.min(100, val)); // clamp 0..100
    const rounded = Math.round(val * factor) / factor;
    return {
      tamiz: t.tamiz,
      aberturaMm: t.aberturaMm,
      targetPct: rounded,
      pasaPct: rounded,
      limInfPct: null,
      limSupPct: null,
      isNA: false,
      orden: i,
    };
  });

  return { puntos };
}

/**
 * Regenerar puntos de una curva TEORICA existente.
 * Lee los parametros de la DB, recalcula y persiste.
 */
const regenerarCurva = async (db, id) => {
  const curva = await db.CurvaGranulometrica.findByPk(id);
  if (!curva) throw new Error('Curva no encontrada');
  if (curva.tipo !== 'TEORICA') throw new ValidationError('Solo se pueden regenerar curvas TEÓRICAS');

  const result = generarPuntosTeoricaValidated({
    parametros: curva.parametros,
    serieTamices: curva.serieTamices,
    tmnMm: curva.tmnMm ?? null,
  });
  if (result.error) throw new ValidationError(result.error);

  const t = await db.sequelize.transaction();
  try {
    // Borrar puntos existentes
    await db.CurvaPunto.destroy({ where: { idCurva: id }, transaction: t });

    // Crear nuevos puntos
    const puntos = result.puntos.map((p, i) => ({
      idCurva: Number(id),
      tamiz: p.tamiz,
      aberturaMm: p.aberturaMm,
      pasaPct: p.pasaPct ?? null,
      limInfPct: null,
      limSupPct: null,
      targetPct: p.targetPct ?? null,
      isNA: p.isNA === true,
      orden: p.orden ?? i,
    }));
    await db.CurvaPunto.bulkCreate(puntos, { transaction: t });

    // Asegurar specMode = OBJETIVO
    await curva.update({ specMode: 'OBJETIVO' }, { transaction: t });

    await t.commit();
    return getCurva(db, id);
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

/* ═══════════════════════════════════════════════════════════
   TMN-based ranking for catalog
   ═══════════════════════════════════════════════════════════ */

/**
 * Rank an array of catalog items by proximity to a user-supplied TMN.
 * Adds `tmnDistancia` (abs distance) and `recomendada` (boolean) fields.
 * Sorts: closest TMN first, nulls last. Among equal distances, sorts by curveLetter.
 *
 * @param {Array} items - Array of { idCurva, nombre, tmnMm, curveLetter, ... }
 * @param {number} userTmn - The user's evaluated TMN in mm
 * @returns {Array} Same items with tmnDistancia and recomendada added, sorted.
 */
/**
 * Ranks curves by proximity to a user's TMN.
 * Supports both:
 *   - tmnMm (exact TMN, legacy) — distance = |tmnMm - userTmn|
 *   - tmnMinMm/tmnMaxMm (range) — score 0 if within [min, max]
 *
 * @param {Array} items - curve catalog items
 * @param {number|null} userTmn - user's calculated TMN in mm
 * @returns {Array} ranked items with tmnDistancia, score, recomendada flags
 */
function rankCurvasByTmn(items, userTmn) {
  if (userTmn == null || isNaN(userTmn) || !Array.isArray(items) || items.length === 0) {
    return items.map(c => ({ ...c, tmnDistancia: null, score: null, recomendada: false }));
  }

  const ranked = items.map(c => {
    // Compute score using range if available, fallback to exact tmnMm
    let score = null;
    if (c.tmnMinMm != null || c.tmnMaxMm != null) {
      const lo = c.tmnMinMm ?? c.tmnMaxMm;
      const hi = c.tmnMaxMm ?? c.tmnMinMm;
      if (userTmn >= lo && userTmn <= hi) {
        score = 0;
      } else if (userTmn < lo) {
        score = lo - userTmn;
      } else {
        score = userTmn - hi;
      }
    } else if (c.tmnMm != null) {
      score = Math.abs(c.tmnMm - userTmn);
    }

    return {
      ...c,
      tmnDistancia: c.tmnMm != null ? Math.abs(c.tmnMm - userTmn) : null,
      score,
      recomendada: false,
    };
  });

  ranked.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    if (a.score !== b.score) return a.score - b.score;
    return (a.curveLetter || '').localeCompare(b.curveLetter || '');
  });

  // Mark best-matching group as recommended (score 0 or smallest)
  if (ranked.length > 0 && ranked[0].score != null) {
    const bestScore = ranked[0].score;
    let count = 0;
    for (const c of ranked) {
      if (c.score != null && c.score === bestScore && count < 5) {
        c.recomendada = true;
        count++;
      } else {
        break;
      }
    }
  }

  return ranked;
}

module.exports = {
  getCurvas,
  getCurva,
  createCurva,
  updateCurva,
  deleteCurva,
  regenerarCurva,
  compararConCurva,
  computeEnvolvente,
  getCurvasHermanas,
  generarPuntosTeorica,
  generarPuntosTeoricaValidated,
  normalizeParams,
  rankCurvasByTmn,
  ValidationError,
  FORMULA_MAP,
};
