'use strict';

/**
 * mezclaService.js
 *
 * Servicio de mezclas de agregados: cálculo manual (weighted blend)
 * y optimización LP contra curva teórica o banda IRAM/ASTM.
 */

const {
  normalizeMedidos,
  interpolarLogLineal,
  deducirPorSaturacion,
  calcularModuloFinura,
  calcularTMN,
  evalAgainstSpec,
} = require('./granulometriaEvalService');

const {
  compararConCurva,
  getCurva,
  generarPuntosTeorica,
} = require('./curvaGranulometricaService');

const {
  normalizeFormulaParams,
  resolveFormula,
  FORMULA_MAP,
} = require('./granulometriaCalc');

const {
  EQUIVALENT_SIEVES,
  normalizeSieveSet,
  IRAM_STANDARD_GRID,
  MF_ABERTURAS,
} = require('../catalog/tamicesCatalog');

const { deriveFormaFromItems } = require('../domain/dosificacion/mezclaDerivedMeta');
const { getAggregateFormaMetaMap } = require('./agregadoMetaLookup');
const { validateTransition, isDeletable, isEditable, isImmutable, isFieldEditableInAPrueba } = require('../domain/dosificacion/estadoMachine');
const { calcularHash, buildDatosMezcla, verificarIntegridad } = require('../domain/dosificacion/hashIntegridad');
const crypto = require('crypto');

/** Minimum absolute comparable sieves to attempt optimization */
const MIN_COMPARABLE_SIEVES = 4;
/** Recommended minimum — below this we warn about low confidence */
const RECOMMENDED_COMPARABLE_SIEVES = 6;

/* ════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════ */

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Mapa de equivalencias bidireccional para tamices.
 * 53↔50, 26.5↔25, 13.2↔12.5
 */
const EQUIV_MAP = new Map();
for (const [a, b] of EQUIVALENT_SIEVES) {
  EQUIV_MAP.set(a, b);
  EQUIV_MAP.set(b, a);
}

/**
 * Busca si dos aberturas son iguales o equivalentes.
 */
function aberturaMatch(a, b) {
  if (Math.abs(a - b) < 0.01) return true;
  const alt = EQUIV_MAP.get(a);
  return alt != null && Math.abs(alt - b) < 0.01;
}

/* ════════════════════════════════════════════════════════
   1. Obtener la última granulometría vigente de un agregado
   ════════════════════════════════════════════════════════ */

/**
 * Devuelve los puntos granulométricos normalizados de la última
 * granulometría IRAM 1505 (o IRAM 1627 alternativa) de un agregado.
 *
 * Prioridad: última VIGENTE; si no hay vigente, última cargada.
 */
async function getUltimaGranulometria(db, idAgregado) {
  // Buscar ensayos activos de granulometría para este agregado
  const ensayos = await db.AgregadoEnsayo.findAll({
    where: { legacyAgregadoId: idAgregado, isActive: true },
    include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
    order: [['fechaEnsayo', 'DESC'], ['createdAt', 'DESC']],
  });

  // Filtrar solo granulometrías (IRAM1505, IRAM1627)
  const granulometrias = ensayos.filter(e => {
    const codigo = e.tipo?.codigo || '';
    return codigo.includes('GRANULOMETRIA') || codigo.includes('1505') || codigo.includes('1627');
  });

  if (granulometrias.length === 0) return null;

  // Preferir VIGENTE (cumple != NO_CUMPLE y no eliminado)
  const vigente = granulometrias.find(e => e.cumple !== 'NO_CUMPLE');
  const ensayo = vigente || granulometrias[0]; // fallback a la más reciente

  const resultado = typeof ensayo.resultado === 'string'
    ? JSON.parse(ensayo.resultado)
    : ensayo.resultado;

  if (!resultado?.granulometria?.puntos?.length) return null;

  const puntos = normalizeMedidos(resultado.granulometria.puntos);
  if (puntos.length === 0) return null;

  return {
    idAgregadoEnsayo: ensayo.idAgregadoEnsayo,
    fechaEnsayo: ensayo.fechaEnsayo,
    codigo: ensayo.tipo?.codigo,
    puntos, // [{aberturaMm, pasaPct, tamiz}] sorted desc
  };
}

/* ════════════════════════════════════════════════════════
   2. Construir grilla unificada de tamices
   ════════════════════════════════════════════════════════ */

/**
 * Dadas N curvas de agregados, construye la grilla unificada de tamices.
 * Para equivalentes (13.2↔12.5 etc.) conserva solo uno según preferencia.
 *
 * @param {Array<Array<{aberturaMm, pasaPct}>>} curves — array de curvas normalizadas
 * @param {Array<{aberturaMm}>} [targetPuntos] — puntos del objetivo (banda/curva)
 * @returns {number[]} aberturas unificadas, ascendente
 */
function buildUnifiedGrid(curves, targetPuntos = []) {
  const allAberturas = new Set();

  for (const curve of curves) {
    for (const p of curve) allAberturas.add(p.aberturaMm);
  }
  for (const p of targetPuntos) {
    allAberturas.add(Number(p.aberturaMm));
  }

  // Resolve equivalents: keep the one that has more real data
  const sorted = [...allAberturas].sort((a, b) => a - b);
  const resolved = [];
  const used = new Set();

  for (const ab of sorted) {
    if (used.has(ab)) continue;
    const equiv = EQUIV_MAP.get(ab);
    if (equiv != null && allAberturas.has(equiv) && !used.has(equiv)) {
      // Both exist — count data points for each
      let countAb = 0, countEquiv = 0;
      for (const curve of curves) {
        if (curve.some(p => Math.abs(p.aberturaMm - ab) < 0.01)) countAb++;
        if (curve.some(p => Math.abs(p.aberturaMm - equiv) < 0.01)) countEquiv++;
      }
      // Also check target — prefer the one used by the target
      const inTarget = targetPuntos.some(p => Math.abs(Number(p.aberturaMm) - ab) < 0.01);
      const equivInTarget = targetPuntos.some(p => Math.abs(Number(p.aberturaMm) - equiv) < 0.01);

      let chosen;
      if (inTarget && !equivInTarget) chosen = ab;
      else if (equivInTarget && !inTarget) chosen = equiv;
      else chosen = countAb >= countEquiv ? ab : equiv;

      resolved.push(chosen);
      used.add(ab);
      used.add(equiv);
    } else {
      resolved.push(ab);
      used.add(ab);
    }
  }

  return resolved.sort((a, b) => a - b);
}

/* ════════════════════════════════════════════════════════
   3. Resolver %pasa en la grilla unificada
   ════════════════════════════════════════════════════════ */

/**
 * Para una curva de un agregado, resuelve el %pasa en cada abertura
 * de la grilla unificada. Usa: dato exacto → equiv → interpolación → saturación.
 *
 * @param {Array<{aberturaMm, pasaPct}>} puntosSorted — desc por aberturaMm
 * @param {number[]} grid — aberturas de la grilla unificada (asc)
 * @returns {Array<{aberturaMm, pasaPct, metodo: 'REAL'|'EQUIV'|'INTERPOLADO'|'DEDUCIDO'|null}>}
 */
function resolveOnGrid(puntosSorted, grid) {
  return grid.map(ab => {
    // 1) Dato exacto
    const exact = puntosSorted.find(p => Math.abs(p.aberturaMm - ab) < 0.01);
    if (exact) return { aberturaMm: ab, pasaPct: exact.pasaPct, metodo: 'REAL' };

    // 2) Equivalente
    const equiv = EQUIV_MAP.get(ab);
    if (equiv != null) {
      const equivPt = puntosSorted.find(p => Math.abs(p.aberturaMm - equiv) < 0.01);
      if (equivPt) return { aberturaMm: ab, pasaPct: equivPt.pasaPct, metodo: 'EQUIV' };
    }

    // 3) Interpolación log-lineal
    const interp = interpolarLogLineal(puntosSorted, ab);
    if (interp !== null) return { aberturaMm: ab, pasaPct: round2(interp), metodo: 'INTERPOLADO' };

    // 4) Saturación
    const sat = deducirPorSaturacion(puntosSorted, ab);
    if (sat) return { aberturaMm: ab, pasaPct: sat.pasaPct, metodo: 'DEDUCIDO' };

    return { aberturaMm: ab, pasaPct: null, metodo: null };
  });
}

/* ════════════════════════════════════════════════════════
   4. Calcular mezcla manual (ponderada)
   ════════════════════════════════════════════════════════ */

/**
 * Calcula la curva granulométrica de la mezcla.
 *
 * @param {Array<{puntos, peso}>} agregados — puntos normalizados + peso (0-1, suma=1)
 * @param {number[]} grid — aberturas unificadas (asc)
 * @returns {{
 *   curvaMix: Array<{aberturaMm, pasaPct, metodos: string[]}>,
 *   tmn: object|null,
 *   moduloFinura: object|null,
 * }}
 */
function calcularMezcla(agregados, grid) {
  // Resolve each aggregate on the unified grid
  const resolved = agregados.map(a => ({
    peso: a.peso,
    gridPoints: resolveOnGrid(a.puntos, grid),
  }));

  // Extrapolate null values using monotonicity (same logic as P matrix construction)
  for (const agg of resolved) {
    const pts = agg.gridPoints;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].pasaPct !== null) continue;
      let fromSmaller = null;
      for (let k = i - 1; k >= 0; k--) {
        if (pts[k].pasaPct !== null) { fromSmaller = pts[k].pasaPct; break; }
      }
      let fromLarger = null;
      for (let k = i + 1; k < pts.length; k++) {
        if (pts[k].pasaPct !== null) { fromLarger = pts[k].pasaPct; break; }
      }
      if (fromSmaller !== null && fromLarger !== null) {
        pts[i] = { ...pts[i], pasaPct: round2((fromSmaller + fromLarger) / 2), metodo: 'EXTRAPOLADO' };
      } else if (fromSmaller !== null) {
        pts[i] = { ...pts[i], pasaPct: Math.min(100, fromSmaller), metodo: 'EXTRAPOLADO' };
      } else if (fromLarger !== null) {
        pts[i] = { ...pts[i], pasaPct: Math.max(0, fromLarger), metodo: 'EXTRAPOLADO' };
      }
    }
  }

  const curvaMix = grid.map((ab, idx) => {
    let sum = 0;
    let totalWeight = 0;
    const metodos = [];

    for (const agg of resolved) {
      const pt = agg.gridPoints[idx];
      if (pt.pasaPct !== null) {
        sum += agg.peso * pt.pasaPct;
        totalWeight += agg.peso;
        if (!metodos.includes(pt.metodo)) metodos.push(pt.metodo);
      }
    }

    // B1 fix: When not all aggregates contribute at this sieve (e.g. sand has no data
    // at 0.075mm because the test only went down to 0.150mm, while coarse aggregates
    // are extrapolated to 0), the raw sum UNDERESTIMATES the mix value because missing
    // contributors count as 0. Normalize the partial sum by the participating weight
    // to get the average of the aggregates that actually have data at this sieve.
    // This is a "best estimate" when data is incomplete.
    let finalPasa = null;
    if (totalWeight > 0) {
      if (totalWeight >= 0.999) {
        // All aggregates contributed: sum is the correct weighted pasa %
        finalPasa = round2(sum);
      } else {
        // Partial contribution: normalize to the contributing fraction
        finalPasa = round2(sum / totalWeight);
        metodos.push('EXTRAPOLADO_PARCIAL');
      }
    }

    return {
      aberturaMm: ab,
      tamiz: `${ab} mm`,
      pasaPct: finalPasa,
      metodos,
      completo: totalWeight >= 0.999,
    };
  });

  // TMN and MF from the mixed curve
  const mixNorm = curvaMix
    .filter(p => p.pasaPct !== null)
    .map(p => ({ aberturaMm: p.aberturaMm, pasaPct: p.pasaPct, tamiz: p.tamiz }))
    .sort((a, b) => b.aberturaMm - a.aberturaMm);

  const tmn = calcularTMN(mixNorm);
  const moduloFinura = calcularModuloFinura(mixNorm);

  return { curvaMix, tmn, moduloFinura };
}

/* ════════════════════════════════════════════════════════
   4b. Trazabilidad del cálculo
   ════════════════════════════════════════════════════════ */

/**
 * Builds a structured traceability object for auditing how the mix was computed.
 *
 * @param {Array<{id, peso, puntos, porcentaje}>} agregadosConGrano
 * @param {number[]} grid
 * @param {object} mixResult — { curvaMix, tmn, moduloFinura }
 * @param {object|null} evaluacionBanda
 * @param {object|null} evaluacionTeorica
 * @param {object|null} optimizacionResult
 * @returns {object} trazabilidad
 */
function buildTrazabilidad(agregadosConGrano, grid, mixResult, evaluacionBanda, evaluacionTeorica, optimizacionResult) {
  const { curvaMix, tmn, moduloFinura } = mixResult;

  // ── Tamices ──
  const metodoCounts = { REAL: 0, INTERPOLADO: 0, DEDUCIDO: 0, EQUIV: 0, EXTRAPOLADO: 0 };
  const tamices = curvaMix.map(p => {
    const fuentePrincipal = (p.metodos && p.metodos[0]) || null;
    if (fuentePrincipal && metodoCounts[fuentePrincipal] !== undefined) {
      metodoCounts[fuentePrincipal]++;
    }
    const equiv = EQUIV_MAP.get(p.aberturaMm);
    let observacion = null;
    if (p.metodos?.includes('EQUIV') && equiv != null) {
      observacion = `${p.aberturaMm} reemplaza ${equiv}`;
    } else if (fuentePrincipal === 'INTERPOLADO') {
      observacion = 'Interpolado log-lineal entre tamices adyacentes';
    } else if (fuentePrincipal === 'DEDUCIDO') {
      observacion = 'Deducido por saturación (pasa=100% o 0%)';
    } else if (fuentePrincipal === 'EXTRAPOLADO') {
      observacion = 'Extrapolado por monotonicidad';
    } else if (fuentePrincipal === 'REAL' && p.metodos?.includes('DEDUCIDO')) {
      // Primary source is Real but some individual components were deducido
      observacion = 'Algunos componentes deducidos por saturación';
    }
    return {
      tamiz: p.tamiz,
      aberturaMm: p.aberturaMm,
      pasaMix: p.pasaPct,
      fuenteMix: fuentePrincipal,
      metodos: p.metodos || [],
      observacion,
    };
  });

  // ── Mix breakdown (componentes por tamiz) ──
  const resolved = agregadosConGrano.map(a => {
    const gridPoints = resolveOnGrid(a.puntos, grid);
    // Extrapolate null values using monotonicity (same logic as calcularMezcla)
    for (let i = 0; i < gridPoints.length; i++) {
      if (gridPoints[i].pasaPct !== null) continue;
      let fromSmaller = null;
      for (let k = i - 1; k >= 0; k--) {
        if (gridPoints[k].pasaPct !== null) { fromSmaller = gridPoints[k].pasaPct; break; }
      }
      let fromLarger = null;
      for (let k = i + 1; k < gridPoints.length; k++) {
        if (gridPoints[k].pasaPct !== null) { fromLarger = gridPoints[k].pasaPct; break; }
      }
      if (fromSmaller !== null && fromLarger !== null) {
        gridPoints[i] = { ...gridPoints[i], pasaPct: round2((fromSmaller + fromLarger) / 2), metodo: 'EXTRAPOLADO' };
      } else if (fromSmaller !== null) {
        gridPoints[i] = { ...gridPoints[i], pasaPct: Math.min(100, fromSmaller), metodo: 'EXTRAPOLADO' };
      } else if (fromLarger !== null) {
        gridPoints[i] = { ...gridPoints[i], pasaPct: Math.max(0, fromLarger), metodo: 'EXTRAPOLADO' };
      }
    }
    return {
      id: a.id,
      nombre: a.nombre || `Agregado ${a.id}`,
      porcentaje: a.porcentaje,
      peso: a.peso,
      gridPoints,
    };
  });
  const mixBreakdown = grid.map((ab, idx) => {
    const componentes = resolved.map(agg => {
      const pt = agg.gridPoints[idx];
      return {
        agregadoId: agg.id,
        nombre: agg.nombre,
        porcentaje: agg.porcentaje,
        pasaAgregado: pt.pasaPct,
        aportePonderado: pt.pasaPct !== null ? round2(agg.peso * pt.pasaPct) : null,
        metodo: pt.metodo,
      };
    });
    const mixPt = curvaMix[idx];
    return {
      tamiz: `${ab} mm`,
      aberturaMm: ab,
      componentes,
      pasaFinal: mixPt ? mixPt.pasaPct : null,
    };
  });

  // ── TMN breakdown ──
  const tmnTrace = { criterio: 'TMN = menor tamiz por el que pasa ≥ 95% del material', candidatos: [], resultadoMm: tmn?.valor || null };
  const mixDesc = curvaMix
    .filter(p => p.pasaPct !== null)
    .sort((a, b) => b.aberturaMm - a.aberturaMm);
  for (const pt of mixDesc) {
    tmnTrace.candidatos.push({
      tamiz: pt.tamiz,
      aberturaMm: pt.aberturaMm,
      pasaPct: pt.pasaPct,
      cumple95: pt.pasaPct >= 95,
    });
  }

  // ── MF breakdown ──
  const mfTrace = { tamicesUsados: [], suma: 0, resultado: moduloFinura?.valor || null };
  const mixAsc = curvaMix.filter(p => p.pasaPct !== null).sort((a, b) => a.aberturaMm - b.aberturaMm);
  // Build equivalences lookup for MF trace (same pairs as EQUIVALENT_SIEVES)
  const mfEquivMap = new Map();
  for (const [stdAb, altAb] of EQUIVALENT_SIEVES) {
    if (!mfEquivMap.has(stdAb)) mfEquivMap.set(stdAb, []);
    mfEquivMap.get(stdAb).push(altAb);
    if (!mfEquivMap.has(altAb)) mfEquivMap.set(altAb, []);
    mfEquivMap.get(altAb).push(stdAb);
  }
  for (const ab of MF_ABERTURAS) {
    let pt = mixAsc.find(p => Math.abs(p.aberturaMm - ab) < 0.01);
    let viaEquivalencia = null;
    if (!pt && mfEquivMap.has(ab)) {
      for (const altAb of mfEquivMap.get(ab)) {
        const altPt = mixAsc.find(p => Math.abs(p.aberturaMm - altAb) < 0.01);
        if (altPt) { pt = altPt; viaEquivalencia = altAb; break; }
      }
    }
    const retenidoAcum = pt ? round2(100 - pt.pasaPct) : null;
    mfTrace.tamicesUsados.push({ aberturaMm: ab, pasaPct: pt?.pasaPct ?? null, retenidoAcum, disponible: pt != null, viaEquivalencia });
    if (retenidoAcum !== null) mfTrace.suma += retenidoAcum;
  }
  mfTrace.suma = round2(mfTrace.suma);

  // ── Banda ──
  const bandaTrace = { evaluada: !!evaluacionBanda, rows: [] };
  if (evaluacionBanda) {
    // Build per-sieve rows from series data + fueraDeBanda
    const medida = evaluacionBanda.series?.medida || [];
    const bandaMin = evaluacionBanda.series?.bandaMin || [];
    const bandaMax = evaluacionBanda.series?.bandaMax || [];
    const fueraSet = new Set((evaluacionBanda.fueraDeBanda || []).map(f => f.aberturaMm));

    for (const pt of medida) {
      const ab = pt.aberturaMm;
      const limInfPt = bandaMin.find(b => Math.abs(b.aberturaMm - ab) < 0.01);
      const limSupPt = bandaMax.find(b => Math.abs(b.aberturaMm - ab) < 0.01);
      const limInf = limInfPt?.pasaPct ?? null;
      const limSup = limSupPt?.pasaPct ?? null;
      const esFuera = fueraSet.has(ab);
      let desvio = 0;
      if (esFuera) {
        if (limInf != null && pt.pasaPct < limInf) desvio = round2(pt.pasaPct - limInf);
        else if (limSup != null && pt.pasaPct > limSup) desvio = round2(pt.pasaPct - limSup);
      }
      // Margin alert for sieves INSIDE the band
      let margenInf = null, margenSup = null;
      if (!esFuera) {
        if (limInf != null) margenInf = round2(pt.pasaPct - limInf);
        if (limSup != null) margenSup = round2(limSup - pt.pasaPct);
      }
      bandaTrace.rows.push({
        tamiz: `${ab} mm`,
        aberturaMm: ab,
        pasaMix: round2(pt.pasaPct),
        limInf,
        limSup,
        estado: esFuera ? 'FUERA' : 'DENTRO',
        desvio,
        margenInf,
        margenSup,
      });
    }

    // Compute alertas de margen
    bandaTrace.alertasMargen = bandaTrace.rows
      .filter(r => r.estado === 'DENTRO')
      .reduce((alerts, r) => {
        if (r.margenInf != null && r.margenInf < 3) {
          alerts.push({ tamiz: r.tamiz, aberturaMm: r.aberturaMm, lado: 'inferior', margen: r.margenInf, nivel: r.margenInf < 1 ? 'CRITICO' : 'PREVENTIVO' });
        }
        if (r.margenSup != null && r.margenSup < 3) {
          alerts.push({ tamiz: r.tamiz, aberturaMm: r.aberturaMm, lado: 'superior', margen: r.margenSup, nivel: r.margenSup < 1 ? 'CRITICO' : 'PREVENTIVO' });
        }
        return alerts;
      }, []);
  }

  // ── Curva teórica ──
  const teoricaTrace = { evaluada: !!evaluacionTeorica, rows: [] };
  if (evaluacionTeorica?.series) {
    const med = evaluacionTeorica.series.medida || [];
    const ref = evaluacionTeorica.series.curvaRef || [];
    for (let i = 0; i < ref.length; i++) {
      const refPt = ref[i];
      const refAb = refPt.aberturaMm ?? refPt.x;
      const refY = refPt.pasaPct ?? refPt.y;
      const medPt = med.find(m => Math.abs((m.aberturaMm ?? m.x) - refAb) < 0.01);
      if (refPt && medPt) {
        const medY = medPt.pasaPct ?? medPt.y;
        const errAbs = round2(Math.abs(medY - refY));
        teoricaTrace.rows.push({
          aberturaMm: refAb,
          pasaMix: round2(medY),
          pasaObjetivo: round2(refY),
          errorAbsoluto: errAbs,
          errorCuadratico: round2(errAbs * errAbs),
        });
      }
    }
  }

  // ── Optimización ──
  const optTrace = { disponible: !!optimizacionResult };
  if (optimizacionResult) {
    optTrace.metodo = optimizacionResult.metodo;
    optTrace.factibilidad = optimizacionResult.feasible ? 'FACTIBLE' : 'NO FACTIBLE';
    optTrace.exitosa = optimizacionResult.exitosa;
    optTrace.mensaje = optimizacionResult.mensaje;
    optTrace.comparableSievesCount = optimizacionResult.comparableSievesCount;
    optTrace.rangos = optimizacionResult.rangos;
    optTrace._debug = optimizacionResult._debug;
  }

  return {
    tamices,
    tamicesResumen: {
      total: tamices.length,
      ...metodoCounts,
    },
    mixBreakdown,
    tmn: tmnTrace,
    mf: mfTrace,
    banda: bandaTrace,
    curvaTeorica: teoricaTrace,
    optimizacion: optTrace,
  };
}

