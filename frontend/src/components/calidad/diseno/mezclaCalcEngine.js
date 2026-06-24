/**
 * mezclaCalcEngine.js
 *
 * Pure frontend calculation engine for aggregate mix design.
 * All functions are stateless and synchronous — no API calls.
 * Ported from hormiqual-backend/src/services/mezclaService.js
 * and granulometriaEvalService.js for real-time recalculation.
 */

/* ════════════════════════════════════════════════════════
   Constants
   ════════════════════════════════════════════════════════ */

const EQUIVALENT_SIEVES = [
  [53, 50],
  [26.5, 25],
  [13.2, 12.5],
];

const EQUIV_MAP = new Map();
for (const [a, b] of EQUIVALENT_SIEVES) {
  EQUIV_MAP.set(a, b);
  EQUIV_MAP.set(b, a);
}

const MF_ABERTURAS = [75, 37.5, 19, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15];

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* ════════════════════════════════════════════════════════
   Interpolation & deduction
   ════════════════════════════════════════════════════════ */

function interpolarLogLineal(medidosSorted, d) {
  if (!medidosSorted.length || d <= 0) return null;
  const logD = Math.log10(d);

  for (const m of medidosSorted) {
    if (Math.abs(m.aberturaMm - d) / Math.max(d, 0.001) < 0.001) {
      return m.pasaPct;
    }
  }

  const asc = [...medidosSorted].reverse();
  if (d < asc[0].aberturaMm || d > asc[asc.length - 1].aberturaMm) return null;

  for (let i = 0; i < asc.length - 1; i++) {
    const lo = asc[i];
    const hi = asc[i + 1];
    if (d >= lo.aberturaMm && d <= hi.aberturaMm) {
      if (lo.aberturaMm === hi.aberturaMm) return lo.pasaPct;
      const logLo = Math.log10(lo.aberturaMm);
      const logHi = Math.log10(hi.aberturaMm);
      const t = (logD - logLo) / (logHi - logLo);
      const interp = lo.pasaPct + t * (hi.pasaPct - lo.pasaPct);
      return round2(Math.max(0, Math.min(100, interp)));
    }
  }
  return null;
}

function deducirPorSaturacion(medidosSorted, targetAberturaMm) {
  if (!medidosSorted.length || targetAberturaMm <= 0) return null;

  let minWith100 = null;
  for (const m of medidosSorted) {
    if (m.pasaPct >= 99.999) {
      if (!minWith100 || m.aberturaMm < minWith100.aberturaMm) minWith100 = m;
    }
  }
  if (minWith100 && targetAberturaMm > minWith100.aberturaMm) {
    return { pasaPct: 100 };
  }

  let maxWith0 = null;
  for (const m of medidosSorted) {
    if (m.pasaPct <= 0.001) {
      if (!maxWith0 || m.aberturaMm > maxWith0.aberturaMm) maxWith0 = m;
    }
  }
  if (maxWith0 && targetAberturaMm < maxWith0.aberturaMm) {
    return { pasaPct: 0 };
  }

  return null;
}

/** Resolve a single point on a curve — exact → interp → deduction. */
function resolvePasaPct(medidosSorted, d) {
  if (!medidosSorted.length || d <= 0) return null;
  for (const m of medidosSorted) {
    if (Math.abs(m.aberturaMm - d) / Math.max(d, 0.001) < 0.001) {
      return m.pasaPct;
    }
  }
  const interp = interpolarLogLineal(medidosSorted, d);
  if (interp !== null) return interp;

  // Logical completion
  for (const m of medidosSorted) {
    if (m.aberturaMm > d && m.pasaPct <= 0.001) return 0;
  }
  for (const m of medidosSorted) {
    if (m.aberturaMm < d && m.pasaPct >= 99.999) return 100;
  }
  const smallest = medidosSorted[medidosSorted.length - 1];
  if (d < smallest.aberturaMm && smallest.pasaPct <= 0.001) return 0;
  const largest = medidosSorted[0];
  if (d > largest.aberturaMm && largest.pasaPct >= 99.999) return 100;

  return null;
}

/* ════════════════════════════════════════════════════════
   Unified grid
   ════════════════════════════════════════════════════════ */