/* ════════════════════════════════════════════════════════
   5. Evaluar mezcla contra objetivo
   ════════════════════════════════════════════════════════ */

/**
 * Dual A-B / A-C band evaluation against IRAM 1627 normative data.
 * Mirrors the logic in dosificacionDisenoService.js for consistency.
 *
 * C10: La lógica de evaluación granulométrica de mezcla migró a
 * `domain/compliance/granulometriaMezcla.js` (Nivel 2 canónico). Esta
 * función queda como adapter que devuelve el shape legacy esperado por
 * los renderers del PDF + un `compliance` ya canónico (no más
 * `fromLegacyMezclaEval`). Cuando Prompt 5 amplíe la verificación
 * IRAM 1627 (tolerancia, fracción, MF de mezcla), el módulo canónico
 * absorbe el cambio y este wrapper queda intacto.
 *
 * @param {Array<{aberturaMm, pasaPct}>} curvaMix
 * @param {number} tmnMm — TMN of the combined mix
 * @returns {object|null} evalBanda result compatible with PDF renderer
 */
function evaluarBandaDualIRAM1627(curvaMix, tmnMm) {
  const {
    evaluarGranulometriaMezcla,
    _resolverTablaIRAM1627,
    _buildBandaPuntos,
    _evalContraBanda,
  } = require('../domain/compliance/granulometriaMezcla');
  // Auditoría 01-calidad Fase C R2: el engine ahora recibe sus dependencias
  // (tablas IRAM 1627 + evaluador `evalAgainstSpec`) por inyección. El
  // service-layer las carga aquí, donde sí tiene permitido tocar disco/DB.
  const { loadSeedData } = require('./importIRAM1627Service');
  const { evalAgainstSpec } = require('./granulometriaEvalService');
  const bandasIRAM1627Tablas = loadSeedData()?.totales?.tablas || {};
  const deps = { bandasIRAM1627Tablas, evalContraSpec: evalAgainstSpec };

  // Shape canónico (single source of truth)
  const compliance = evaluarGranulometriaMezcla({ curvaMix, tmnMm }, {}, deps);

  // Si no hay tabla aplicable, mantener back-compat con el null original.
  const tabla = _resolverTablaIRAM1627(tmnMm, bandasIRAM1627Tablas);
  if (!tabla?.curvas?.A || !tabla.curvas.B) return null;

  const tablaRef = tabla.referenciaTabla || `Tabla IRAM 1627 TMN ${tmnMm}`;
  const tamicesMix = curvaMix
    .filter(p => (p.pasaPct ?? p.pasa) != null)
    .map(p => ({
      aberturaMm: p.aberturaMm ?? p.abertura,
      pasaPct: p.pasaPct ?? p.pasa,
      tamiz: p.tamiz || `${p.aberturaMm} mm`,
    }));

  // Reconstruir el detalle dual para back-compat con el shape legacy del PDF.
  // (El módulo canónico computa estos mismos datos internamente; aquí los
  // re-derivamos para mantener el JSON de salida estable.)
  const bandaAB = _buildBandaPuntos(tabla.curvas.A, tabla.curvas.B);
  const evalAB = _evalContraBanda(tamicesMix, bandaAB, evalAgainstSpec);
  let evalAC = null;
  if (tabla.curvas.C) {
    const bandaAC = _buildBandaPuntos(tabla.curvas.A, tabla.curvas.C);
    evalAC = _evalContraBanda(tamicesMix, bandaAC, evalAgainstSpec);
  }

  if (evalAB.cumple) {
    return {
      tipo: 'BANDA',
      cumple: true,
      estado: 'CUMPLE',
      fueraDeBanda: [],
      stats: evalAB.stats,
      series: evalAB.series,
      bandaEvaluada: 'A-B',
      tablaRef,
      evalDual: { evalAB, evalAC: null },
      compliance,
    };
  }

  if (evalAC?.cumple) {
    return {
      tipo: 'BANDA',
      cumple: true, // cumple A-C
      estado: 'CUMPLE_AC',
      fueraDeBanda: evalAB.fueraDeBanda,
      stats: { ...evalAC.stats, nFueraAB: evalAB.nFuera, maxDesvioAB: evalAB.maxDesvioAbs },
      series: evalAC.series,
      bandaEvaluada: 'A-C',
      tablaRef,
      mensaje: `Cumple banda A-C pero no A-B (${evalAB.nFuera} tamiz(es) fuera de A-B, desvio max. ${evalAB.maxDesvioAbs.toFixed(1)} pp)`,
      evalDual: { evalAB, evalAC },
      compliance,
    };
  }

  // No cumple ni A-C
  const ref = evalAC || evalAB;
  return {
    tipo: 'BANDA',
    cumple: false,
    estado: 'NO_CUMPLE',
    fueraDeBanda: ref.fueraDeBanda,
    stats: { ...ref.stats, nFuera: ref.nFuera, peorDesvioPct: ref.maxDesvioAbs },
    series: ref.series,
    bandaEvaluada: evalAC ? 'A-C' : 'A-B',
    tablaRef,
    mensaje: `No cumple banda ${evalAC ? 'A-C' : 'A-B'}: ${ref.nFuera} tamiz(es) fuera (desvio max. ${ref.maxDesvioAbs.toFixed(1)} pp)`,
    compliance,
    evalDual: { evalAB, evalAC },
  };
}

/**
 * Evalúa la curva de mezcla contra un objetivo (banda o curva teórica).
 *
 * @param {Array<{aberturaMm, pasaPct}>} curvaMix
 * @param {object} curvaObj — curva from DB (con tipo, specMode, puntos, etc.)
 * @returns {object} resultado de evaluación
 */
function evaluarContraObjetivo(curvaMix, curvaObj) {
  if (!curvaObj) return null;

  const tamicesMix = curvaMix
    .filter(p => p.pasaPct !== null)
    .map(p => ({ aberturaMm: p.aberturaMm, pasaPct: p.pasaPct, tamiz: p.tamiz || `${p.aberturaMm} mm` }));

  if (curvaObj.tipo === 'BANDA') {
    const specPuntos = (curvaObj.puntos || []).filter(p => !p.isNA);
    const result = evalAgainstSpec({
      medidos: tamicesMix,
      spec: { specMode: curvaObj.specMode || 'RANGO', puntos: specPuntos },
    });
    return {
      tipo: 'BANDA',
      cumple: result.cumple,
      estado: result.estado,
      fueraDeBanda: result.fueraDeBanda,
      stats: result.stats,
      series: result.series,
      calculos: result.calculos,
    };
  }

  // TEORICA / TABULADA — try formula evaluation first, then fall back to compararConCurva
  const params = normalizeFormulaParams(curvaObj.parametros);
  const fn = resolveFormula(params.formulaKey || params.formula);

  if (fn && curvaObj.tipo === 'TEORICA') {
    // Evaluate formula directly at each mix sieve for maximum coverage
    const cutoffMm = params.D || params.dmax || curvaObj.tmnMm || null;
    const desvios = [];
    let sumSq = 0;
    let count = 0;

    for (const m of tamicesMix) {
      if (cutoffMm != null && m.aberturaMm > cutoffMm * 1.01) continue;
      let target = fn(m.aberturaMm, params);
      target = Math.max(0, Math.min(100, round2(target)));
      const error = round2(m.pasaPct - target);
      desvios.push({
        tamiz: m.tamiz,
        aberturaMm: m.aberturaMm,
        pasaPctMuestra: m.pasaPct,
        pasaPctCurva: target,
        error,
        errorAbs: round2(Math.abs(error)),
      });
      sumSq += error * error;
      count++;
    }

    const sumAbsRaw = desvios.reduce((s, d) => s + d.errorAbs, 0);
    const rmse = count > 0 ? round2(Math.sqrt(sumSq / count)) : null;
    const mae = count > 0 ? round2(sumAbsRaw / count) : null;
    const sumaAbs = count > 0 ? round2(sumAbsRaw) : null;
    const maxDesvio = desvios.length > 0 ? round2(Math.max(...desvios.map(d => d.errorAbs))) : null;

    let r2 = null;
    if (count > 1) {
      const meanMuestra = desvios.reduce((s, d) => s + d.pasaPctMuestra, 0) / count;
      const ssTot = desvios.reduce((s, d) => s + Math.pow(d.pasaPctMuestra - meanMuestra, 2), 0);
      r2 = ssTot > 0 ? Math.round((1 - sumSq / ssTot) * 10000) / 10000 : null;
    }

    const worstSieves = [...desvios].sort((a, b) => b.errorAbs - a.errorAbs).slice(0, 5);
    const seriesDesvios = [...desvios].sort((a, b) => a.aberturaMm - b.aberturaMm);

    return {
      tipo: 'TEORICA',
      rmse,
      mae,
      r2,
      maxDesvio,
      worstSieves,
      sumaAbs,
      series: {
        medida: seriesDesvios.map(d => ({ aberturaMm: d.aberturaMm, pasaPct: d.pasaPctMuestra })),
        curvaRef: seriesDesvios.map(d => ({ aberturaMm: d.aberturaMm, pasaPct: d.pasaPctCurva })),
      },
      cantidadComparados: count,
      observaciones: [],
    };
  }

  // Fallback: use compararConCurva for TABULADA or when formula not found
  const result = compararConCurva(tamicesMix, curvaObj);
  if (!result) return null;

  return {
    tipo: result.tipo || 'TEORICA',
    rmse: result.rmse,
    mae: result.mae,
    r2: result.r2,
    maxDesvio: result.maxDesvio,
    worstSieves: result.worstSieves,
    sumaAbs: result.sumaAbs,
    series: result.series,
    observaciones: result.observaciones,
  };
}

/* ════════════════════════════════════════════════════════
   6. Endpoint: Evaluar mezcla manual
   ════════════════════════════════════════════════════════ */

/**
 * POST /api/mezclas/evaluar
 *
 * body: {
 *   plantaId, tipoMezcla, objetivoId?,
 *   agregados: [{ id, porcentaje }]  // porcentaje 0-100, suma=100
 * }
 */
async function evaluar(db, body) {
  const { plantaId, tipoMezcla, agregados: inputAgregados, objetivoId } = body;

  if (!plantaId) throw new Error('plantaId es requerido');
  if (!tipoMezcla) throw new Error('tipoMezcla es requerido');
  if (!Array.isArray(inputAgregados) || inputAgregados.length < 2) {
    throw new Error('Se requieren al menos 2 agregados');
  }

  // Validate percentages
  const totalPct = inputAgregados.reduce((s, a) => s + Number(a.porcentaje || 0), 0);
  if (Math.abs(totalPct - 100) > 0.5) {
    throw new Error(`La suma de porcentajes debe ser 100% (actual: ${round2(totalPct)}%)`);
  }

  // Fetch granulometries for each aggregate
  const agregadosConGrano = [];
  const errores = [];

  for (const input of inputAgregados) {
    if (input.id < 0) {
      const mezcla = await db.MezclaAgregados.findByPk(-input.id);
      let curvaRaw = mezcla?.curvaMezclaJson;
      if (typeof curvaRaw === 'string') { try { curvaRaw = JSON.parse(curvaRaw); } catch { curvaRaw = null; } }
      const puntosMezcla = normalizeMedidos(Array.isArray(curvaRaw) ? curvaRaw : []);
      if (!mezcla || puntosMezcla.length === 0) {
        errores.push({ id: input.id, error: 'Mezcla guardada sin curva granulométrica' });
        continue;
      }
      agregadosConGrano.push({
        id: input.id,
        porcentaje: Number(input.porcentaje),
        peso: Number(input.porcentaje) / 100,
        puntos: puntosMezcla,
        fuente: { mezclaId: -input.id, nombre: mezcla.nombre },
      });
      continue;
    }
    const grano = await getUltimaGranulometria(db, input.id);
    if (!grano) {
      errores.push({ id: input.id, error: 'No tiene granulometría cargada' });
      continue;
    }
    // Fetch aggregate name (for traceability and CIRSOC observations — MEJ-1)
    let nombreAg = input.nombre || null;
    if (!nombreAg && db.Agregado) {
      try {
        const agRow = await db.Agregado.findByPk(input.id, { attributes: ['nombre'] });
        nombreAg = agRow?.nombre || null;
      } catch { /* ignore */ }
    }
    agregadosConGrano.push({
      id: input.id,
      nombre: nombreAg,
      porcentaje: Number(input.porcentaje),
      peso: Number(input.porcentaje) / 100,
      puntos: grano.puntos,
      fuente: {
        idAgregadoEnsayo: grano.idAgregadoEnsayo,
        fechaEnsayo: grano.fechaEnsayo,
        codigo: grano.codigo,
      },
    });
  }

  if (agregadosConGrano.length < 2) {
    throw new Error(
      `No hay suficientes agregados con granulometría. Faltantes: ${errores.map(e => `ID ${e.id}: ${e.error}`).join(', ')}`
    );
  }

  // Fetch objective curve if provided
  let curvaObj = null;
  let targetPuntos = [];
  if (objetivoId) {
    curvaObj = await getCurva(db, objetivoId);
    if (!curvaObj) throw new Error(`Curva objetivo #${objetivoId} no encontrada`);
    if (curvaObj.tipo === 'TEORICA') {
      const pts = curvaObj.puntosCalculados || generarPuntosTeorica(curvaObj);
      targetPuntos = pts.filter(p => !p.isNA);
    } else {
      targetPuntos = (curvaObj.puntos || []).filter(p => !p.isNA);
    }
  }

  // Build unified sieve grid
  const curves = agregadosConGrano.map(a => a.puntos);
  const grid = buildUnifiedGrid(curves, targetPuntos);

  // Calculate mix
  const { curvaMix, tmn, moduloFinura } = calcularMezcla(agregadosConGrano, grid);

  // Evaluate against objective
  let evaluacion = null;
  if (curvaObj) {
    evaluacion = evaluarContraObjetivo(curvaMix, curvaObj);
  }

  // ── Dual band evaluation (IRAM 1627 A-B / A-C) for TOTAL mixes ──
  // This aligns the mezcla module with the dosificación module's dual evaluation.
  let evalBandaDual = null;
  if (tipoMezcla === 'TOTAL' && tmn && curvaMix.length > 0) {
    try {
      evalBandaDual = evaluarBandaDualIRAM1627(curvaMix, tmn);
    } catch (e) {
      console.warn('[mezcla] Dual band evaluation failed:', e.message);
    }
  }

  // Use dual evaluation if available; otherwise fall back to single-band evaluation
  const evalBandaRaw = evaluacion?.tipo === 'BANDA' ? evaluacion : null;
  const evalBanda = evalBandaDual || evalBandaRaw;
  const evalTeorica = evaluacion?.tipo === 'TEORICA' ? evaluacion : null;

  // Build traceability
  const trazabilidad = buildTrazabilidad(agregadosConGrano, grid, { curvaMix, tmn, moduloFinura }, evalBanda, evalTeorica, null);

  // ── Combined physical/chemical properties ──
  let propiedadesCombinadas = null;
  let evaluacionPropiedades = null;
  try {
    // Auditoría 01-calidad Fase C R3: `calcularPropiedadesCombinadas` (DB-aware)
    // se movió a service; `evaluarPropiedadesCombinadas` sigue en domain.
    const { calcularPropiedadesCombinadas } = require('./mezclaPropsService');
    const { evaluarPropiedadesCombinadas } = require('../domain/mezclaPropsEngine');
    const propsResult = await calcularPropiedadesCombinadas(db, agregadosConGrano.map(a => ({ idAgregado: a.id, nombre: a.nombre, porcentaje: a.porcentaje })));
    propiedadesCombinadas = propsResult;
    evaluacionPropiedades = evaluarPropiedadesCombinadas(propsResult.combinadas, tipoMezcla, propsResult.componentes);
  } catch (err) {
    console.error('[mezcla evaluar] Error calculating combined properties:', err.message);
  }

  return {
    tipoMezcla,
    plantaId,
    agregados: agregadosConGrano.map(a => ({
      id: a.id,
      porcentaje: a.porcentaje,
      fuente: a.fuente,
    })),
    curvaMix,
    tmn,
    moduloFinura,
    evaluacion,
    propiedadesCombinadas,
    evaluacionPropiedades,
    trazabilidad,
    errores: errores.length > 0 ? errores : undefined,
  };
}

/* ════════════════════════════════════════════════════════
   6b. Dynamic theoretical curve generation
   ════════════════════════════════════════════════════════ */

/** Canonical family name → FORMULA_MAP key */
const FAMILIA_MAP = {
  FULLER: 'FULLER_TALBOT', TALBOT: 'FULLER_TALBOT', FULLER_TALBOT: 'FULLER_TALBOT',
  MAA: 'ANDREASEN_MOD', ANDREASEN_MOD: 'ANDREASEN_MOD',
  ANDREASEN: 'ANDREASEN',
  ROSIN_RAMMLER: 'ROSIN_RAMMLER',
};

/** Supported TMN values for TOTAL mixes */
const TMN_OPTIONS = [9.5, 13.2, 19, 25, 37.5, 50];

/**
 * Build a virtual TEORICA curve object from formula parameters.
 * Does NOT persist anything — returns a plain object suitable for
 * buildTheoreticalTargetsOnGrid / evaluarContraObjetivo.
 */
function buildVirtualTeorica({ familia, tmnObjetivoMm, parametroPrincipal, dmin, serieTamices, nombre }) {
  const familiaUpper = (familia || '').toUpperCase();
  const formulaKey = FAMILIA_MAP[familiaUpper] || familiaUpper;
  const fn = resolveFormula(formulaKey);
  if (!fn) throw new Error(`Familia de curva teórica no reconocida: ${familia}`);

  const D = Number(tmnObjetivoMm || 25);
  const paramKey = formulaKey === 'FULLER_TALBOT' ? 'n' : 'q';
  const paramVal = parametroPrincipal != null ? Number(parametroPrincipal) : undefined;

  const parametros = { formulaKey, D, dmax: D };
  if (paramVal != null) parametros[paramKey] = paramVal;
  if (dmin != null) parametros.dmin = Number(dmin);

  const displayParam = paramVal != null ? `${paramKey}=${paramVal}` : '';
  const displayName = nombre || `${familia} ${displayParam} — Total (TMN ${D})`.trim();

  return {
    tipo: 'TEORICA',
    familia: familiaUpper,
    tmnMm: D,
    serieTamices: serieTamices || 'IRAM',
    parametros,
    nombre: displayName,
  };
}

/**
 * Generate preview points for a dynamic theoretical curve.
 * Returns { curva, puntos } where puntos is an array of {aberturaMm, pasaPct, tamiz, isNA}.
 */
function previewCurvaTeorica(params) {
  const curva = buildVirtualTeorica(params);
  const puntos = generarPuntosTeorica(curva).filter(p => !p.isNA);
  return { curva, puntos };
}

/* ════════════════════════════════════════════════════════
   7. Optimización LP
   ════════════════════════════════════════════════════════ */

/**
 * POST /api/mezclas/optimizar
 *
 * body: {
 *   plantaId, tipoMezcla,
 *   agregadosIds: [id1, id2, ...],
 *   constraints?: { min?: {id: pct}, max?: {id: pct}, fixed?: {id: pct} },
 *
 *   // Legacy (backward compat)
 *   objetivoId?,
 *   bandaCompuesta?,
 *
 *   // New: priority-based combined optimization
 *   objetivoModo?: 'BANDA' | 'CURVA' | 'COMBINADO',
 *   bandaId?, curvaTeoricaId?,
 *   prioridad1?: 'BANDA' | 'CURVA',
 *   prioridad2?: 'BANDA' | 'CURVA',
 * }
 */
async function optimizar(db, body) {
  const { plantaId, tipoMezcla, agregadosIds, constraints } = body;

  // Resolve objective parameters (backward compat + new style)
  let { objetivoModo, bandaId, curvaTeoricaId, prioridad1, prioridad2 } = body;
  const { objetivoId, bandaCompuesta } = body;

  // ── Tipología: load config if provided ──
  let tipologiaConfig = null;
  if (body.tipologiaCodigo) {
    try {
      const tipSvc = require('./tipologiaHormigonService');
      tipologiaConfig = await tipSvc.obtenerPorCodigo(db, body.tipologiaCodigo);
    } catch (e) { /* tipología not found — proceed without */ }
  }

  // Backward compat: map old-style params to new style
  if (!objetivoModo) {
    if (bandaCompuesta || (objetivoId && !curvaTeoricaId)) {
      objetivoModo = 'BANDA';
      if (!bandaId && objetivoId) bandaId = objetivoId;
    } else if (curvaTeoricaId || objetivoId) {
      objetivoModo = 'CURVA';
      if (!curvaTeoricaId && objetivoId) curvaTeoricaId = objetivoId;
    }
  }

  if (!plantaId) throw new Error('plantaId es requerido');
  if (!tipoMezcla) throw new Error('tipoMezcla es requerido');
  if (!objetivoModo && !objetivoId && !bandaCompuesta) throw new Error('objetivoId o objetivoModo es requerido para optimización');
  if (!Array.isArray(agregadosIds) || agregadosIds.length < 2) {
    throw new Error('Se requieren al menos 2 agregados');
  }

  // Fetch granulometries
  const agregadosConGrano = [];
  const errores = [];

  for (const id of agregadosIds) {
    if (id < 0) {
      // Negative ID → saved mix used as a virtual aggregate
      const mezcla = await db.MezclaAgregados.findByPk(-id);
      let curvaRaw = mezcla?.curvaMezclaJson;
      if (typeof curvaRaw === 'string') { try { curvaRaw = JSON.parse(curvaRaw); } catch { curvaRaw = null; } }
      const puntosMezcla = normalizeMedidos(Array.isArray(curvaRaw) ? curvaRaw : []);
      if (!mezcla || puntosMezcla.length === 0) {
        errores.push({ id, error: 'Mezcla guardada sin curva granulométrica' });
        continue;
      }
      agregadosConGrano.push({
        id,
        nombre: mezcla.nombre,
        puntos: puntosMezcla,
        fuente: { mezclaId: -id, nombre: mezcla.nombre },
      });
      continue;
    }
    const grano = await getUltimaGranulometria(db, id);
    if (!grano) {
      errores.push({ id, error: 'No tiene granulometría cargada' });
      continue;
    }
    agregadosConGrano.push({ id, puntos: grano.puntos, fuente: {
      idAgregadoEnsayo: grano.idAgregadoEnsayo,
      fechaEnsayo: grano.fechaEnsayo,
      codigo: grano.codigo,
    }});
  }

  if (agregadosConGrano.length < 2) {
    throw new Error('No hay suficientes agregados con granulometría para optimizar');
  }

  // Fetch objective curve(s) based on mode
  let curvaObjBanda = null;  // band curve (for BANDA or COMBINADO)
  let curvaObjTeorica = null; // theoretical curve (for CURVA or COMBINADO)
  let bandaPuntos = [];
  let teoricaPuntos = [];

  // Helper: build composite band from min+max curves
  async function buildBandaCompuesta(bc) {
    const [curvaMin, curvaMax] = await Promise.all([
      getCurva(db, bc.idCurvaMin),
      getCurva(db, bc.idCurvaMax),
    ]);
    if (!curvaMin) throw new Error(`Curva límite inferior #${bc.idCurvaMin} no encontrada`);
    if (!curvaMax) throw new Error(`Curva límite superior #${bc.idCurvaMax} no encontrada`);

    const pMin = (curvaMin.puntos || []).filter(p => !p.isNA);
    const pMax = (curvaMax.puntos || []).filter(p => !p.isNA);

    const aberturaMap = new Map();
    for (const p of pMin) {
      aberturaMap.set(Number(p.aberturaMm), {
        aberturaMm: Number(p.aberturaMm),
        tamiz: p.tamiz,
        limInfPct: p.limSupPct ?? p.pasaPct ?? p.targetPct ?? 0,
        limSupPct: 100,
        isNA: false,
      });
    }
    for (const p of pMax) {
      const ab = Number(p.aberturaMm);
      const existing = aberturaMap.get(ab) || {
        aberturaMm: ab,
        tamiz: p.tamiz,
        limInfPct: 0,
        isNA: false,
      };
      existing.limSupPct = p.limSupPct ?? p.pasaPct ?? p.targetPct ?? 100;
      aberturaMap.set(ab, existing);
    }

    return [...aberturaMap.values()];
  }

  // Load band objective
  if (objetivoModo === 'BANDA' || objetivoModo === 'COMBINADO') {
    if (bandaCompuesta?.idCurvaMin && bandaCompuesta?.idCurvaMax) {
      bandaPuntos = await buildBandaCompuesta(bandaCompuesta);
      curvaObjBanda = { tipo: 'BANDA', specMode: 'RANGO', puntos: bandaPuntos };
    } else if (bandaId) {
      curvaObjBanda = await getCurva(db, bandaId);
      if (!curvaObjBanda) throw new Error(`Curva banda #${bandaId} no encontrada`);
      bandaPuntos = (curvaObjBanda.puntos || []).filter(p => !p.isNA);
    }
  }

  // Load theoretical curve objective
  if (objetivoModo === 'CURVA' || objetivoModo === 'COMBINADO') {
    if (body.curvaGenerada) {
      // Dynamic curve: build a virtual TEORICA object from formula params
      curvaObjTeorica = buildVirtualTeorica(body.curvaGenerada);
      teoricaPuntos = generarPuntosTeorica(curvaObjTeorica).filter(p => !p.isNA);
    } else if (curvaTeoricaId) {
      curvaObjTeorica = await getCurva(db, curvaTeoricaId);
      if (!curvaObjTeorica) throw new Error(`Curva teórica #${curvaTeoricaId} no encontrada`);
      teoricaPuntos = (curvaObjTeorica.puntosCalculados || generarPuntosTeorica(curvaObjTeorica)).filter(p => !p.isNA);
    }
  }

  // Backward compat: if neither explicitly loaded, use old-style objetivoId
  if (!curvaObjBanda && !curvaObjTeorica && objetivoId) {
    const curvaObj = await getCurva(db, objetivoId);
    if (!curvaObj) throw new Error(`Curva objetivo #${objetivoId} no encontrada`);
    if (curvaObj.tipo === 'BANDA') {
      curvaObjBanda = curvaObj;
      bandaPuntos = (curvaObj.puntos || []).filter(p => !p.isNA);
      if (!objetivoModo) objetivoModo = 'BANDA';
    } else {
      curvaObjTeorica = curvaObj;
      teoricaPuntos = (curvaObj.puntosCalculados || generarPuntosTeorica(curvaObj)).filter(p => !p.isNA);
      if (!objetivoModo) objetivoModo = 'CURVA';
    }
  }

  // ── Warnings collector (initialized early for tipología messages) ──
  const warnings = [];

  // ── Tipología: auto-generate theoretical curve if none was explicitly set ──
  if (tipologiaConfig && !curvaObjTeorica && tipologiaConfig.curvaFamilia) {
    const tipCurva = buildVirtualTeorica({
      familia: tipologiaConfig.curvaFamilia,
      tmnObjetivoMm: body.tmnObjetivoMm || 25,
      parametroPrincipal: Number(tipologiaConfig.curvaExponente) || 0.5,
      serieTamices: body.serieTamices || 'IRAM',
      nombre: `Curva ${tipologiaConfig.nombre}`,
    });
    curvaObjTeorica = tipCurva;
    teoricaPuntos = generarPuntosTeorica(tipCurva).filter(p => !p.isNA);

    // If only band was set, upgrade to COMBINADO with BANDA priority
    if (objetivoModo === 'BANDA' && curvaObjBanda) {
      objetivoModo = 'COMBINADO';
      if (!prioridad1) prioridad1 = 'BANDA';
      if (!prioridad2) prioridad2 = 'CURVA';
      warnings.push({
        code: 'TIPOLOGIA_CURVE_ADDED',
        message: `Tipología "${tipologiaConfig.nombre}" agrega curva objetivo ${tipologiaConfig.curvaFamilia} (exp. ${tipologiaConfig.curvaExponente}). Optimización combinada: banda + curva tipológica.`,
      });
    } else if (!objetivoModo || (!curvaObjBanda && !objetivoModo)) {
      objetivoModo = 'CURVA';
    }
  }

  if (!curvaObjBanda && !curvaObjTeorica) {
    throw new Error('No se pudo cargar ningún objetivo para la optimización');
  }

  // Build unified sieve grid from all objectives
  const allTargetPuntos = [...bandaPuntos, ...teoricaPuntos];
  const curves = agregadosConGrano.map(a => a.puntos);
  const grid = buildUnifiedGrid(curves, allTargetPuntos);
  const N = agregadosConGrano.length;
  const M = grid.length;

  // Resolve each aggregate on the grid
  const matrices = agregadosConGrano.map(a => resolveOnGrid(a.puntos, grid));

  // Build P matrix: P[i][j] = aggregate j's %pasa at sieve i
  const P = buildPMatrix(M, N, matrices);

  // Build target values for band
  const bandTargetsOnGrid = curvaObjBanda ? buildTargetsOnGrid(grid, bandaPuntos, true) : [];

  // Build target values for theoretical curve — generate directly on grid via formula
  let teoricaTargetsOnGrid = [];
  if (curvaObjTeorica) {
    teoricaTargetsOnGrid = buildTheoreticalTargetsOnGrid(grid, curvaObjTeorica);

    // Debug: if targets came back empty, log diagnostic info
    if (teoricaTargetsOnGrid.length === 0) {
      const raw = curvaObjTeorica.parametros;
      const parsedParams = normalizeFormulaParams(raw);
      const fKey = parsedParams.formulaKey || parsedParams.formula;
      console.warn('[optimizar] buildTheoreticalTargetsOnGrid returned 0 targets.',
        'formulaKey:', fKey, 'resolveFormula:', !!resolveFormula(fKey),
        'parametros type:', typeof raw, 'grid.length:', grid.length,
        'puntosCalculados.length:', (curvaObjTeorica.puntosCalculados || []).length);
    }
  }

  // ── Build comparable sieve set for theoretical curve optimization ──
  let teoricaComparableSieves = [];
  if (teoricaTargetsOnGrid.length > 0) {
    teoricaComparableSieves = buildComparableSieveSet(grid, P, N, teoricaTargetsOnGrid);
  }

  // Debug diagnostic for dev environments
  const _debugTeorica = curvaObjTeorica ? {
    formulaKey: (() => {
      const p = normalizeFormulaParams(curvaObjTeorica.parametros);
      return p.formulaKey || p.formula || null;
    })(),
    formulaResolved: (() => {
      const p = normalizeFormulaParams(curvaObjTeorica.parametros);
      return !!resolveFormula(p.formulaKey || p.formula);
    })(),
    parametrosType: typeof curvaObjTeorica.parametros,
    gridLength: grid.length,
    targetsOnGridCount: teoricaTargetsOnGrid.length,
    comparableCount: teoricaComparableSieves.length,
  } : null;

  const needsTheoreticalValidation = (objetivoModo === 'CURVA') ||
    (objetivoModo === 'COMBINADO' && curvaObjTeorica);

  // ── Check minimum comparable sieves for theoretical curve modes ──
  if (needsTheoreticalValidation && teoricaComparableSieves.length < MIN_COMPARABLE_SIEVES) {
    // INSUFFICIENT DATA — return early with ok=false
    // For COMBINADO, we can still try band-only optimization
    if (objetivoModo === 'COMBINADO' && curvaObjBanda && bandTargetsOnGrid.length > 0) {
      warnings.push({
        code: 'INSUFFICIENT_COMPARABLE_SIEVES_TEORICA',
        message: `Solo ${teoricaComparableSieves.length} tamices comparables con la curva teórica (mínimo absoluto: ${MIN_COMPARABLE_SIEVES}). Optimizando solo contra banda.`,
      });
      objetivoModo = 'BANDA';
      teoricaTargetsOnGrid = [];
    } else {
      return {
        tipoMezcla,
        plantaId,
        objetivoModo: objetivoModo || 'CURVA',
        prioridad1: prioridad1 || null,
        prioridad2: prioridad2 || null,
        agregados: agregadosConGrano.map(a => ({
          id: a.id,
          porcentaje: round2(100 / agregadosConGrano.length),
          fuente: a.fuente,
        })),
        curvaMix: [],
        tmn: null,
        moduloFinura: null,
        evaluacion: null,
        evaluacionBanda: null,
        evaluacionTeorica: null,
        optimizacion: {
          ok: false,
          metodo: null,
          exitosa: false,
          metrica: null,
          mensaje: `No hay tamices comparables suficientes para optimizar contra la curva teórica seleccionada (${teoricaComparableSieves.length} de ${MIN_COMPARABLE_SIEVES} requeridos)`,
          reason: 'INSUFFICIENT_COMPARABLE_SIEVES',
          comparableSievesCount: teoricaComparableSieves.length,
          comparableSieves: teoricaComparableSieves.map(t => ({ ab: t.ab, target: t.target, metodo: t.metodo || 'FORMULA' })),
          _debug: _debugTeorica,
          feasible: false,
          rangos: [],
        },
        resumen: {},
        warnings: [{
          code: 'INSUFFICIENT_COMPARABLE_SIEVES',
          message: `Solo ${teoricaComparableSieves.length} tamices comparables con la curva teórica (mínimo: ${MIN_COMPARABLE_SIEVES})`,
        }],
        errores: errores.length > 0 ? errores : undefined,
      };
    }
  } else if (needsTheoreticalValidation && teoricaComparableSieves.length < RECOMMENDED_COMPARABLE_SIEVES) {
    warnings.push({
      code: 'LOW_COMPARABLE_SIEVES',
      message: `Optimización con baja densidad de puntos comparables (${teoricaComparableSieves.length}). Resultado menos confiable. Se recomiendan al menos ${RECOMMENDED_COMPARABLE_SIEVES}.`,
    });
  }

  // ── Solve based on mode ──
  let result;
  let evaluacionBanda = null;
  let evaluacionTeorica = null;

  if (objetivoModo === 'COMBINADO' && curvaObjBanda && curvaObjTeorica) {
    if (!prioridad1) prioridad1 = 'BANDA';
    if (!prioridad2) prioridad2 = prioridad1 === 'BANDA' ? 'CURVA' : 'BANDA';

    result = solveCombinedLP(N, bandTargetsOnGrid, teoricaTargetsOnGrid, P, grid,
      constraints, agregadosConGrano, prioridad1);
  } else if (curvaObjBanda && !curvaObjTeorica) {
    result = solveMixLP(N, bandTargetsOnGrid, P, grid, true, constraints, agregadosConGrano);
  } else if (curvaObjBanda && objetivoModo === 'BANDA') {
    result = solveMixLP(N, bandTargetsOnGrid, P, grid, true, constraints, agregadosConGrano);
  } else {
    result = solveTheoreticalLP(N, teoricaTargetsOnGrid, P, grid, constraints, agregadosConGrano);
  }

  // Calculate final mix with optimal weights
  const optimalAgregados = agregadosConGrano.map((a, j) => ({
    ...a,
    peso: result.weights[j],
    porcentaje: round2(result.weights[j] * 100),
  }));

  const { curvaMix, tmn, moduloFinura } = calcularMezcla(optimalAgregados, grid);

  // Evaluate against both objectives (if present)
  if (curvaObjBanda) {
    evaluacionBanda = evaluarContraObjetivo(curvaMix, curvaObjBanda);
  }
  if (curvaObjTeorica) {
    evaluacionTeorica = evaluarContraObjetivo(curvaMix, curvaObjTeorica);
  }

  // Primary evaluacion for backward compat
  const evaluacion = evaluacionBanda || evaluacionTeorica;

  // Compute feasible ranges for each aggregate (use band if available, else theoretical)
  const primaryTargets = bandTargetsOnGrid.length > 0 ? bandTargetsOnGrid : teoricaTargetsOnGrid;
  const primaryIsBand = bandTargetsOnGrid.length > 0;
  const rangos = computeFeasibleRanges(N, primaryTargets, P, grid, primaryIsBand, constraints, agregadosConGrano);

  // Build result summary for COMBINADO
  const resumen = {};
  if (evaluacionBanda) {
    resumen.bandaCumple = evaluacionBanda.cumple;
    resumen.fueraDeBanda = evaluacionBanda.fueraDeBanda?.length || 0;
  }
  if (evaluacionTeorica) {
    resumen.errorTeorico = {
      mae: evaluacionTeorica.mae,
      rmse: evaluacionTeorica.rmse,
      maxDesvio: evaluacionTeorica.maxDesvio,
    };
  }

  // Sanity check: if theoretical evaluation shows MAE=0 but there were real targets,
  // ensure this is legitimate (actual point-by-point match)
  const optimizacionOk = result.exitosa !== false;

  const optimizacionObj = {
    ok: optimizacionOk,
    metodo: result.metodo,
    exitosa: result.exitosa,
    metrica: result.metrica,
    mensaje: result.mensaje,
    feasible: result.feasible,
    rangos,
    comparableSievesCount: teoricaComparableSieves.length > 0 ? teoricaComparableSieves.length : undefined,
    comparableSieves: teoricaComparableSieves.length > 0
      ? teoricaComparableSieves.map(t => ({ ab: t.ab, target: t.target, metodo: t.metodo || 'FORMULA' }))
      : undefined,
    _debug: _debugTeorica || undefined,
  };

  // ── Tipología: post-optimization restriction validation ──
  if (tipologiaConfig) {
    const rg = tipologiaConfig.restriccionesGranulometricas || {};
    const tipNombre = tipologiaConfig.nombre || tipologiaConfig.codigo;

    // Helper: find %pasa at a given aperture (mm) from curvaMix
    const pasaAt = (abMm) => {
      const pt = curvaMix.find(p => Math.abs(Number(p.aberturaMm) - abMm) < 0.001);
      return pt ? Number(pt.pasaPct) : null;
    };

    // Check pasa_0_15_min
    if (rg.pasa_0_15_min != null) {
      const val = pasaAt(0.15);
      if (val != null && val < rg.pasa_0_15_min) {
        warnings.push({
          code: 'TIPOLOGIA_PASA_015',
          message: `[${tipNombre}] El contenido de finos pasante del tamiz 0,15 mm (${val.toFixed(1)}%) puede ser insuficiente. Se recomienda un mínimo de ${rg.pasa_0_15_min}%.`,
        });
      }
    }
    // Check pasa_0_30_min
    if (rg.pasa_0_30_min != null) {
      const val = pasaAt(0.3);
      if (val != null && val < rg.pasa_0_30_min) {
        warnings.push({
          code: 'TIPOLOGIA_PASA_030',
          message: `[${tipNombre}] El contenido pasante del tamiz 0,30 mm (${val.toFixed(1)}%) puede ser insuficiente. Se recomienda un mínimo de ${rg.pasa_0_30_min}%.`,
        });
      }
    }
    // Check TMN
    if (rg.tmn_max != null && tmn != null && tmn > rg.tmn_max) {
      warnings.push({
        code: 'TIPOLOGIA_TMN_MAX',
        message: `[${tipNombre}] El TMN de ${tmn} mm puede ser excesivo. Se recomienda un máximo de ${rg.tmn_max} mm.`,
      });
    }
    if (rg.tmn_min != null && tmn != null && tmn < rg.tmn_min) {
      warnings.push({
        code: 'TIPOLOGIA_TMN_MIN',
        message: `[${tipNombre}] El TMN de ${tmn} mm es bajo. Se recomienda un mínimo de ${rg.tmn_min} mm.`,
      });
    }
    // Check MF
    if (rg.mf_max != null && moduloFinura != null && moduloFinura > rg.mf_max) {
      warnings.push({
        code: 'TIPOLOGIA_MF_MAX',
        message: `[${tipNombre}] El módulo de finura (${moduloFinura.toFixed(2)}) es alto. Se recomienda un máximo de ${rg.mf_max}.`,
      });
    }
    if (rg.mf_min != null && moduloFinura != null && moduloFinura < rg.mf_min) {
      warnings.push({
        code: 'TIPOLOGIA_MF_MIN',
        message: `[${tipNombre}] El módulo de finura (${moduloFinura.toFixed(2)}) es bajo. Se recomienda un mínimo de ${rg.mf_min}.`,
      });
    }
    // Check relación finos (approximate from coarse/fine split)
    if (rg.relacion_finos_min != null || rg.relacion_finos_max != null) {
      // Estimate %finos as sum of aggregate weights where MF < 3.5 (arena)
      let pctFinos = 0;
      for (const ag of optimalAgregados) {
        const agPuntos = ag.puntos || [];
        const pasa475 = agPuntos.find(p => Math.abs(Number(p.aberturaMm) - 4.75) < 0.01);
        if (pasa475 && Number(pasa475.pasaPct) > 85) {
          pctFinos += ag.porcentaje;
        }
      }
      if (rg.relacion_finos_min != null && pctFinos < rg.relacion_finos_min) {
        warnings.push({
          code: 'TIPOLOGIA_FINOS_MIN',
          message: `[${tipNombre}] La proporción de finos (${pctFinos.toFixed(0)}%) es baja. Se recomienda un mínimo de ${rg.relacion_finos_min}%.`,
        });
      }
      if (rg.relacion_finos_max != null && pctFinos > rg.relacion_finos_max) {
        warnings.push({
          code: 'TIPOLOGIA_FINOS_MAX',
          message: `[${tipNombre}] La proporción de finos (${pctFinos.toFixed(0)}%) es alta. Se recomienda un máximo de ${rg.relacion_finos_max}%.`,
        });
      }
    }
  }

  // Build traceability
  const trazabilidad = buildTrazabilidad(
    optimalAgregados, grid, { curvaMix, tmn, moduloFinura },
    evaluacionBanda, evaluacionTeorica, optimizacionObj
  );

  return {
    tipoMezcla,
    plantaId,
    objetivoModo: objetivoModo || (curvaObjBanda ? 'BANDA' : 'CURVA'),
    prioridad1: prioridad1 || null,
    prioridad2: prioridad2 || null,
    tipologia: tipologiaConfig ? {
      codigo: tipologiaConfig.codigo,
      nombre: tipologiaConfig.nombre,
      curvaFamilia: tipologiaConfig.curvaFamilia,
      curvaExponente: Number(tipologiaConfig.curvaExponente),
      restriccionesGranulometricas: tipologiaConfig.restriccionesGranulometricas || {},
    } : undefined,
    agregados: optimalAgregados.map(a => ({
      id: a.id,
      porcentaje: a.porcentaje,
      fuente: a.fuente,
    })),
    curvaMix,
    tmn,
    moduloFinura,
    evaluacion,
    evaluacionBanda,
    evaluacionTeorica,
    optimizacion: optimizacionObj,
    resumen,
    trazabilidad,
    warnings: warnings.length > 0 ? warnings : undefined,
    errores: errores.length > 0 ? errores : undefined,
  };
}