export function buildUnifiedGrid(curves, targetPuntos = []) {
  const allAberturas = new Set();
  for (const curve of curves) {
    for (const p of curve) allAberturas.add(p.aberturaMm);
  }
  for (const p of targetPuntos) allAberturas.add(Number(p.aberturaMm));

  const sorted = [...allAberturas].sort((a, b) => a - b);
  const resolved = [];
  const used = new Set();

  for (const ab of sorted) {
    if (used.has(ab)) continue;
    const equiv = EQUIV_MAP.get(ab);
    if (equiv != null && allAberturas.has(equiv) && !used.has(equiv)) {
      let countAb = 0, countEquiv = 0;
      for (const curve of curves) {
        if (curve.some((p) => Math.abs(p.aberturaMm - ab) < 0.01)) countAb++;
        if (curve.some((p) => Math.abs(p.aberturaMm - equiv) < 0.01)) countEquiv++;
      }
      const inTarget = targetPuntos.some((p) => Math.abs(Number(p.aberturaMm) - ab) < 0.01);
      const equivInTarget = targetPuntos.some((p) => Math.abs(Number(p.aberturaMm) - equiv) < 0.01);

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
   Resolve on grid
   ════════════════════════════════════════════════════════ */

export function resolveOnGrid(puntosSorted, grid) {
  return grid.map((ab) => {
    const exact = puntosSorted.find((p) => Math.abs(p.aberturaMm - ab) < 0.01);
    if (exact) return { aberturaMm: ab, pasaPct: exact.pasaPct, metodo: "REAL" };

    const equiv = EQUIV_MAP.get(ab);
    if (equiv != null) {
      const equivPt = puntosSorted.find((p) => Math.abs(p.aberturaMm - equiv) < 0.01);
      if (equivPt) return { aberturaMm: ab, pasaPct: equivPt.pasaPct, metodo: "EQUIV" };
    }

    const interp = interpolarLogLineal(puntosSorted, ab);
    if (interp !== null) return { aberturaMm: ab, pasaPct: round2(interp), metodo: "INTERPOLADO" };

    const sat = deducirPorSaturacion(puntosSorted, ab);
    if (sat) return { aberturaMm: ab, pasaPct: sat.pasaPct, metodo: "DEDUCIDO" };

    return { aberturaMm: ab, pasaPct: null, metodo: null };
  });
}

/* ════════════════════════════════════════════════════════
   Mix calculation (weighted blend)
   ════════════════════════════════════════════════════════ */

/**
 * @param {Array<{puntos, peso}>} agregados — normalized puntos + weight (0–1, sum=1)
 * @param {number[]} grid — unified sieve grid (ascending)
 */
export function calcularMezcla(agregados, grid) {
  const resolved = agregados.map((a) => ({
    id: a.id,
    nombre: a.nombre || `Agregado ${a.id}`,
    peso: a.peso,
    porcentaje: a.porcentaje ?? round2(a.peso * 100),
    gridPoints: resolveOnGrid(a.puntos, grid),
  }));

  // Extrapolate null values using monotonicity
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
        pts[i] = { ...pts[i], pasaPct: round2((fromSmaller + fromLarger) / 2), metodo: "EXTRAPOLADO" };
      } else if (fromSmaller !== null) {
        pts[i] = { ...pts[i], pasaPct: Math.min(100, fromSmaller), metodo: "EXTRAPOLADO" };
      } else if (fromLarger !== null) {
        pts[i] = { ...pts[i], pasaPct: Math.max(0, fromLarger), metodo: "EXTRAPOLADO" };
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

    return {
      aberturaMm: ab,
      tamiz: `${ab} mm`,
      pasaPct: totalWeight > 0 ? round2(sum) : null,
      metodos,
      completo: totalWeight >= 0.999,
    };
  });

  // Build per-component breakdown for Tabla A.2
  const mixBreakdown = grid.map((ab, idx) => {
    const componentes = resolved.map((agg) => {
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
    return {
      tamiz: `${ab} mm`,
      aberturaMm: ab,
      componentes,
      pasaFinal: curvaMix[idx].pasaPct,
    };
  });

  const mixNorm = curvaMix
    .filter((p) => p.pasaPct !== null)
    .map((p) => ({ aberturaMm: p.aberturaMm, pasaPct: p.pasaPct, tamiz: p.tamiz }))
    .sort((a, b) => b.aberturaMm - a.aberturaMm);

  return { curvaMix, mixBreakdown, tmn: calcularTMN(mixNorm), moduloFinura: calcularMF(mixNorm) };
}

/* ════════════════════════════════════════════════════════
   TMN & Modulo de Finura
   ════════════════════════════════════════════════════════ */

function calcularTMN(descSorted) {
  if (!descSorted?.length) return null;
  let tmnPoint = null;
  for (const pt of descSorted) {
    if (pt.pasaPct >= 95) tmnPoint = pt;
    else break;
  }
  if (!tmnPoint) return null;
  return { valor: tmnPoint.aberturaMm, tamiz: tmnPoint.tamiz || `${tmnPoint.aberturaMm} mm` };
}

function calcularMF(descSorted) {
  if (!descSorted?.length) return null;
  let sumaRetAcum = 0;
  let disponibles = 0;
  const porEquivalencia = [];

  for (const ab of MF_ABERTURAS) {
    let val = resolvePasaPct(descSorted, ab);
    if (val === null) {
      // Fallback to equivalent sieve (53↔50, 26.5↔25, 13.2↔12.5)
      const equiv = EQUIV_MAP.get(ab);
      if (equiv != null) {
        val = resolvePasaPct(descSorted, equiv);
        if (val !== null) porEquivalencia.push({ requerido: ab, usado: equiv });
      }
    }
    if (val === null) continue;
    disponibles++;
    sumaRetAcum += 100 - val;
  }

  if (disponibles < MF_ABERTURAS.length / 2) return null;
  const completo = disponibles === MF_ABERTURAS.length && porEquivalencia.length === 0;
  return { valor: round2(sumaRetAcum / 100), completo, porEquivalencia };
}

/* ════════════════════════════════════════════════════════
   Evaluation: banda (cumple / no cumple)
   ════════════════════════════════════════════════════════ */

/**
 * Evaluate mix curve against a band (limInfPct / limSupPct).
 * @param {Array} curvaMix — [{aberturaMm, pasaPct}]
 * @param {Array} bandaPuntos — [{aberturaMm, limInfPct, limSupPct, isNA}]
 * @returns {{ cumple, fueraDeBanda, series }}
 */
export function evaluarContraBanda(curvaMix, bandaPuntos) {
  if (!curvaMix?.length || !bandaPuntos?.length) return null;

  const mixDesc = curvaMix
    .filter((p) => p.pasaPct !== null)
    .sort((a, b) => b.aberturaMm - a.aberturaMm);

  const fueraDeBanda = [];
  const bandaMin = [];
  const bandaMax = [];

  for (const bp of bandaPuntos) {
    if (bp.isNA) continue;
    const ab = Number(bp.aberturaMm);
    const limInf = bp.limInfPct;
    const limSup = bp.limSupPct;
    if (limInf == null && limSup == null) continue;

    bandaMin.push({ aberturaMm: ab, pasaPct: limInf ?? 0 });
    bandaMax.push({ aberturaMm: ab, pasaPct: limSup ?? 100 });

    // Find mix value at this sieve
    const mixVal = resolvePasaPctOnMix(mixDesc, ab);
    if (mixVal === null) continue;

    if ((limInf != null && mixVal < limInf - 0.01) || (limSup != null && mixVal > limSup + 0.01)) {
      fueraDeBanda.push({
        tamiz: bp.tamiz || `${ab} mm`,
        aberturaMm: ab,
        medido: round2(mixVal),
        min: limInf,
        max: limSup,
        desvio: round2(
          mixVal < (limInf ?? -Infinity)
            ? limInf - mixVal
            : mixVal - (limSup ?? Infinity)
        ),
      });
    }
  }

  // Margin alerts: tamices that are INSIDE the band but close to limits
  const alertasMargen = [];
  for (const bp of bandaPuntos) {
    if (bp.isNA) continue;
    const ab = Number(bp.aberturaMm);
    const limInf = bp.limInfPct;
    const limSup = bp.limSupPct;
    const mixVal = resolvePasaPctOnMix(mixDesc, ab);
    if (mixVal === null) continue;
    // Only alert for sieves that are INSIDE the band
    const isInside = (limInf == null || mixVal >= limInf - 0.01) && (limSup == null || mixVal <= limSup + 0.01);
    if (!isInside) continue;
    if (limInf != null && mixVal - limInf < 3) {
      const margin = round2(mixVal - limInf);
      alertasMargen.push({ tamiz: bp.tamiz || `${ab} mm`, aberturaMm: ab, lado: 'inferior', margin, nivel: margin < 1 ? 'CRITICO' : 'PREVENTIVO' });
    }
    if (limSup != null && limSup - mixVal < 3) {
      const margin = round2(limSup - mixVal);
      alertasMargen.push({ tamiz: bp.tamiz || `${ab} mm`, aberturaMm: ab, lado: 'superior', margin, nivel: margin < 1 ? 'CRITICO' : 'PREVENTIVO' });
    }
  }

  return {
    cumple: fueraDeBanda.length === 0,
    fueraDeBanda,
    alertasMargen,
    series: {
      bandaMin: bandaMin.sort((a, b) => a.aberturaMm - b.aberturaMm),
      bandaMax: bandaMax.sort((a, b) => a.aberturaMm - b.aberturaMm),
    },
  };
}

/** Resolve mix pasaPct at a target sieve — exact → equiv → interpolation → saturation. */
function resolvePasaPctOnMix(mixDesc, targetAb) {
  for (const p of mixDesc) {
    if (Math.abs(p.aberturaMm - targetAb) < 0.01) return p.pasaPct;
  }
  const equiv = EQUIV_MAP.get(targetAb);
  if (equiv != null) {
    for (const p of mixDesc) {
      if (Math.abs(p.aberturaMm - equiv) < 0.01) return p.pasaPct;
    }
  }
  const interp = interpolarLogLineal(mixDesc, targetAb);
  if (interp !== null) return interp;
  // Saturation deduction for out-of-range sieves
  const sat = deducirPorSaturacion(mixDesc, targetAb);
  return sat ? sat.pasaPct : null;
}

/* ════════════════════════════════════════════════════════
   Evaluation: curva teórica (similarity metrics)
   ════════════════════════════════════════════════════════ */

/**
 * Compare mix curve against a theoretical target curve.
 * @param {Array} curvaMix — [{aberturaMm, pasaPct}]
 * @param {Array} refPuntos — [{aberturaMm, pasaPct|targetPct, isNA}]
 * @returns {{ rmse, mae, r2, maxDesvio, series }}
 */
export function evaluarContraTeorica(curvaMix, refPuntos) {
  if (!curvaMix?.length || !refPuntos?.length) return null;

  const mixDesc = curvaMix
    .filter((p) => p.pasaPct !== null)
    .sort((a, b) => b.aberturaMm - a.aberturaMm);

  const pairs = [];
  const curvaRef = [];

  for (const rp of refPuntos) {
    if (rp.isNA) continue;
    const ab = Number(rp.aberturaMm);
    const target = rp.pasaPct ?? rp.targetPct;
    if (target == null) continue;

    curvaRef.push({ aberturaMm: ab, pasaPct: target });

    const mixVal = resolvePasaPctOnMix(mixDesc, ab);
    if (mixVal !== null) {
      pairs.push({ ab, mix: mixVal, ref: target });
    }
  }

  if (pairs.length < 2) return null;

  const n = pairs.length;
  let sumSqErr = 0, sumAbsErr = 0, maxDesvio = 0;
  let sumRef = 0, sumRefSq = 0;

  for (const p of pairs) {
    const err = p.mix - p.ref;
    sumSqErr += err * err;
    sumAbsErr += Math.abs(err);
    if (Math.abs(err) > maxDesvio) maxDesvio = Math.abs(err);
    sumRef += p.ref;
    sumRefSq += p.ref * p.ref;
  }

  const rmse = round2(Math.sqrt(sumSqErr / n));
  const mae = round2(sumAbsErr / n);

  // R²
  const meanRef = sumRef / n;
  const ssTot = pairs.reduce((s, p) => s + (p.ref - meanRef) ** 2, 0);
  const r2 = ssTot > 0 ? round2(1 - sumSqErr / ssTot) : null;

  return {
    rmse,
    mae,
    r2,
    maxDesvio: round2(maxDesvio),
    series: {
      curvaRef: curvaRef.sort((a, b) => a.aberturaMm - b.aberturaMm),
    },
  };
}