/* ════════════════════════════════════════════════════════
   Helper: Build P matrix with monotonicity extrapolation
   ════════════════════════════════════════════════════════ */

function buildPMatrix(M, N, matrices) {
  const P = [];
  for (let i = 0; i < M; i++) {
    const row = [];
    for (let j = 0; j < N; j++) {
      let val = matrices[j][i].pasaPct;
      if (val === null) {
        let fromSmaller = null;
        for (let k = i - 1; k >= 0; k--) {
          if (matrices[j][k].pasaPct !== null) { fromSmaller = matrices[j][k].pasaPct; break; }
        }
        let fromLarger = null;
        for (let k = i + 1; k < M; k++) {
          if (matrices[j][k].pasaPct !== null) { fromLarger = matrices[j][k].pasaPct; break; }
        }
        if (fromSmaller !== null && fromLarger !== null) {
          val = round2((fromSmaller + fromLarger) / 2);
        } else if (fromSmaller !== null) {
          val = Math.min(100, fromSmaller);
        } else if (fromLarger !== null) {
          val = Math.max(0, fromLarger);
        } else {
          val = 0;
        }
      }
      row.push(val);
    }
    P.push(row);
  }
  return P;
}

/* ════════════════════════════════════════════════════════
   Helper: Build target values on grid
   ════════════════════════════════════════════════════════ */

function buildTargetsOnGrid(grid, targetPuntos, isBand) {
  return grid.map(ab => {
    for (const tp of targetPuntos) {
      if (aberturaMatch(ab, Number(tp.aberturaMm))) {
        if (isBand) {
          const limInf = tp.limInfPct ?? 0;
          const limSup = tp.limSupPct ?? 100;
          return { ab, limInf, limSup, mid: (limInf + limSup) / 2, isBand: true };
        }
        const target = tp.pasaPct ?? tp.targetPct ?? tp.limSupPct ?? null;
        return { ab, target, isBand: false };
      }
    }
    return null;
  }).filter(Boolean);
}

/**
 * Interpolate pre-computed theoretical curve points onto the optimisation grid.
 * Uses: exact match → equivalent sieve → log-linear interpolation → saturation deduction.
 * Each returned target gets a method tag and a log-spacing weight.
 *
 * @param {number[]} grid  sorted sieve aberturas
 * @param {Array<{aberturaMm,pasaPct}>} precomputed  sorted asc
 * @returns {Array<{ab, target, isBand:false, weight:number, metodo:string}>}
 */
function _interpolatePrecomputedOnGrid(grid, precomputed) {
  const targets = [];
  for (let i = 0; i < grid.length; i++) {
    const ab = grid[i];
    let val = null;
    let metodo = null;

    // a) exact match
    const exact = precomputed.find(p => Math.abs(p.aberturaMm - ab) < 0.01);
    if (exact) { val = exact.pasaPct; metodo = 'REAL'; }

    // b) equivalent sieve
    if (val === null) {
      const equiv = EQUIV_MAP.get(ab);
      if (equiv != null) {
        const ep = precomputed.find(p => Math.abs(p.aberturaMm - equiv) < 0.01);
        if (ep) { val = ep.pasaPct; metodo = 'EQUIV'; }
      }
    }

    // c) log-linear interpolation
    if (val === null) {
      const interp = interpolarLogLineal(
        [...precomputed].sort((a, b) => b.aberturaMm - a.aberturaMm), // desc for interpolator
        ab,
      );
      if (interp !== null) { val = round2(interp); metodo = 'INTERPOLADO'; }
    }

    // d) saturation deduction
    if (val === null) {
      const sat = deducirPorSaturacion(
        [...precomputed].sort((a, b) => b.aberturaMm - a.aberturaMm),
        ab,
      );
      if (sat) { val = sat.pasaPct; metodo = 'DEDUCIDO'; }
    }

    if (val === null) continue;

    // log-spacing weight
    let weight = 1;
    if (grid.length > 1) {
      const logAb = Math.log10(Math.max(ab, 0.001));
      let logSpan = 0;
      if (i > 0) logSpan += logAb - Math.log10(Math.max(grid[i - 1], 0.001));
      if (i < grid.length - 1) logSpan += Math.log10(Math.max(grid[i + 1], 0.001)) - logAb;
      if (i === 0 || i === grid.length - 1) logSpan *= 2;
      weight = Math.max(0.1, logSpan);
    }

    targets.push({ ab, target: val, isBand: false, weight, metodo });
  }
  // Normalize weights
  if (targets.length > 0) {
    const wSum = targets.reduce((s, t) => s + t.weight, 0);
    const scale = targets.length / wSum;
    for (const t of targets) t.weight = t.weight * scale;
  }
  return targets;
}

/**
 * Build theoretical curve targets directly on the optimization grid
 * by evaluating the formula at each grid sieve aperture.
 * This avoids mismatch when pre-computed series uses different sieves.
 *
 * @param {number[]} grid — unified sieve grid (ascending)
 * @param {object} curvaObj — theoretical curve object with parametros, tmnMm, etc.
 * @returns {Array<{ab, target, isBand: false, weight: number, metodo: string}>}
 */
function buildTheoreticalTargetsOnGrid(grid, curvaObj) {
  const raw = curvaObj.parametros || {};
  const params = normalizeFormulaParams(raw);
  const formulaKey = params.formulaKey || params.formula;
  const fn = resolveFormula(formulaKey);

  if (!fn) {
    // Fallback: interpolate pre-computed points onto the grid
    const precomputed = (curvaObj.puntosCalculados || generarPuntosTeorica(curvaObj))
      .filter(p => !p.isNA && p.pasaPct != null)
      .map(p => ({ aberturaMm: Number(p.aberturaMm), pasaPct: Number(p.pasaPct ?? p.targetPct ?? p.limSupPct) }))
      .sort((a, b) => a.aberturaMm - b.aberturaMm);
    if (!precomputed.length) return [];
    return _interpolatePrecomputedOnGrid(grid, precomputed);
  }

  const cutoffMm = params.D || params.dmax || curvaObj.tmnMm || null;

  const targets = [];
  for (let i = 0; i < grid.length; i++) {
    const ab = grid[i];
    // Skip sieves beyond the cutoff (Dmax)
    if (cutoffMm != null && ab > cutoffMm * 1.01) continue;

    let val = fn(ab, params);
    val = Math.max(0, Math.min(100, val));
    val = Math.round(val * 100) / 100;

    let weight = 1;
    if (grid.length > 1) {
      const logAb = Math.log10(Math.max(ab, 0.001));
      let logSpan = 0;
      if (i > 0) logSpan += logAb - Math.log10(Math.max(grid[i - 1], 0.001));
      if (i < grid.length - 1) logSpan += Math.log10(Math.max(grid[i + 1], 0.001)) - logAb;
      if (i === 0 || i === grid.length - 1) logSpan *= 2;
      weight = Math.max(0.1, logSpan);
    }

    targets.push({ ab, target: val, isBand: false, weight, metodo: 'FORMULA' });
  }

  if (targets.length > 0) {
    const wSum = targets.reduce((s, t) => s + t.weight, 0);
    const scale = targets.length / wSum;
    for (const t of targets) t.weight = t.weight * scale;
  }

  return targets;
}

/**
 * Build the comparable sieve set between the P matrix and theoretical targets.
 * A sieve is "comparable" when BOTH:
 *  - the P matrix has data from at least one aggregate (always true after buildPMatrix)
 *  - the theoretical targets contain a non-null value
 *
 * @param {number[]} grid
 * @param {number[][]} P — P[sieve][aggregate]
 * @param {number} N — number of aggregates
 * @param {Array} teoricaTargetsOnGrid
 * @returns {Array<{ab, target, metodo, pasaMix}>}
 */
function buildComparableSieveSet(grid, P, N, teoricaTargetsOnGrid) {
  return teoricaTargetsOnGrid.filter(t => {
    if (t.target === null || t.target === undefined) return false;
    const sieveIdx = grid.findIndex(ab => Math.abs(ab - t.ab) < 0.01);
    if (sieveIdx < 0) return false;
    for (let j = 0; j < N; j++) {
      if (P[sieveIdx][j] !== null && P[sieveIdx][j] !== undefined) return true;
    }
    return false;
  });
}

/* ════════════════════════════════════════════════════════
   Combined LP Solver: hierarchical 2-objective optimization
   ════════════════════════════════════════════════════════ */

/**
 * Solve combined band+theoretical optimization with priority hierarchy.
 *
 * prioridad1 = 'BANDA':
 *   Phase 1: find all weight combos that are feasible in band (or minimize violation)
 *   Phase 2: among feasible combos, minimize MAE against theoretical curve
 *
 * prioridad1 = 'CURVA':
 *   Phase 1: find weights that minimize MAE against theoretical curve
 *   Phase 2: among solutions within tolerance of best MAE, maximize band compliance
 */
function solveCombinedLP(N, bandTargets, teoricaTargets, P, grid, constraints, agregados, prioridad1) {
  const fixed = constraints?.fixed || {};
  const minBounds = constraints?.min || {};
  const maxBounds = constraints?.max || {};

  const freeIndices = [];
  const fixedWeights = new Array(N).fill(null);
  let fixedSum = 0;

  agregados.forEach((a, j) => {
    const idStr = String(a.id);
    if (fixed[idStr] !== undefined) {
      fixedWeights[j] = Number(fixed[idStr]) / 100;
      fixedSum += fixedWeights[j];
    } else {
      freeIndices.push(j);
    }
  });

  const remainingWeight = Math.max(0, 1 - fixedSum);
  const freeN = freeIndices.length;

  function buildWeights(freeWeights) {
    const weights = [...fixedWeights];
    freeIndices.forEach((j, fi) => { weights[j] = freeWeights[fi]; });
    return weights;
  }

  function evalBand(freeWeights) {
    return computeBandMetrics(buildWeights(freeWeights), bandTargets, P, grid);
  }

  function evalTeorica(freeWeights) {
    return computeWeightedTheoreticalCost(buildWeights(freeWeights), teoricaTargets, P, grid);
  }

  if (freeN === 0) {
    const weights = fixedWeights.map(w => w || 0);
    const bandM = bandTargets.length > 0 ? computeBandMetrics(weights, bandTargets, P, grid) : { feasible: true, minMargin: 0 };
    const mae = teoricaTargets.length > 0 ? computeWeightedTheoreticalCost(weights, teoricaTargets, P, grid) : 0;
    return {
      weights,
      metodo: 'combined_fixed',
      exitosa: bandM.feasible,
      metrica: round2(mae),
      mensaje: 'Todos los pesos fijados',
      feasible: bandM.feasible,
    };
  }

  const step1 = freeN <= 3 ? 0.05 : 0.1;

  if (prioridad1 === 'BANDA') {
    // ── BANDA first: find feasible solutions, then minimize MAE ──
    let feasibleCandidates = [];
    let bestInfeasibleWeights = null;
    let bestInfeasibleViolation = Infinity;

    iterateWeightCombinations(freeN, remainingWeight, step1, minBounds, maxBounds, freeIndices, agregados, (fw) => {
      const bm = evalBand(fw);
      if (bm.feasible) {
        const mae = evalTeorica(fw);
        feasibleCandidates.push({ fw: [...fw], mae, minMargin: bm.minMargin });
      } else {
        if (bm.totalViolation < bestInfeasibleViolation) {
          bestInfeasibleViolation = bm.totalViolation;
          bestInfeasibleWeights = [...fw];
        }
      }
    });

    // Phase 2 fine-step if no feasible found
    if (feasibleCandidates.length === 0) {
      const fineStep = freeN <= 4 ? 0.01 : 0.02;
      iterateWeightCombinations(freeN, remainingWeight, fineStep, minBounds, maxBounds, freeIndices, agregados, (fw) => {
        const bm = evalBand(fw);
        if (bm.feasible) {
          const mae = evalTeorica(fw);
          feasibleCandidates.push({ fw: [...fw], mae, minMargin: bm.minMargin });
        } else if (bm.totalViolation < bestInfeasibleViolation) {
          bestInfeasibleViolation = bm.totalViolation;
          bestInfeasibleWeights = [...fw];
        }
      });
    }

    if (feasibleCandidates.length > 0) {
      // Among feasible: sort by MAE, then refine around best
      feasibleCandidates.sort((a, b) => a.mae - b.mae);
      let bestFw = feasibleCandidates[0].fw;
      let bestMae = feasibleCandidates[0].mae;

      if (freeN <= 4) {
        const step2 = 0.01;
        const range = Math.max(step1, 0.02);
        refineAroundBest(bestFw, freeN, remainingWeight, step2, range, minBounds, maxBounds, freeIndices, agregados, (fw) => {
          const bm = evalBand(fw);
          if (bm.feasible) {
            const mae = evalTeorica(fw);
            if (mae < bestMae) {
              bestMae = mae;
              bestFw = [...fw];
            }
          }
        });
      }

      const weights = buildWeights(bestFw);
      normalizeWeights(weights, N);
      const bandaFirstMetrics = computeTheoreticalMetrics(weights, teoricaTargets, P, grid);
      const bandaFirstMae = bandaFirstMetrics.mae || 0;
      return {
        weights,
        metodo: 'combined_banda_first',
        exitosa: true,
        metrica: round2(bandaFirstMae),
        mensaje: `Dentro de banda, MAE teórica: ${round2(bandaFirstMae)}%`,
        feasible: true,
      };
    }

    // No feasible — minimize band violation
    if (!bestInfeasibleWeights) {
      bestInfeasibleWeights = new Array(freeN).fill(remainingWeight / freeN);
    }
    const weights = buildWeights(bestInfeasibleWeights);
    normalizeWeights(weights, N);
    return {
      weights,
      metodo: 'combined_banda_first',
      exitosa: false,
      metrica: round2(bestInfeasibleViolation),
      mensaje: `No existe solución factible en banda. Desvío total: ${round2(bestInfeasibleViolation)}%`,
      feasible: false,
    };

  } else {
    // ── CURVA first: minimize MAE, then maximize band compliance ──
    let bestMae = Infinity;
    let bestFw = null;
    const candidates = [];

    iterateWeightCombinations(freeN, remainingWeight, step1, minBounds, maxBounds, freeIndices, agregados, (fw) => {
      const mae = evalTeorica(fw);
      if (mae < bestMae) {
        bestMae = mae;
        bestFw = [...fw];
      }
      candidates.push({ fw: [...fw], mae });
    });

    // Refine around best MAE
    if (bestFw && freeN <= 4) {
      refineAroundBest(bestFw, freeN, remainingWeight, 0.01, Math.max(step1, 0.02), minBounds, maxBounds, freeIndices, agregados, (fw) => {
        const mae = evalTeorica(fw);
        if (mae < bestMae) {
          bestMae = mae;
          bestFw = [...fw];
        }
        candidates.push({ fw: [...fw], mae });
      });
    }

    // Phase 2: among solutions within 20% of best MAE, pick the one with best band compliance
    const maeTolerance = bestMae * 0.2 + 1; // 20% relative + 1% absolute tolerance
    const goodCandidates = candidates.filter(c => c.mae <= bestMae + maeTolerance);

    let bestCombined = bestFw;
    let bestCombinedScore = Infinity; // lower = better (band violation + scaled MAE)

    for (const c of goodCandidates) {
      const bm = evalBand(c.fw);
      // Score: band violation * 100 + MAE (prioritize band compliance among good-MAE solutions)
      const score = (bm.feasible ? 0 : bm.totalViolation * 100) + c.mae;
      if (score < bestCombinedScore) {
        bestCombinedScore = score;
        bestCombined = c.fw;
      }
    }

    if (!bestCombined) {
      bestCombined = new Array(freeN).fill(remainingWeight / freeN);
    }

    const weights = buildWeights(bestCombined);
    normalizeWeights(weights, N);
    const finalBand = computeBandMetrics(weights, bandTargets, P, grid);
    const nSieves = Math.max(teoricaTargets.length, 1);
    const finalMetrics = computeTheoreticalMetrics(weights, teoricaTargets, P, grid);
    const finalMae = finalMetrics.mae || 0;

    return {
      weights,
      metodo: 'combined_curva_first',
      exitosa: true,
      metrica: round2(finalMae),
      mensaje: finalBand.feasible
        ? `MAE teórica: ${round2(finalMae)}%, dentro de banda`
        : `MAE teórica: ${round2(finalMae)}%, fuera de banda (desvío: ${round2(finalBand.totalViolation)}%)`,
      feasible: finalBand.feasible,
    };
  }
}

/** Normalize weights to ensure sum = 1. */
function normalizeWeights(weights, N) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (Math.abs(total - 1) > 0.001) {
    const scale = 1 / total;
    for (let j = 0; j < N; j++) weights[j] = round2(weights[j] * scale);
  }
}

/* ════════════════════════════════════════════════════════
   Theoretical Curve LP Solver — Weighted MAE minimization
   with logarithmic sieve spacing weights.
   ════════════════════════════════════════════════════════ */

/**
 * Solves the aggregate mix optimization for theoretical curve fitting.
 * Uses grid search + refinement with weighted absolute error cost function.
 *
 * The cost function minimizes: sum_i (w_i * |Pmix_i - Ptarget_i|)
 * where w_i are log-spacing weights per sieve.
 *
 * @param {number} N number of aggregates
 * @param {Array} targets targets with {ab, target, weight?}
 * @param {Array<Array>} P pasaPct matrix [sieve][aggregate]
 * @param {number[]} grid sieve aberturas
 * @param {object} constraints optional constraints
 * @param {Array} agregados aggregate info
 * @returns {{ weights, metodo, exitosa, metrica, mensaje, mae, rmse, maxDesvio, comparableSievesCount }}
 */
function solveTheoreticalLP(N, targets, P, grid, constraints, agregados) {
  const fixed = constraints?.fixed || {};
  const minBounds = constraints?.min || {};
  const maxBounds = constraints?.max || {};

  // Filter to only targets with valid data
  const validTargets = targets.filter(t => t.target !== null && t.target !== undefined);

  if (validTargets.length < MIN_COMPARABLE_SIEVES) {
    // Should not reach here (validated upstream), but safety net
    const equalW = new Array(N).fill(round2(1 / N));
    return {
      weights: equalW,
      metodo: 'lp_theoretical_fit',
      exitosa: false,
      metrica: null,
      mensaje: `Tamices comparables insuficientes (${validTargets.length})`,
      feasible: false,
      mae: null,
      rmse: null,
      maxDesvio: null,
      comparableSievesCount: validTargets.length,
    };
  }

  // Determine free vs fixed variables
  const freeIndices = [];
  const fixedWeights = new Array(N).fill(null);
  let fixedSum = 0;

  agregados.forEach((a, j) => {
    const idStr = String(a.id);
    if (fixed[idStr] !== undefined) {
      fixedWeights[j] = Number(fixed[idStr]) / 100;
      fixedSum += fixedWeights[j];
    } else {
      freeIndices.push(j);
    }
  });

  const remainingWeight = Math.max(0, 1 - fixedSum);
  const freeN = freeIndices.length;

  function buildWeights(freeWeights) {
    const weights = [...fixedWeights];
    freeIndices.forEach((j, fi) => { weights[j] = freeWeights[fi]; });
    return weights;
  }

  // Weighted MAE cost function
  function evalCost(freeWeights) {
    const weights = buildWeights(freeWeights);
    return computeWeightedTheoreticalCost(weights, validTargets, P, grid);
  }

  if (freeN === 0) {
    const weights = fixedWeights.map(w => w || 0);
    const metrics = computeTheoreticalMetrics(weights, validTargets, P, grid);
    return {
      weights,
      metodo: 'lp_theoretical_fit',
      exitosa: true,
      metrica: round2(metrics.mae),
      mensaje: `MAE: ${round2(metrics.mae)}% (pesos fijados)`,
      feasible: true,
      ...metrics,
    };
  }

  const step1 = freeN <= 3 ? 0.05 : 0.1;

  let bestFreeWeights = null;
  let bestCost = Infinity;

  // Phase 1: Coarse grid search
  iterateWeightCombinations(freeN, remainingWeight, step1, minBounds, maxBounds, freeIndices, agregados, (fw) => {
    const cost = evalCost(fw);
    if (cost < bestCost) {
      bestCost = cost;
      bestFreeWeights = [...fw];
    }
  });

  // Phase 2: Fine refinement around best
  if (bestFreeWeights && freeN <= 5) {
    const step2 = freeN <= 3 ? 0.01 : 0.02;
    const range = Math.max(step1, 0.03);
    refineAroundBest(bestFreeWeights, freeN, remainingWeight, step2, range, minBounds, maxBounds, freeIndices, agregados, (fw) => {
      const cost = evalCost(fw);
      if (cost < bestCost) {
        bestCost = cost;
        bestFreeWeights = [...fw];
      }
    });
  }

  // Phase 3: Extra-fine refinement for small N (very precise optimization)
  if (bestFreeWeights && freeN <= 3) {
    const step3 = 0.005;
    const range3 = 0.015;
    refineAroundBest(bestFreeWeights, freeN, remainingWeight, step3, range3, minBounds, maxBounds, freeIndices, agregados, (fw) => {
      const cost = evalCost(fw);
      if (cost < bestCost) {
        bestCost = cost;
        bestFreeWeights = [...fw];
      }
    });
  }

  if (!bestFreeWeights) {
    bestFreeWeights = new Array(freeN).fill(remainingWeight / freeN);
  }

  const weights = [...fixedWeights];
  freeIndices.forEach((j, fi) => { weights[j] = round2(bestFreeWeights[fi]); });
  normalizeWeights(weights, N);

  // Compute final metrics
  const metrics = computeTheoreticalMetrics(weights, validTargets, P, grid);

  return {
    weights,
    metodo: 'lp_theoretical_fit',
    exitosa: true,
    metrica: round2(metrics.mae),
    mensaje: `MAE: ${round2(metrics.mae)}%, RMSE: ${round2(metrics.rmse)}%, Max desvío: ${round2(metrics.maxDesvio)}%`,
    feasible: true,
    ...metrics,
  };
}

/**
 * Compute weighted cost for theoretical curve optimization.
 * Uses the log-spacing weights from buildTheoreticalTargetsOnGrid.
 */
function computeWeightedTheoreticalCost(weights, targets, P, grid) {
  let cost = 0;
  for (const t of targets) {
    if (t.target === null || t.target === undefined) continue;
    const sieveIdx = grid.findIndex(ab => Math.abs(ab - t.ab) < 0.01);
    if (sieveIdx < 0) continue;

    let mixPasa = 0;
    for (let j = 0; j < weights.length; j++) {
      mixPasa += (weights[j] || 0) * (P[sieveIdx]?.[j] || 0);
    }

    const w = t.weight || 1;
    cost += w * Math.abs(mixPasa - t.target);
  }
  return cost;
}

/**
 * Compute final MAE, RMSE, maxDesvio for a theoretical curve solution.
 */
function computeTheoreticalMetrics(weights, targets, P, grid) {
  let sumAbsErr = 0;
  let sumSqErr = 0;
  let maxDesvio = 0;
  let count = 0;
  const curvaMix = [];

  for (const t of targets) {
    if (t.target === null || t.target === undefined) continue;
    const sieveIdx = grid.findIndex(ab => Math.abs(ab - t.ab) < 0.01);
    if (sieveIdx < 0) continue;

    let mixPasa = 0;
    for (let j = 0; j < weights.length; j++) {
      mixPasa += (weights[j] || 0) * (P[sieveIdx]?.[j] || 0);
    }

    const err = Math.abs(mixPasa - t.target);
    sumAbsErr += err;
    sumSqErr += err * err;
    if (err > maxDesvio) maxDesvio = err;
    count++;
    curvaMix.push({ ab: t.ab, mixPasa: round2(mixPasa), target: t.target });
  }

  const mae = count > 0 ? round2(sumAbsErr / count) : null;
  const rmse = count > 0 ? round2(Math.sqrt(sumSqErr / count)) : null;

  return {
    mae,
    rmse,
    maxDesvio: round2(maxDesvio),
    comparableSievesCount: count,
  };
}

/* ════════════════════════════════════════════════════════
   LP Solver (Pure JS — Simplex-free, iterative grid search
   + refinement for small N)
   ════════════════════════════════════════════════════════ */

/**
 * Solves the aggregate mix optimization problem.
 *
 * For small N (2–6 aggregates), uses a grid search + Nelder-Mead-like
 * refinement. This avoids external LP dependencies while being fast
 * enough for the problem size.
 *
 * @param {number} N number of aggregates
 * @param {Array} targets target values per sieve
 * @param {Array<Array>} P pasaPct matrix [sieve][aggregate]
 * @param {number[]} grid sieve aberturas
 * @param {boolean} isBand whether objective is a band
 * @param {object} constraints optional constraints
 * @param {Array} agregados aggregate info
 * @returns {{ weights, metodo, exitosa, metrica, mensaje }}
 */
function solveMixLP(N, targets, P, grid, isBand, constraints, agregados) {
  const fixed = constraints?.fixed || {};
  const minBounds = constraints?.min || {};
  const maxBounds = constraints?.max || {};

  // Determine free vs fixed variables
  const freeIndices = [];
  const fixedWeights = new Array(N).fill(null);
  let fixedSum = 0;

  agregados.forEach((a, j) => {
    const idStr = String(a.id);
    if (fixed[idStr] !== undefined) {
      fixedWeights[j] = Number(fixed[idStr]) / 100;
      fixedSum += fixedWeights[j];
    } else {
      freeIndices.push(j);
    }
  });

  const remainingWeight = Math.max(0, 1 - fixedSum);
  const freeN = freeIndices.length;

  if (freeN === 0) {
    // All fixed — just evaluate
    const weights = fixedWeights.map(w => w || 0);
    const cost = computeCost(weights, targets, P, grid, isBand);
    return { weights, metodo: 'fixed', exitosa: true, metrica: round2(cost), mensaje: 'Todos los pesos fijados' };
  }

  // Helper: build full weight array from free weights
  function buildWeights(freeWeights) {
    const weights = [...fixedWeights];
    freeIndices.forEach((j, fi) => { weights[j] = freeWeights[fi]; });
    return weights;
  }

  // Objective functions
  function evalWeights(freeWeights) {
    return computeCost(buildWeights(freeWeights), targets, P, grid, isBand);
  }
  function evalBandFeasible(freeWeights) {
    return computeBandFeasibleCost(buildWeights(freeWeights), targets, P, grid);
  }
  function evalBandInfeasible(freeWeights) {
    return computeBandInfeasibleCost(buildWeights(freeWeights), targets, P, grid);
  }

  const step1 = freeN <= 3 ? 0.05 : 0.1;

  let bestFreeWeights = null;
  let bestCost = Infinity;
  let feasibleFound = false;

  if (isBand) {
    /* ═══════ BAND MODE: 2-Phase solver ═══════ */

    // Phase 1: Coarse search — check feasibility with feasible cost function
    let bestFeasibleWeights = null;
    let bestFeasibleCost = Infinity;
    let bestInfeasibleWeights = null;
    let bestInfeasibleCost = Infinity;

    iterateWeightCombinations(freeN, remainingWeight, step1, minBounds, maxBounds, freeIndices, agregados, (fw) => {
      const fcost = evalBandFeasible(fw);
      if (fcost < bestFeasibleCost) {
        bestFeasibleCost = fcost;
        bestFeasibleWeights = [...fw];
      }
      if (fcost === Infinity) {
        // Not feasible — track best infeasible
        const icost = evalBandInfeasible(fw);
        if (icost < bestInfeasibleCost) {
          bestInfeasibleCost = icost;
          bestInfeasibleWeights = [...fw];
        }
      }
    });

    feasibleFound = bestFeasibleWeights !== null && bestFeasibleCost !== Infinity;

    // Phase 2: If coarse grid found no feasible, do a full fine-step search
    //          to guarantee finding feasible solutions when they exist.
    if (!feasibleFound) {
      const fineStep = freeN <= 4 ? 0.01 : 0.02;
      iterateWeightCombinations(freeN, remainingWeight, fineStep, minBounds, maxBounds, freeIndices, agregados, (fw) => {
        const fcost = evalBandFeasible(fw);
        if (fcost < bestFeasibleCost) {
          bestFeasibleCost = fcost;
          bestFeasibleWeights = [...fw];
        }
        if (fcost === Infinity) {
          const icost = evalBandInfeasible(fw);
          if (icost < bestInfeasibleCost) {
            bestInfeasibleCost = icost;
            bestInfeasibleWeights = [...fw];
          }
        }
      });
      feasibleFound = bestFeasibleWeights !== null && bestFeasibleCost !== Infinity;
    }

    if (feasibleFound) {
      // Phase 3a: Refine around best feasible — maximize min margin
      bestFreeWeights = bestFeasibleWeights;
      bestCost = bestFeasibleCost;

      if (freeN <= 4) {
        const step2 = 0.01;
        const range = Math.max(step1, 0.02);
        refineAroundBest(bestFreeWeights, freeN, remainingWeight, step2, range, minBounds, maxBounds, freeIndices, agregados, (fw) => {
          const cost = evalBandFeasible(fw);
          if (cost < bestCost) {
            bestCost = cost;
            bestFreeWeights = [...fw];
          }
        });
      }
    } else {
      // Phase 3b: No feasible solution — minimize violations
      bestFreeWeights = bestInfeasibleWeights;
      bestCost = bestInfeasibleCost;

      if (bestFreeWeights && freeN <= 4) {
        const step2 = 0.01;
        const range = Math.max(step1, 0.05);
        refineAroundBest(bestFreeWeights, freeN, remainingWeight, step2, range, minBounds, maxBounds, freeIndices, agregados, (fw) => {
          const cost = evalBandInfeasible(fw);
          if (cost < bestCost) {
            bestCost = cost;
            bestFreeWeights = [...fw];
          }
        });
      }
    }
  } else {
    /* ═══════ THEORETICAL CURVE MODE: unchanged ═══════ */

    // Phase 1: Coarse grid
    iterateWeightCombinations(freeN, remainingWeight, step1, minBounds, maxBounds, freeIndices, agregados, (fw) => {
      const cost = evalWeights(fw);
      if (cost < bestCost) {
        bestCost = cost;
        bestFreeWeights = [...fw];
      }
    });

    // Phase 2: Refine around best
    if (bestFreeWeights && freeN <= 4) {
      const step2 = 0.01;
      const range = step1;
      refineAroundBest(bestFreeWeights, freeN, remainingWeight, step2, range, minBounds, maxBounds, freeIndices, agregados, (fw) => {
        const cost = evalWeights(fw);
        if (cost < bestCost) {
          bestCost = cost;
          bestFreeWeights = [...fw];
        }
      });
    }
  }

  if (!bestFreeWeights) {
    // Fallback: equal distribution
    bestFreeWeights = new Array(freeN).fill(remainingWeight / freeN);
    bestCost = evalWeights(bestFreeWeights);
  }

  const weights = [...fixedWeights];
  freeIndices.forEach((j, fi) => { weights[j] = round2(bestFreeWeights[fi]); });

  // Normalize to ensure sum = 1
  const total = weights.reduce((s, w) => s + w, 0);
  if (Math.abs(total - 1) > 0.001) {
    const scale = 1 / total;
    for (let j = 0; j < N; j++) weights[j] = round2(weights[j] * scale);
  }

  // Compute final metrics for band results
  let mensaje, exitosa;
  if (isBand) {
    const finalMetrics = computeBandMetrics(weights, targets, P, grid);
    if (finalMetrics.feasible) {
      exitosa = true;
      mensaje = `Mezcla dentro de banda (margen mín: ${round2(finalMetrics.minMargin)}%)`;
    } else {
      exitosa = false;
      mensaje = `No existe solución factible. Desvío total: ${round2(finalMetrics.totalViolation)}%`;
    }
  } else {
    const finalCost = computeCost(weights, targets, P, grid, false);
    exitosa = finalCost < 500;
    mensaje = `MAE: ${round2(finalCost / Math.max(targets.length, 1))}`;
  }

  return {
    weights,
    metodo: isBand ? (feasibleFound ? 'band_feasible' : 'band_min_violation') : 'grid_search',
    exitosa,
    metrica: round2(bestCost),
    mensaje,
    feasible: isBand ? feasibleFound : undefined,
  };
}

/**
 * Compute band metrics for a set of weights.
 * Returns { feasible, minMargin, totalViolation, mixValues }
 */
function computeBandMetrics(weights, targets, P, grid) {
  let feasible = true;
  let minMargin = Infinity;
  let totalViolation = 0;
  const mixValues = [];

  for (const t of targets) {
    if (!t.isBand) continue;
    const sieveIdx = grid.findIndex(ab => Math.abs(ab - t.ab) < 0.01);
    if (sieveIdx < 0) continue;

    let mixPasa = 0;
    for (let j = 0; j < weights.length; j++) {
      mixPasa += (weights[j] || 0) * (P[sieveIdx]?.[j] || 0);
    }

    const marginLow = mixPasa - t.limInf;
    const marginHigh = t.limSup - mixPasa;
    const margin = Math.min(marginLow, marginHigh);

    mixValues.push({ ab: t.ab, mixPasa, limInf: t.limInf, limSup: t.limSup, margin });

    if (margin < 0) {
      feasible = false;
      totalViolation += Math.abs(margin);
    }
    if (margin < minMargin) minMargin = margin;
  }

  return { feasible, minMargin, totalViolation, mixValues };
}

/**
 * Cost function for band optimization — Phase 2a (feasible).
 * Returns negative minMargin (we minimize cost, so more margin = lower cost).
 */
function computeBandFeasibleCost(weights, targets, P, grid) {
  const { feasible, minMargin } = computeBandMetrics(weights, targets, P, grid);
  if (!feasible) return Infinity; // reject infeasible solutions
  return -minMargin; // maximize min margin
}

/**
 * Cost function for band optimization — Phase 2b (infeasible).
 * Minimizes weighted sum of violations.
 */
function computeBandInfeasibleCost(weights, targets, P, grid) {
  const { totalViolation, minMargin } = computeBandMetrics(weights, targets, P, grid);
  // Primary: minimize total violation. Secondary: maximize min margin (less negative = better)
  return totalViolation * 1000 - minMargin;
}

/**
 * Cost function for optimization (backward compatible + theoretical curves).
 */
function computeCost(weights, targets, P, grid, isBand) {
  let cost = 0;
  for (const t of targets) {
    const sieveIdx = grid.findIndex(ab => Math.abs(ab - t.ab) < 0.01);
    if (sieveIdx < 0) continue;

    let mixPasa = 0;
    for (let j = 0; j < weights.length; j++) {
      mixPasa += (weights[j] || 0) * (P[sieveIdx]?.[j] || 0);
    }

    if (isBand) {
      if (mixPasa < t.limInf) {
        cost += Math.pow(t.limInf - mixPasa, 2) * 10;
      } else if (mixPasa > t.limSup) {
        cost += Math.pow(mixPasa - t.limSup, 2) * 10;
      } else {
        cost += Math.abs(mixPasa - t.mid) * 0.1;
      }
    } else {
      if (t.target !== null && t.target !== undefined) {
        cost += Math.abs(mixPasa - t.target);
      }
    }
  }
  return cost;
}

/**
 * Iterate over all weight combinations that sum to `totalWeight`
 * with given step size, respecting min/max bounds.
 */
function iterateWeightCombinations(n, totalWeight, step, minBounds, maxBounds, freeIndices, agregados, callback) {
  const weights = new Array(n).fill(0);

  function recurse(idx, remaining) {
    if (idx === n - 1) {
      // Last variable gets the remainder
      const idStr = String(agregados[freeIndices[idx]].id);
      const lo = (minBounds[idStr] ?? 0) / 100;
      const hi = (maxBounds[idStr] ?? 100) / 100;
      if (remaining >= lo - 0.001 && remaining <= hi + 0.001) {
        weights[idx] = Math.max(0, Math.min(remaining, hi));
        callback(weights);
      }
      return;
    }

    const idStr = String(agregados[freeIndices[idx]].id);
    const lo = (minBounds[idStr] ?? 0) / 100;
    const hi = Math.min((maxBounds[idStr] ?? 100) / 100, remaining);

    for (let w = lo; w <= hi + 0.001; w += step) {
      weights[idx] = Math.min(round2(w), remaining);
      recurse(idx + 1, round2(remaining - weights[idx]));
    }
  }

  recurse(0, totalWeight);
}

/**
 * Refine search around the current best solution.
 */
function refineAroundBest(best, n, totalWeight, step, range, minBounds, maxBounds, freeIndices, agregados, callback) {
  const weights = new Array(n).fill(0);

  function recurse(idx, remaining) {
    if (idx === n - 1) {
      const idStr = String(agregados[freeIndices[idx]].id);
      const lo = (minBounds[idStr] ?? 0) / 100;
      const hi = (maxBounds[idStr] ?? 100) / 100;
      if (remaining >= lo - 0.001 && remaining <= hi + 0.001) {
        weights[idx] = Math.max(0, Math.min(remaining, hi));
        callback(weights);
      }
      return;
    }

    const idStr = String(agregados[freeIndices[idx]].id);
    const lo = Math.max((minBounds[idStr] ?? 0) / 100, best[idx] - range);
    const hi = Math.min((maxBounds[idStr] ?? 100) / 100, best[idx] + range, remaining);

    for (let w = Math.max(0, lo); w <= hi + 0.001; w += step) {
      weights[idx] = Math.min(round2(w), remaining);
      recurse(idx + 1, round2(remaining - weights[idx]));
    }
  }

  recurse(0, totalWeight);
}

/* ════════════════════════════════════════════════════════
   Feasible Ranges Computation
   ════════════════════════════════════════════════════════ */

/**
 * For a given weight configuration where one aggregate is fixed,
 * check if a feasible (or good) solution exists for the remaining aggregates.
 *
 * @param {number} fixedIdx — index of the aggregate whose weight is fixed
 * @param {number} fixedW — weight (0–1) of the fixed aggregate
 * @param {number[]} otherFreeIndices — indices of other free aggregates
 * @param {number} N — total aggregates
 * @param {Array} targets — target spec
 * @param {Array<Array>} P — pasaPct matrix
 * @param {number[]} grid — sieve grid
 * @param {boolean} isBand
 * @param {object} minBounds, maxBounds — per-aggregate constraints
 * @param {Array} agregados
 * @param {number} remaining — weight to distribute among free aggregates
 * @param {object} fixedConstraints — original fixed constraints
 * @returns {{ feasible: boolean, cost: number }}
 */
function checkFeasibilityWithFixed(fixedIdx, fixedW, otherFreeIndices, N, targets, P, grid, isBand, minBounds, maxBounds, agregados, remaining, fixedConstraints) {
  const weights = new Array(N).fill(0);
  weights[fixedIdx] = fixedW;

  // Set externally-fixed constraints
  for (let k = 0; k < N; k++) {
    const kId = String(agregados[k].id);
    if (k !== fixedIdx && fixedConstraints[kId] !== undefined) {
      weights[k] = Number(fixedConstraints[kId]) / 100;
    }
  }

  if (otherFreeIndices.length === 0) {
    if (Math.abs(remaining) > 0.01) return { feasible: false, cost: Infinity };
    if (isBand) {
      const m = computeBandMetrics(weights, targets, P, grid);
      return { feasible: m.feasible, cost: m.totalViolation };
    }
    return { feasible: true, cost: computeCost(weights, targets, P, grid, false) };
  }

  if (otherFreeIndices.length === 1) {
    const k = otherFreeIndices[0];
    const kId = String(agregados[k].id);
    const kLo = (minBounds[kId] ?? 0) / 100;
    const kHi = (maxBounds[kId] ?? 100) / 100;
    if (remaining < kLo - 0.001 || remaining > kHi + 0.001) {
      return { feasible: false, cost: Infinity };
    }
    weights[k] = Math.max(0, Math.min(remaining, kHi));
    if (isBand) {
      const m = computeBandMetrics(weights, targets, P, grid);
      return { feasible: m.feasible, cost: m.totalViolation };
    }
    return { feasible: true, cost: computeCost(weights, targets, P, grid, false) };
  }

  // 2+ other free variables — mini grid search
  const miniStep = otherFreeIndices.length <= 2 ? 0.02 : 0.05;
  let bestFeasible = false;
  let bestCost = Infinity;

  function searchOthers(freeListIdx, rem) {
    if (freeListIdx === otherFreeIndices.length - 1) {
      const lastK = otherFreeIndices[freeListIdx];
      const lastId = String(agregados[lastK].id);
      const lastLo = (minBounds[lastId] ?? 0) / 100;
      const lastHi = (maxBounds[lastId] ?? 100) / 100;
      if (rem < lastLo - 0.001 || rem > lastHi + 0.001) return;
      weights[lastK] = Math.max(0, Math.min(rem, lastHi));

      if (isBand) {
        const m = computeBandMetrics(weights, targets, P, grid);
        if (m.feasible) bestFeasible = true;
        if (m.totalViolation < bestCost) bestCost = m.totalViolation;
      } else {
        const cost = computeCost(weights, targets, P, grid, false);
        if (cost < bestCost) bestCost = cost;
      }
      return;
    }

    const k = otherFreeIndices[freeListIdx];
    const kId = String(agregados[k].id);
    const kLo = (minBounds[kId] ?? 0) / 100;
    const kHi = Math.min((maxBounds[kId] ?? 100) / 100, rem);

    for (let v = kLo; v <= kHi + 0.001; v += miniStep) {
      weights[k] = Math.min(round2(v), rem);
      searchOthers(freeListIdx + 1, round2(rem - weights[k]));
      if (bestFeasible && isBand) return; // Early exit once feasibility confirmed
    }
  }

  searchOthers(0, remaining);
  return { feasible: bestFeasible, cost: bestCost };
}

/**
 * Compute the feasible percentage range for each aggregate.
 * For bands: the [min, max] weight where a compliant mix exists.
 * For theoretical: the [min, max] weight where cost is within tolerance of optimal.
 *
 * @param {number} N
 * @param {Array} targets
 * @param {Array<Array>} P
 * @param {number[]} grid
 * @param {boolean} isBand
 * @param {object} constraints
 * @param {Array} agregados
 * @returns {Array<{id, minPct, maxPct, feasible?, optimalPct?, bestMae?}>}
 */
function computeFeasibleRanges(N, targets, P, grid, isBand, constraints, agregados) {
  const fixed = constraints?.fixed || {};
  const minBounds = constraints?.min || {};
  const maxBounds = constraints?.max || {};

  const ranges = [];

  for (let targetIdx = 0; targetIdx < N; targetIdx++) {
    const idStr = String(agregados[targetIdx].id);

    // If constrained to a fixed value, range is just that value
    if (fixed[idStr] !== undefined) {
      const fixedPct = Number(fixed[idStr]);
      ranges.push({ id: agregados[targetIdx].id, minPct: fixedPct, maxPct: fixedPct, fixed: true });
      continue;
    }

    const lo = Math.max(0, (minBounds[idStr] ?? 0) / 100);
    const hi = Math.min(1, (maxBounds[idStr] ?? 100) / 100);

    // Compute fixed weights for other aggregates
    let otherFixedSum = 0;
    const otherFreeIndices = [];
    for (let k = 0; k < N; k++) {
      if (k === targetIdx) continue;
      const kId = String(agregados[k].id);
      if (fixed[kId] !== undefined) {
        otherFixedSum += Number(fixed[kId]) / 100;
      } else {
        otherFreeIndices.push(k);
      }
    }

    const sweepStep = 0.01;
    let minFeasible = null;
    let maxFeasible = null;
    const costByWeight = [];

    for (let w = lo; w <= hi + 0.0001; w = round2(w + sweepStep)) {
      const remaining = round2(1 - w - otherFixedSum);
      if (remaining < -0.01) continue;

      const result = checkFeasibilityWithFixed(
        targetIdx, w, otherFreeIndices, N, targets, P, grid, isBand,
        minBounds, maxBounds, agregados, remaining, fixed,
      );

      if (isBand && result.feasible) {
        if (minFeasible === null) minFeasible = round2(w * 100);
        maxFeasible = round2(w * 100);
      }

      costByWeight.push({ pct: round2(w * 100), cost: result.cost, feasible: result.feasible });
    }

    if (isBand) {
      if (minFeasible !== null) {
        ranges.push({
          id: agregados[targetIdx].id,
          minPct: minFeasible,
          maxPct: maxFeasible,
          feasible: true,
        });
      } else {
        // No feasible range — report closest-to-feasible range
        const sorted = [...costByWeight].sort((a, b) => a.cost - b.cost);
        const best = sorted[0];
        if (best) {
          const threshold = best.cost * 1.5 + 1;
          const within = costByWeight.filter(r => r.cost <= threshold);
          const pcts = within.map(r => r.pct);
          ranges.push({
            id: agregados[targetIdx].id,
            minPct: Math.min(...pcts),
            maxPct: Math.max(...pcts),
            feasible: false,
            bestViolation: round2(best.cost),
          });
        } else {
          ranges.push({
            id: agregados[targetIdx].id,
            minPct: round2(lo * 100),
            maxPct: round2(hi * 100),
            feasible: false,
          });
        }
      }
    } else {
      // Theoretical mode — find range where cost is close to optimal
      const sorted = [...costByWeight].sort((a, b) => a.cost - b.cost);
      const best = sorted[0];
      if (best) {
        const nSieves = targets.length || 1;
        const bestMae = best.cost / nSieves;
        // Range: cost within bestCost + 5% MAE tolerance per sieve
        const threshold = best.cost + 5 * nSieves;
        const within = costByWeight.filter(r => r.cost <= threshold);
        const pcts = within.map(r => r.pct);
        ranges.push({
          id: agregados[targetIdx].id,
          minPct: pcts.length > 0 ? Math.min(...pcts) : round2(lo * 100),
          maxPct: pcts.length > 0 ? Math.max(...pcts) : round2(hi * 100),
          optimalPct: best.pct,
          bestMae: round2(bestMae),
        });
      } else {
        ranges.push({
          id: agregados[targetIdx].id,
          minPct: round2(lo * 100),
          maxPct: round2(hi * 100),
        });
      }
    }
  }

  return ranges;
}

/* ════════════════════════════════════════════════════════
   CRUD: Saved Mixes (MezclaAgregados)
   ════════════════════════════════════════════════════════ */

/**
 * Save a mix to the catalog.
 */
async function guardarMezcla(db, body) {
  const {
    idMezcla: existingId,  // if provided, update existing mezcla
    nombre, descripcion, idPlanta, tipoMezcla,
    objetivoModo, idBanda, idCurvaTeorica, bandaCompuestaJson,
    prioridad1, prioridad2,
    tmnCalculadoMm, moduloFinura,
    curvaMezclaJson, metadataResultadoJson,
    items, // [{idAgregado, porcentajeFinal, orden}]
    // Post-optimization adjustment fields
    tipoOptimizacion, proporcionesOptimasJson, rangosFactiblesJson,
    metricasOptimoJson, metricasAdoptadoJson, calidadAjuste, motivoAjuste,
  } = body;

  if (!nombre) throw new Error('nombre es requerido');
  if (!idPlanta) throw new Error('idPlanta es requerido');
  if (!tipoMezcla) throw new Error('tipoMezcla es requerido');
  if (!Array.isArray(items) || items.length < 2) throw new Error('Se requieren al menos 2 items');

  let mezcla;
  if (existingId) {
    // Update existing mezcla (e.g., editing a duplicate)
    mezcla = await db.MezclaAgregados.findByPk(existingId);
    if (!mezcla) throw new Error(`Mezcla #${existingId} no encontrada`);

    // Enforce estado restrictions
    if (!isEditable(mezcla.estado)) {
      throw Object.assign(
        new Error(`No se puede editar una mezcla en estado ${mezcla.estado}`),
        { status: 422 }
      );
    }

    // In A_PRUEBA, check structural field restrictions
    if (mezcla.estado === 'A_PRUEBA') {
      const structuralChanges = [];
      if (tipoMezcla !== mezcla.tipoMezcla) structuralChanges.push('tipoMezcla');
      if (Number(idPlanta) !== Number(mezcla.idPlanta)) structuralChanges.push('idPlanta');
      if ((objetivoModo || null) !== (mezcla.objetivoModo || null)) structuralChanges.push('objetivoModo');
      if (Number(idBanda || 0) !== Number(mezcla.idBanda || 0)) structuralChanges.push('idBanda');
      if (Number(idCurvaTeorica || 0) !== Number(mezcla.idCurvaTeorica || 0)) structuralChanges.push('idCurvaTeorica');
      // Check if items are structurally different (different aggregates or count)
      const existingItems = await db.MezclaAgregadosItem.findAll({ where: { idMezcla: existingId }, order: [['orden', 'ASC']] });
      const existingIds = existingItems.map(i => i.idAgregado).sort((a, b) => a - b);
      const newIds = items.map(i => i.idAgregado).sort((a, b) => a - b);
      if (existingIds.length !== newIds.length || existingIds.some((id, idx) => id !== newIds[idx])) {
        structuralChanges.push('items (agregados)');
      }
      if (structuralChanges.length > 0) {
        throw Object.assign(
          new Error(`En estado A_PRUEBA no se pueden modificar campos estructurales: ${structuralChanges.join(', ')}`),
          { status: 422 }
        );
      }
    }

    await mezcla.update({
      nombre,
      descripcion: descripcion || null,
      idPlanta,
      tipoMezcla,
      objetivoModo: objetivoModo || null,
      idBanda: idBanda || null,
      idCurvaTeorica: idCurvaTeorica || null,
      bandaCompuestaJson: bandaCompuestaJson || null,
      prioridad1: prioridad1 || null,
      prioridad2: prioridad2 || null,
      tmnCalculadoMm: tmnCalculadoMm || null,
      moduloFinura: moduloFinura || null,
      curvaMezclaJson: curvaMezclaJson || null,
      metadataResultadoJson: metadataResultadoJson || null,
      tipoOptimizacion: tipoOptimizacion || null,
      proporcionesOptimasJson: proporcionesOptimasJson || null,
      rangosFactiblesJson: rangosFactiblesJson || null,
      metricasOptimoJson: metricasOptimoJson || null,
      metricasAdoptadoJson: metricasAdoptadoJson || null,
      calidadAjuste: calidadAjuste || null,
      motivoAjuste: motivoAjuste || null,
    });
    // Replace items
    await db.MezclaAgregadosItem.destroy({ where: { idMezcla: existingId } });
  } else {
    mezcla = await db.MezclaAgregados.create({
      nombre,
      descripcion: descripcion || null,
      idPlanta,
      tipoMezcla,
      objetivoModo: objetivoModo || null,
      idBanda: idBanda || null,
      idCurvaTeorica: idCurvaTeorica || null,
      bandaCompuestaJson: bandaCompuestaJson || null,
      prioridad1: prioridad1 || null,
      prioridad2: prioridad2 || null,
      tmnCalculadoMm: tmnCalculadoMm || null,
      moduloFinura: moduloFinura || null,
      curvaMezclaJson: curvaMezclaJson || null,
      metadataResultadoJson: metadataResultadoJson || null,
      tipoOptimizacion: tipoOptimizacion || null,
      proporcionesOptimasJson: proporcionesOptimasJson || null,
      rangosFactiblesJson: rangosFactiblesJson || null,
      metricasOptimoJson: metricasOptimoJson || null,
      metricasAdoptadoJson: metricasAdoptadoJson || null,
      calidadAjuste: calidadAjuste || null,
      motivoAjuste: motivoAjuste || null,
    });
    // Set mezclaBaseId to self on first creation
    await mezcla.update({ mezclaBaseId: mezcla.idMezcla });
  }

  const itemRecords = items.map((it, idx) => ({
    idMezcla: mezcla.idMezcla,
    idAgregado: it.idAgregado,
    porcentajeFinal: it.porcentajeFinal,
    orden: it.orden ?? idx,
  }));

  await db.MezclaAgregadosItem.bulkCreate(itemRecords);

  return getMezcla(db, mezcla.idMezcla);
}

/**
 * Helper compartido por `modificarProporcionesEnUso` (con dosi) y
 * `modificarProporcionesMezclaSinDosi` (durante diseño no persistido).
 *
 * Valida las proporciones (suma 100 y mismos agregados que la mezcla),
 * recalcula curva/TMN/MF reusando `evaluar`, decide inplace vs fork según el
 * conteo de dosis activas que referencien la mezcla (excluyendo `idDosiAExcluir`
 * si se pasa), y persiste vía `guardarMezcla`.
 *
 * @param {object} db
 * @param {object} mezcla  Instancia Sequelize cargada con include `items`.
 * @param {Array<{idAgregado, porcentajeFinal}>} proporciones
 * @param {object} opciones
 * @param {number|null} opciones.idDosiAExcluir  Dosi a excluir del conteo (su
 *        propio uso no obliga a forkear). En modo sin-dosi se pasa `null`.
 * @returns {Promise<{ idMezcla:number, modo:'inplace'|'fork', mezcla:object }>}
 */
async function _aplicarCambioProporcionesMezcla(db, mezcla, proporciones, { idDosiAExcluir = null } = {}) {
  if (!Array.isArray(proporciones) || proporciones.length < 2) {
    throw Object.assign(new Error('Se requieren al menos 2 proporciones.'), { status: 422 });
  }
  const sumaPct = proporciones.reduce((s, p) => s + Number(p.porcentajeFinal || 0), 0);
  if (Math.abs(sumaPct - 100) > 0.5) {
    throw Object.assign(
      new Error(`La suma de proporciones debe ser 100% (actual: ${round2(sumaPct)}%).`),
      { status: 422 }
    );
  }

  const idsActuales = new Set((mezcla.items || []).map((it) => Number(it.idAgregado)));
  const idsNuevos = new Set(proporciones.map((p) => Number(p.idAgregado)));
  if (idsActuales.size !== idsNuevos.size
      || [...idsActuales].some((id) => !idsNuevos.has(id))) {
    throw Object.assign(
      new Error('Las proporciones enviadas no coinciden con los agregados de la mezcla (no se permite agregar/quitar items por este endpoint).'),
      { status: 422 }
    );
  }

  // Recalcular curva + TMN + MF + bandas con las nuevas proporciones.
  // Llamamos a través de `module.exports` para que los tests puedan spyear
  // `evaluar` y `guardarMezcla` sin tener que stubear la cadena de DB completa.
  const evaluacionNueva = await module.exports.evaluar(db, {
    plantaId: mezcla.idPlanta,
    tipoMezcla: mezcla.tipoMezcla,
    agregados: proporciones.map((p) => ({
      id: Number(p.idAgregado),
      porcentaje: Number(p.porcentajeFinal),
    })),
    objetivoId: mezcla.idCurvaTeorica || null,
  });

  const itemsNuevos = proporciones.map((p, idx) => ({
    idAgregado: Number(p.idAgregado),
    porcentajeFinal: Number(p.porcentajeFinal),
    orden: idx,
  }));

  // Contar dosis activas que comparten la mezcla, excluyendo la actual si
  // corresponde. En modo sin-dosi, `idDosiAExcluir` es null y se cuentan todas.
  const Op = db.Sequelize.Op;
  const whereCount = { idMezcla: mezcla.idMezcla, activo: true };
  if (idDosiAExcluir != null) {
    whereCount.id = { [Op.ne]: Number(idDosiAExcluir) };
  }
  const otrasDosis = await db.DosificacionDisenada.count({ where: whereCount });

  const baseGuardado = {
    nombre: mezcla.nombre,
    descripcion: mezcla.descripcion,
    idPlanta: mezcla.idPlanta,
    tipoMezcla: mezcla.tipoMezcla,
    objetivoModo: mezcla.objetivoModo,
    idBanda: mezcla.idBanda,
    idCurvaTeorica: mezcla.idCurvaTeorica,
    bandaCompuestaJson: mezcla.bandaCompuestaJson,
    prioridad1: mezcla.prioridad1,
    prioridad2: mezcla.prioridad2,
    // `calcularTMN` (granulometriaEvalService) retorna `{valor, tamiz}` —
    // NO un número. La columna `tmnCalculadoMm` es DOUBLE; pasarle el
    // objeto produce "Data truncated for column 'tmnCalculadoMm'". Misma
    // defensa para `moduloFinura` por si algún branch retorna objeto.
    tmnCalculadoMm: (() => {
      const t = evaluacionNueva.tmn;
      if (t == null) return null;
      if (typeof t === 'number') return Number.isFinite(t) ? t : null;
      if (typeof t === 'object' && t.valor != null) {
        const v = Number(t.valor);
        return Number.isFinite(v) ? v : null;
      }
      return null;
    })(),
    moduloFinura: (() => {
      const m = evaluacionNueva.moduloFinura;
      if (m == null) return null;
      if (typeof m === 'number') return Number.isFinite(m) ? m : null;
      if (typeof m === 'object' && m.valor != null) {
        const v = Number(m.valor);
        return Number.isFinite(v) ? v : null;
      }
      return null;
    })(),
    curvaMezclaJson: evaluacionNueva.curvaMix || null,
    metadataResultadoJson: {
      ...(typeof mezcla.metadataResultadoJson === 'string'
        ? (() => { try { return JSON.parse(mezcla.metadataResultadoJson); } catch { return {}; } })()
        : (mezcla.metadataResultadoJson || {})),
      evaluacion: evaluacionNueva.evaluacion || null,
      trazabilidad: evaluacionNueva.trazabilidad || null,
    },
    tipoOptimizacion: mezcla.tipoOptimizacion,
    proporcionesOptimasJson: itemsNuevos.reduce((acc, it) => {
      acc[String(it.idAgregado)] = it.porcentajeFinal;
      return acc;
    }, {}),
    rangosFactiblesJson: mezcla.rangosFactiblesJson,
    metricasOptimoJson: mezcla.metricasOptimoJson,
    metricasAdoptadoJson: mezcla.metricasAdoptadoJson,
    calidadAjuste: mezcla.calidadAjuste,
    motivoAjuste: mezcla.motivoAjuste,
    items: itemsNuevos,
  };

  if (otrasDosis === 0) {
    // INPLACE — nadie más referencia la mezcla (o solo la dosi actual la usa).
    const guardada = await module.exports.guardarMezcla(db, { ...baseGuardado, idMezcla: mezcla.idMezcla });
    return { idMezcla: mezcla.idMezcla, modo: 'inplace', mezcla: guardada };
  }

  // FORK — la mezcla está compartida. Creamos una nueva con sufijo de fecha
  // (sin tocar la mezcla vieja). El caller decide si reapunta una dosi a la
  // nueva (cuando hay dosi) o si solo devuelve la nueva al frontend (sin dosi).
  const ahora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const sufijo = ` (mod. ${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())} ${pad(ahora.getHours())}:${pad(ahora.getMinutes())})`;
  const nuevaMezcla = await module.exports.guardarMezcla(db, { ...baseGuardado, nombre: `${mezcla.nombre}${sufijo}` });
  return { idMezcla: nuevaMezcla.idMezcla, modo: 'fork', mezcla: nuevaMezcla };
}

/**
 * Modifica las proporciones de la mezcla VINCULADA A UNA DOSIFICACIÓN en
 * estado BORRADOR. Lógica de versionado automática (sesión 2026-05-27):
 *
 *   - Si la mezcla SOLO la usa esta dosi (no hay otras DosificacionDisenada
 *     activas con `idMezcla` igual): se modifica IN-PLACE.
 *   - Si la mezcla está COMPARTIDA con otras dosis: se hace FORK + reapunte
 *     automático de `dosi.idMezcla` al nuevo registro.
 *
 * Sólo se permite en BORRADOR. En PENDIENTE_REVISION, A_PRUEBA, etc. la mezcla
 * queda congelada.
 *
 * @param {object} db
 * @param {number} idDosi
 * @param {{ proporciones: Array<{idAgregado:number, porcentajeFinal:number}> }} payload
 * @returns {Promise<{ idMezcla:number, modo:'inplace'|'fork', mezcla:object }>}
 */
async function modificarProporcionesEnUso(db, idDosi, payload = {}) {
  const { proporciones } = payload;
  const dosi = await db.DosificacionDisenada.findByPk(Number(idDosi));
  if (!dosi) throw Object.assign(new Error('Dosificación no encontrada.'), { status: 404 });
  if (dosi.estado !== 'BORRADOR') {
    throw Object.assign(
      new Error(`Solo se pueden modificar proporciones en BORRADOR. Estado actual: ${dosi.estado}.`),
      { status: 422, code: 'MEZCLA_PROPORCIONES_LIFECYCLE' }
    );
  }
  if (!dosi.idMezcla) {
    throw Object.assign(new Error('La dosificación no tiene una mezcla vinculada.'), { status: 422 });
  }
  const mezcla = await db.MezclaAgregados.findByPk(dosi.idMezcla, {
    include: [{ model: db.MezclaAgregadosItem, as: 'items', required: false }],
  });
  if (!mezcla) throw Object.assign(new Error('Mezcla referenciada no encontrada.'), { status: 404 });

  const result = await _aplicarCambioProporcionesMezcla(db, mezcla, proporciones, { idDosiAExcluir: dosi.id });
  if (result.modo === 'fork') {
    await dosi.update({ idMezcla: result.idMezcla });
  }
  return result;
}

/**
 * Modifica proporciones de una mezcla **sin** contexto de dosificación
 * guardada. Caso de uso (sesión 2026-05-27): el operador está diseñando una
 * nueva dosi (sin guardar), seleccionó una mezcla del catálogo y quiere
 * ajustar sus proporciones antes de calcular/guardar.
 *
 * Lógica: si la mezcla NO es referenciada por ninguna dosi activa, se modifica
 * in-place. Si la usan otras dosis, se forkea — el caller (frontend) es
 * responsable de actualizar `form.mezclaId` a la nueva id devuelta.
 *
 * @param {object} db
 * @param {number} idMezcla
 * @param {{ proporciones: Array<{idAgregado:number, porcentajeFinal:number}> }} payload
 * @returns {Promise<{ idMezcla:number, modo:'inplace'|'fork', mezcla:object }>}
 */
async function modificarProporcionesMezclaSinDosi(db, idMezcla, payload = {}) {
  const { proporciones } = payload;
  const mezcla = await db.MezclaAgregados.findByPk(Number(idMezcla), {
    include: [{ model: db.MezclaAgregadosItem, as: 'items', required: false }],
  });
  if (!mezcla) throw Object.assign(new Error('Mezcla no encontrada.'), { status: 404 });
  return _aplicarCambioProporcionesMezcla(db, mezcla, proporciones, { idDosiAExcluir: null });
}

/**
 * List saved mixes, optionally filtered by plantaId and tipoMezcla.
 */
async function listarMezclas(db, filters = {}) {
  const where = { isActive: true };
  if (filters.plantaId) where.idPlanta = Number(filters.plantaId);
  if (filters.tipoMezcla) where.tipoMezcla = filters.tipoMezcla;

  // Include Agregado + AgregadoGrueso so we can derive forma del agregado
  const itemInclude = [];
  if (db.Agregado) {
    const agInclude = [];
    if (db.AgregadoGrueso) agInclude.push({ model: db.AgregadoGrueso, as: 'agregadoGrueso', required: false });
    itemInclude.push({
      model: db.Agregado, as: 'agregado',
      attributes: ['idAgregado', 'nombre'],
      include: agInclude,
    });
  }

  const includes = [
    { model: db.MezclaAgregadosItem, as: 'items', include: itemInclude },
  ];
  if (db.Planta) {
    includes.push({ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false });
  }

  const mezclas = await db.MezclaAgregados.findAll({
    where,
    include: includes,
    order: [['createdAt', 'DESC']],
  });

  const plainList = mezclas.map(m => m.get({ plain: true }));

  // Count dosificaciones referencing each mezcla (for "en uso" indicator)
  if (db.DosificacionDisenada) {
    const mezclaIds = plainList.map(m => m.idMezcla).filter(Boolean);
    if (mezclaIds.length > 0) {
      const counts = await db.DosificacionDisenada.findAll({
        where: { idMezcla: mezclaIds, activo: true },
        attributes: [
          'idMezcla',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'cnt'],
        ],
        group: ['idMezcla'],
        raw: true,
      });
      const countMap = {};
      for (const row of counts) countMap[row.idMezcla] = Number(row.cnt);
      for (const m of plainList) {
        m.dosificacionCount = countMap[m.idMezcla] || 0;
      }
    }
  }

  // Derive forma del agregado for each mezcla from the selected aggregate mix.
  const allAggregateIds = [];
  for (const m of plainList) {
    for (const it of (m.items || [])) {
      if (it.idAgregado) allAggregateIds.push(it.idAgregado);
    }
  }
  const metaMap = await getAggregateFormaMetaMap(db, allAggregateIds);

  for (const m of plainList) {
    for (const item of (m.items || [])) {
      if (!item.nombreAgregado && item.agregado?.nombre) {
        item.nombreAgregado = item.agregado.nombre;
      }
    }
    m.derivedForma = deriveFormaFromItems(m.items || [], metaMap);

    // ROUND-FINAL 1: derive estadoTecnico from saved metadata so the dosification
    // frontend can propagate "mezcla base fuera de banda" as a critical motivo.
    if (!m.estadoTecnico) {
      try {
        let meta = m.metadataResultadoJson;
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
        const evalB = meta?.evaluacionBanda || meta?.evaluacion;
        if (evalB) {
          const cumpleB = evalB.cumple === true || evalB.estado === 'CUMPLE';
          const nFuera = (evalB.fueraDeBanda || []).length;
          const maxDesv = (evalB.fueraDeBanda || []).reduce((mx, t) => Math.max(mx, Math.abs(t.desvio || 0)), 0);
          if (cumpleB) m.estadoTecnico = 'CUMPLE';
          else if (nFuera <= 2 && maxDesv <= 3) m.estadoTecnico = 'CUMPLE_OBS';
          else if (nFuera > 0 && nFuera <= 4) m.estadoTecnico = 'REQUIERE_AJUSTE';
          else m.estadoTecnico = 'NO_CUMPLE';
        }
      } catch { /* non-blocking */ }
    }
  }

  return plainList;
}

/**
 * Get a single saved mix by ID with full detail.
 */
async function getMezcla(db, idMezcla) {
  const itemInclude = [];
  if (db.Agregado) {
    const agInclude = [];
    if (db.AgregadoGrueso) agInclude.push({ model: db.AgregadoGrueso, as: 'agregadoGrueso', required: false });
    if (db.AgregadoFino) agInclude.push({ model: db.AgregadoFino, as: 'agregadoFino', required: false });
    itemInclude.push({
      model: db.Agregado,
      as: 'agregado',
      attributes: ['idAgregado', 'nombre', 'origen', 'densidad', 'absorcion'],
      include: agInclude,
    });
  }

  const includes = [
    {
      model: db.MezclaAgregadosItem,
      as: 'items',
      include: itemInclude,
    },
  ];
  if (db.Planta) {
    includes.push({ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false });
  }
  if (db.CurvaGranulometrica) {
    includes.push({ model: db.CurvaGranulometrica, as: 'banda', required: false,
      include: db.CurvaPunto ? [{ model: db.CurvaPunto, as: 'puntos' }] : [] });
    includes.push({ model: db.CurvaGranulometrica, as: 'curvaTeorica', required: false,
      include: db.CurvaPunto ? [{ model: db.CurvaPunto, as: 'puntos' }] : [] });
  }

  const mezcla = await db.MezclaAgregados.findByPk(idMezcla, { include: includes });
  if (!mezcla) return null;
  const plain = mezcla.get({ plain: true });

  for (const item of (plain.items || [])) {
    if (!item.nombreAgregado && item.agregado?.nombre) {
      item.nombreAgregado = item.agregado.nombre;
    }
  }

  const aggregateIds = (plain.items || []).map((item) => item.idAgregado).filter(Boolean);
  const metaMap = await getAggregateFormaMetaMap(db, aggregateIds);
  plain.derivedForma = deriveFormaFromItems(plain.items || [], metaMap);

  // Parse metadataResultadoJson una sola vez (lo necesitan estadoTecnico y evalBanda).
  // metadataResultadoJson queda intacto en el response para back-compat con
  // consumers que ya parsean el JSON por su cuenta.
  let metaParsed = null;
  if (plain.metadataResultadoJson) {
    if (typeof plain.metadataResultadoJson === 'string') {
      try { metaParsed = JSON.parse(plain.metadataResultadoJson); } catch { metaParsed = null; }
    } else if (typeof plain.metadataResultadoJson === 'object') {
      metaParsed = plain.metadataResultadoJson;
    }
  }

  // ROUND-FINAL 1: derive estadoTecnico from saved metadata
  if (!plain.estadoTecnico && metaParsed) {
    const evalB = metaParsed.evaluacionBanda || metaParsed.evaluacion;
    if (evalB) {
      const cumpleB = evalB.cumple === true || evalB.estado === 'CUMPLE';
      const nFuera = (evalB.fueraDeBanda || []).length;
      const maxDesv = (evalB.fueraDeBanda || []).reduce((mx, t) => Math.max(mx, Math.abs(t.desvio || 0)), 0);
      if (cumpleB) plain.estadoTecnico = 'CUMPLE';
      else if (nFuera <= 2 && maxDesv <= 3) plain.estadoTecnico = 'CUMPLE_OBS';
      else if (nFuera > 0 && nFuera <= 4) plain.estadoTecnico = 'REQUIERE_AJUSTE';
      else plain.estadoTecnico = 'NO_CUMPLE';
    }
  }

  // C3.5 (Prompt 3) — Exponer `evalBanda` con compliance canónico al nivel raíz.
  // Hasta ahora el compliance de la verificación granulométrica de mezcla
  // (IRAM 1627, Nivel 2) quedaba enterrado dentro de `metadataResultadoJson`.
  // El frontend (MezclaDetallePage en C4) lo necesita para renderizar el
  // veredicto canónico (passWithObservations cuando cumple A-C pero no A-B,
  // etc.). Lo expone como campo top-level. Si no hay metadata, queda null
  // (mezclas pre-Prompt 2 sin metadata persistida).
  plain.evalBanda = null;
  if (metaParsed) {
    const eb = metaParsed.evaluacionBanda || metaParsed.evaluacion;
    if (eb) {
      // Re-frenado: solo exponemos los campos relevantes para el frontend,
      // no el JSON entero (que puede ser pesado y traer datos internos).
      plain.evalBanda = {
        tipo: eb.tipo || null,
        cumple: eb.cumple ?? null,
        estado: eb.estado || null,
        bandaEvaluada: eb.bandaEvaluada || null,
        tablaRef: eb.tablaRef || null,
        mensaje: eb.mensaje || null,
        nFuera: (eb.fueraDeBanda || []).length,
        compliance: eb.compliance || null,  // ← canónico canónicamente expuesto
      };
    }
  }

  return plain;
}

/**
 * Soft-delete a saved mix with reference checks.
 */
async function eliminarMezcla(db, idMezcla, usuario) {
  const mezcla = await db.MezclaAgregados.findByPk(idMezcla);
  if (!mezcla) throw new Error(`Mezcla #${idMezcla} no encontrada`);

  // 1) Solo BORRADOR se puede eliminar
  if (!isDeletable(mezcla.estado)) {
    throw Object.assign(
      new Error(`No se puede eliminar una mezcla en estado ${mezcla.estado}. Solo se pueden eliminar borradores. Si ya no se utiliza, cambie el estado a ARCHIVADO.`),
      { statusCode: 422 }
    );
  }

  // 2) Verificar que no sea referenciada por dosificaciones activas
  const dosifCount = await db.DosificacionDisenada.count({
    where: { idMezcla, activo: true },
  });
  if (dosifCount > 0) {
    throw Object.assign(
      new Error(`No se puede eliminar: es referenciada por ${dosifCount} dosificación(es). Archive la mezcla en su lugar.`),
      { statusCode: 422 }
    );
  }

  // 3) Verificar que no haya tenido estados anteriores distintos de BORRADOR
  const histEstados = await db.DisenoHistorial.findAll({
    where: { entidadTipo: 'mezcla', entidadId: idMezcla },
    attributes: ['estadoNuevo'],
  });
  const tuvoOtroEstado = histEstados.some(h => h.estadoNuevo && h.estadoNuevo !== 'BORRADOR');
  if (tuvoOtroEstado) {
    throw Object.assign(
      new Error('No se puede eliminar: esta mezcla tuvo estados anteriores. Archive en su lugar para mantener el registro histórico.'),
      { statusCode: 422 }
    );
  }

  // Soft delete (instead of hard delete)
  await mezcla.update({ isActive: false, deletedAt: new Date(), deletedBy: usuario || null });
  return { action: 'archived', message: 'Mezcla eliminada' };
}

/**
 * Duplicate a saved mix: creates a new MezclaAgregados with copied data.
 * Returns the new complete mezcla.
 */
async function duplicarMezcla(db, idMezcla) {
  const original = await getMezcla(db, idMezcla);
  if (!original) throw new Error(`Mezcla #${idMezcla} no encontrada`);

  const copia = await db.MezclaAgregados.create({
    nombre: `${original.nombre} (copia)`,
    descripcion: original.descripcion || null,
    idPlanta: original.idPlanta,
    tipoMezcla: original.tipoMezcla,
    objetivoModo: original.objetivoModo || null,
    idBanda: original.idBanda || null,
    idCurvaTeorica: original.idCurvaTeorica || null,
    bandaCompuestaJson: original.bandaCompuestaJson || null,
    prioridad1: original.prioridad1 || null,
    prioridad2: original.prioridad2 || null,
    tmnCalculadoMm: original.tmnCalculadoMm || null,
    moduloFinura: original.moduloFinura || null,
    curvaMezclaJson: original.curvaMezclaJson || null,
    metadataResultadoJson: original.metadataResultadoJson || null,
    estado: 'BORRADOR',
    version: 1,
  });
  // Self-referencing base ID
  await copia.update({ mezclaBaseId: copia.idMezcla });

  if (original.items?.length) {
    const itemRecords = original.items.map((it, idx) => ({
      idMezcla: copia.idMezcla,
      idAgregado: it.idAgregado,
      porcentajeFinal: it.porcentajeFinal,
      orden: it.orden ?? idx,
    }));
    await db.MezclaAgregadosItem.bulkCreate(itemRecords);
  }

  return getMezcla(db, copia.idMezcla);
}

/* ════════════════════════════════════════════════════════
   Estado transitions, versioning, hash, historial
   ════════════════════════════════════════════════════════ */

function generarCodigoMezcla() {
  const rand = crypto.randomBytes(4).toString('base64url').substring(0, 6).toUpperCase();
  return `MZC-${rand}`;
}

/**
 * Transition a mezcla to a new estado, enforcing rules from estadoMachine.
 */
async function transicionarEstadoMezcla(db, idMezcla, { nuevoEstado, usuario, motivo, observaciones, metadata } = {}) {
  const row = await db.MezclaAgregados.findByPk(idMezcla);
  if (!row) throw Object.assign(new Error('Mezcla no encontrada'), { status: 404 });

  const estadoAnterior = row.estado;
  validateTransition(estadoAnterior, nuevoEstado);

  const { getTransitionRequirements } = require('../domain/dosificacion/estadoMachine');
  const reqs = getTransitionRequirements(nuevoEstado);
  const updates = { estado: nuevoEstado };

  // ── Pre-transition validations ──

  if (reqs.requiresCalculo) {
    if (!row.curvaMezclaJson) {
      throw Object.assign(
        new Error('La mezcla debe tener un cálculo exitoso antes de enviar a revisión.'),
        { status: 422 }
      );
    }
  }

  if (reqs.requiresMotivo && !motivo) {
    throw Object.assign(
      new Error('Se requiere un motivo para esta transición.'),
      { status: 422 }
    );
  }

  // ── State-specific updates ──

  if (nuevoEstado === 'PENDIENTE_REVISION') {
    updates.enviadoRevisionPor = usuario || null;
    updates.fechaEnvioRevision = new Date();
  } else if (nuevoEstado === 'APROBADO') {
    updates.aprobadoPor = usuario || null;
    updates.fechaAprobacion = new Date();
    updates.observacionesAprobacion = observaciones || null;
    updates.motivoSuspension = null;

    // Calculate and store integrity hash
    const items = await db.MezclaAgregadosItem.findAll({
      where: { idMezcla },
      order: [['orden', 'ASC']],
    });
    const datos = buildDatosMezcla(row.get({ plain: true }), items.map(i => i.get({ plain: true })));
    const { hashCompleto, datosJson } = calcularHash(datos);
    updates.hashIntegridad = hashCompleto;
    updates.hashDatosJson = datosJson;

    // Generate codigo if not set
    if (!row.codigoBase) {
      const codigoBase = generarCodigoMezcla();
      updates.codigoBase = codigoBase;
      updates.codigo = `${codigoBase}.v${row.version}`;
    } else if (!row.codigo) {
      updates.codigo = `${row.codigoBase}.v${row.version}`;
    }
  } else if (nuevoEstado === 'SUSPENDIDO') {
    updates.motivoSuspension = motivo || null;
    updates.suspendidoPor = usuario || null;
    updates.fechaSuspension = new Date();
  } else if (nuevoEstado === 'ARCHIVADO') {
    updates.archivadoPor = usuario || null;
    updates.fechaArchivo = new Date();
    if (metadata?.reemplazadaPorId) {
      updates.reemplazadaPorId = metadata.reemplazadaPorId;
    }
  } else if (nuevoEstado === 'BORRADOR') {
    updates.aprobadoPor = null;
    updates.fechaAprobacion = null;
    updates.observacionesAprobacion = observaciones || null;
    updates.enviadoRevisionPor = null;
    updates.fechaEnvioRevision = null;
    updates.motivoSuspension = null;
    updates.suspendidoPor = null;
    updates.fechaSuspension = null;
    updates.hashIntegridad = null;
    updates.hashDatosJson = null;
  } else if (nuevoEstado === 'A_PRUEBA') {
    updates.enviadoRevisionPor = null;
    updates.fechaEnvioRevision = null;
  }

  await row.update(updates);

  // Record in unified historial
  const tipoEventoMap = {
    APROBADO: 'aprobacion',
    SUSPENDIDO: 'suspension',
    ARCHIVADO: 'archivado',
  };
  await db.DisenoHistorial.create({
    entidadTipo: 'mezcla',
    entidadId: idMezcla,
    tipoEvento: tipoEventoMap[nuevoEstado] || 'cambio_estado',
    estadoAnterior,
    estadoNuevo: nuevoEstado,
    usuario: usuario || 'sistema',
    motivo: motivo || null,
    observaciones: observaciones || null,
    hashAlMomento: updates.hashIntegridad || row.hashIntegridad || null,
    metadata: metadata || null,
  });

  return row.reload();
}

/**
 * Create a new version (deep copy) of a mezcla as BORRADOR.
 * Allowed from: APROBADO, SUSPENDIDO.
 */
async function crearNuevaVersionMezcla(db, idOriginal, { usuario, motivo } = {}) {
  const original = await db.MezclaAgregados.findByPk(idOriginal, {
    include: [{ model: db.MezclaAgregadosItem, as: 'items' }],
  });
  if (!original) throw Object.assign(new Error('Mezcla no encontrada'), { status: 404 });

  const allowedStates = ['APROBADO', 'SUSPENDIDO'];
  if (!allowedStates.includes(original.estado)) {
    throw Object.assign(
      new Error(`Solo se puede crear una nueva versión desde estados: ${allowedStates.join(', ')} (actual: ${original.estado}).`),
      { status: 422 }
    );
  }

  const baseId = original.mezclaBaseId || original.idMezcla;
  const codigoBase = original.codigoBase || generarCodigoMezcla();

  const maxVersion = await db.MezclaAgregados.max('version', {
    where: { mezclaBaseId: baseId, isActive: true },
  });

  const newVersion = (maxVersion || original.version) + 1;

  const copy = await db.MezclaAgregados.create({
    nombre: original.nombre,
    descripcion: original.descripcion,
    idPlanta: original.idPlanta,
    tipoMezcla: original.tipoMezcla,
    objetivoModo: original.objetivoModo,
    idBanda: original.idBanda,
    idCurvaTeorica: original.idCurvaTeorica,
    bandaCompuestaJson: original.bandaCompuestaJson,
    prioridad1: original.prioridad1,
    prioridad2: original.prioridad2,
    tmnCalculadoMm: original.tmnCalculadoMm,
    moduloFinura: original.moduloFinura,
    curvaMezclaJson: original.curvaMezclaJson,
    metadataResultadoJson: original.metadataResultadoJson,
    estado: 'BORRADOR',
    version: newVersion,
    versionPadreId: original.idMezcla,
    mezclaBaseId: baseId,
    codigoBase,
    codigo: `${codigoBase}.v${newVersion}`,
    isActive: true,
  });

  // Copy items
  if (original.items?.length) {
    const itemRecords = original.items.map((it, idx) => ({
      idMezcla: copy.idMezcla,
      idAgregado: it.idAgregado,
      porcentajeFinal: it.porcentajeFinal,
      orden: it.orden ?? idx,
    }));
    await db.MezclaAgregadosItem.bulkCreate(itemRecords);
  }

  const motivoText = motivo
    ? `Nueva versión (v${newVersion}) creada a partir de v${original.version}: ${motivo}`
    : `Nueva versión (v${newVersion}) creada a partir de v${original.version}`;

  await db.DisenoHistorial.create({
    entidadTipo: 'mezcla',
    entidadId: copy.idMezcla,
    tipoEvento: 'nueva_version',
    estadoAnterior: null,
    estadoNuevo: 'BORRADOR',
    usuario: usuario || 'sistema',
    motivo: motivoText,
    metadata: { versionPadreId: original.idMezcla, versionAnterior: original.version },
  });

  // Backfill codigoBase on original if it didn't have one
  if (!original.codigoBase) {
    await original.update({ codigoBase, codigo: `${codigoBase}.v${original.version}` });
  }

  return getMezcla(db, copy.idMezcla);
}

/**
 * Get all versions in a mezcla chain.
 */
async function obtenerVersionesMezcla(db, idMezcla) {
  const row = await db.MezclaAgregados.findByPk(idMezcla);
  if (!row) throw Object.assign(new Error('Mezcla no encontrada'), { status: 404 });

  const baseId = row.mezclaBaseId || row.idMezcla;

  return db.MezclaAgregados.findAll({
    where: { mezclaBaseId: baseId, isActive: true },
    attributes: [
      'idMezcla', 'nombre', 'estado', 'version', 'versionPadreId',
      'codigo', 'codigoBase', 'hashIntegridad',
      'aprobadoPor', 'fechaAprobacion', 'observacionesAprobacion',
      'enviadoRevisionPor', 'fechaEnvioRevision',
      'suspendidoPor', 'fechaSuspension', 'motivoSuspension',
      'archivadoPor', 'fechaArchivo',
      'reemplazadaPorId', 'createdAt', 'updatedAt',
    ],
    order: [['version', 'DESC']],
  });
}

/**
 * Get unified historial (audit log) for a mezcla.
 */
async function obtenerHistorialMezcla(db, idMezcla) {
  return db.DisenoHistorial.findAll({
    where: { entidadTipo: 'mezcla', entidadId: idMezcla },
    order: [['createdAt', 'ASC']],
  });
}

/**
 * Verify hash integrity of an approved mezcla.
 */
async function verificarIntegridadMezcla(db, idMezcla) {
  const mezcla = await db.MezclaAgregados.findByPk(idMezcla);
  if (!mezcla) throw Object.assign(new Error('Mezcla no encontrada'), { status: 404 });

  if (!isImmutable(mezcla.estado)) {
    return { ok: false, reason: `Estado ${mezcla.estado} no tiene hash de integridad` };
  }

  const items = await db.MezclaAgregadosItem.findAll({
    where: { idMezcla },
    order: [['orden', 'ASC']],
  });

  const result = verificarIntegridad(
    mezcla,
    buildDatosMezcla,
    items.map(i => i.get({ plain: true }))
  );

  return {
    ...result,
    idMezcla: mezcla.idMezcla,
    nombre: mezcla.nombre,
    estado: mezcla.estado,
    codigo: mezcla.codigo,
    fechaAprobacion: mezcla.fechaAprobacion,
  };
}

/**
 * Lista mezclas guardadas (FINO/GRUESO) de una planta y las devuelve en
 * formato "agregado virtual" con id negativo, listo para mezclarse en la lista
 * de agregados disponibles para mezcla TOTAL. Auditoría 02-dosificación R16.
 *
 * @param {object} db
 * @param {number} idPlanta
 * @returns {Promise<Array>}
 */
async function listarMezclasComoAgregadosVirtuales(db, idPlanta) {
  if (!db.MezclaAgregados) return [];
  const itemInclude = [];
  if (db.Agregado) {
    itemInclude.push({
      model: db.Agregado,
      as: 'agregado',
      attributes: ['idAgregado', 'nombre'],
      required: false,
    });
  }
  const mixes = await db.MezclaAgregados.findAll({
    where: { isActive: true, idPlanta: Number(idPlanta), tipoMezcla: ['FINO', 'GRUESO'] },
    include: [{ model: db.MezclaAgregadosItem, as: 'items', include: itemInclude }],
    order: [['nombre', 'ASC']],
  });

  const out = [];
  for (const m of mixes) {
    const plain = m.get({ plain: true });
    let puntos = plain.curvaMezclaJson || [];
    if (typeof puntos === 'string') {
      try { puntos = JSON.parse(puntos); } catch { puntos = []; }
    }
    if (!Array.isArray(puntos)) puntos = [];
    out.push({
      id: -(plain.idMezcla),
      nombre: plain.nombre,
      tipoAgregado: plain.tipoMezcla === 'FINO' ? 'Fino' : 'Grueso',
      esMezclaGuardada: true,
      mezclaId: plain.idMezcla,
      mezclaItems: (plain.items || []).map(it => ({
        idAgregado: it.idAgregado,
        nombre: it.nombreAgregado || it.agregado?.nombre || `Agregado ${it.idAgregado}`,
        porcentajeFinal: it.porcentajeFinal,
      })),
      tmnCalculadoMm: plain.tmnCalculadoMm,
      moduloFinura: plain.moduloFinura,
      tieneGranulometria: puntos.length > 0,
      granulometria: puntos.length > 0 ? {
        fecha: plain.updatedAt,
        codigo: 'Mezcla guardada',
        nPuntos: puntos.length,
        puntos,
      } : null,
    });
  }
  return out;
}

/**
 * Enriquece items de mezcla con `nombre` faltante consultando el catálogo de
 * agregados. Idempotente: si el item ya tiene `nombre` o no tiene `idAgregado`,
 * lo deja como está. Auditoría 02-dosificación R16.
 *
 * @param {object} db
 * @param {Array} items
 * @returns {Promise<Array>}
 */
async function enriquecerItemsConNombre(db, items) {
  if (!Array.isArray(items) || !db.Agregado) return items;
  return Promise.all(items.map(async (it) => {
    if (it.nombre || !it.idAgregado) return it;
    try {
      const agRow = await db.Agregado.findByPk(it.idAgregado, { attributes: ['nombre'] });
      return { ...it, nombre: agRow?.nombre || null };
    } catch { return it; }
  }));
}

/* ════════════════════════════════════════════════════════
   Exports
   ════════════════════════════════════════════════════════ */

module.exports = {
  getUltimaGranulometria,
  buildUnifiedGrid,
  resolveOnGrid,
  calcularMezcla,
  evaluarContraObjetivo,
  buildTrazabilidad,
  evaluar,
  optimizar,
  guardarMezcla,
  listarMezclas,
  getMezcla,
  eliminarMezcla,
  duplicarMezcla,
  modificarProporcionesEnUso,
  modificarProporcionesMezclaSinDosi,
  // Lookups que usaba el controller directo (R16)
  listarMezclasComoAgregadosVirtuales,
  enriquecerItemsConNombre,
  // Estado & versioning
  transicionarEstadoMezcla,
  crearNuevaVersionMezcla,
  obtenerVersionesMezcla,
  obtenerHistorialMezcla,
  verificarIntegridadMezcla,
  // Dynamic theoretical curve generation
  buildVirtualTeorica,
  previewCurvaTeorica,
  FAMILIA_MAP,
  TMN_OPTIONS,
  // Internals exposed for testing
  _computeCost: computeCost,
  _computeBandMetrics: computeBandMetrics,
  _solveMixLP: solveMixLP,
  _solveTheoreticalLP: solveTheoreticalLP,
  _solveCombinedLP: solveCombinedLP,
  _computeFeasibleRanges: computeFeasibleRanges,
  _buildPMatrix: buildPMatrix,
  _buildTargetsOnGrid: buildTargetsOnGrid,
  _buildTheoreticalTargetsOnGrid: buildTheoreticalTargetsOnGrid,
  _buildComparableSieveSet: buildComparableSieveSet,
  _interpolatePrecomputedOnGrid: _interpolatePrecomputedOnGrid,
  _computeWeightedTheoreticalCost: computeWeightedTheoreticalCost,
  _computeTheoreticalMetrics: computeTheoreticalMetrics,
};
