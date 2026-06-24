'use strict';

/**
 * optimizadorGranulometrico.js
 *
 * Cuando el motor detecta problemas granulométricos (Zona IV/V/I o fuera de
 * banda IRAM), calcula y propone combinaciones mejoradas de fracciones
 * disponibles en la planta.
 *
 * Restricciones HARD:
 *   1. Solo fracciones disponibles en tolvas de la planta
 *   2. Máximo = número de tolvas
 *   3. Mínimo = 2 fracciones (1 fina + 1 gruesa)
 *   4. Cada fracción >= 5%
 *   5. Suma = 100%
 *   6. No modifica cemento, agua, a/c ni aditivos
 *
 * Criterios de optimización (prioridad):
 *   1. Zona Shilstone II (Deseable)
 *   2. Curva próxima a Fuller/Talbot
 *   3. WF próximo al centro de la banda Zona II
 */

const { calcularFactorGrosor, calcularFactorTrabajabilidad, calcularSuperficieEspecifica, determinarZonaShilstone, calcularWF } = require('./trabajabilidadEngine');

// IRAM principal sieves
const SERIE_IRAM = [75, 53, 37.5, 26.5, 19, 13.2, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15, 0.075];
const ALT_TO_STD = { 4.8: 4.75, 2.4: 2.36, 1.2: 1.18, 12.5: 13.2, 25: 26.5, 50: 53, 13: 13.2 };
function normAb(ab) { return ALT_TO_STD[ab] ?? ab; }

/**
 * Calculate Fuller/Talbot curve for a given TMN
 * P(d) = (d / D)^n × 100
 */
function fullerCurve(tmnMm, n) {
  const curve = {};
  for (const t of SERIE_IRAM) {
    if (t <= tmnMm) {
      curve[t] = Math.round(Math.pow(t / tmnMm, n) * 1000) / 10;
    } else {
      curve[t] = 100;
    }
  }
  return curve;
}

/**
 * Calculate combined granulometry from components with given proportions
 */
function calcularGranCombinada(componentes, proporciones) {
  const combined = {};
  for (const tamiz of SERIE_IRAM) {
    let pp = 0;
    for (let i = 0; i < componentes.length; i++) {
      const gran = componentes[i].granulometria || {};
      const pasa = gran[tamiz] ?? gran[normAb(tamiz)] ?? (tamiz > (componentes[i].tmn || 100) ? 100 : null);
      if (pasa != null) pp += (pasa * proporciones[i]) / 100;
    }
    combined[tamiz] = Math.round(pp * 10) / 10;
  }
  return combined;
}

/**
 * Calculate MF from combined granulometry
 */
function calcMF(gran) {
  const tamicesMF = [0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 19, 37.5, 75];
  let sum = 0;
  for (const t of tamicesMF) {
    if (gran[t] != null) sum += (100 - gran[t]);
  }
  return Math.round(sum) / 100;
}

/**
 * Calculate TMN from granulometry (smallest sieve with >= 95% passing)
 */
function calcTMN(gran) {
  const sorted = [...SERIE_IRAM].sort((a, b) => a - b);
  let tmn = null;
  for (const t of sorted) {
    if (gran[t] != null && gran[t] >= 95) tmn = t;
  }
  return tmn;
}

/**
 * Build granMap for FdG/WF calculations (key = string abertura)
 */
function buildGranMap(gran) {
  const m = {};
  for (const [k, v] of Object.entries(gran)) {
    if (v != null) m[normAb(Number(k))] = v;
  }
  return m;
}

/**
 * Calculate RMSE between mix curve and target curve
 */
function rmse(mixGran, targetCurve) {
  let sumSq = 0;
  let n = 0;
  for (const t of SERIE_IRAM) {
    const m = mixGran[t];
    const tgt = targetCurve[t];
    if (m != null && tgt != null) {
      sumSq += (m - tgt) ** 2;
      n++;
    }
  }
  return n > 0 ? Math.sqrt(sumSq / n) : Infinity;
}

/**
 * Score a combination: higher = better
 */
function scoreCombination(gran, cementoKg, tmnMm, targetCurve) {
  const granMap = buildGranMap(gran);
  const pas236 = granMap[2.36] ?? gran[2.36];
  const pas95 = granMap[9.5] ?? gran[9.5];

  if (pas236 == null || pas95 == null) return -Infinity;

  const fdg = (100 - pas95) / (100 - pas236) * 100;
  // WF with Cc correction: WF = pas236 + 2.5 * (Cc - 5), Cc = cem/42.6
  const cc = (cementoKg || 300) / 42.6;
  const wf = pas236 + 2.5 * (cc - 5);

  const zona = determinarZonaShilstone(fdg, wf);
  const zonaCode = zona?.zona || '';

  // Shilstone 1990 limits
  const limInf = 0.125 * fdg + 27.25;
  const limSup = 0.125 * fdg + 35.25;
  const centro = (limInf + limSup) / 2;
  const distCentro = Math.abs(wf - centro);

  let score = 0;

  // Objective 1: Zona II (HARD priority)
  if (zonaCode === 'II') score += 200;
  else if (zonaCode === 'III') score += 100;
  else if (zonaCode === 'IV') score -= 50;
  else if (zonaCode === 'V') score -= 100;
  else if (zonaCode === 'I') score -= 150;
  else score -= 30; // transition zones

  // Objective 2: proximity to Fuller
  if (targetCurve) {
    const r = rmse(gran, targetCurve);
    score -= r * 2; // penalize deviation
  }

  // Objective 3: WF close to center of Zone II
  score -= distCentro * 3;

  return { score, fdg, wf, zona: zonaCode, zonaNombre: zona?.nombre, rmseFuller: targetCurve ? rmse(gran, targetCurve) : null };
}

/**
 * Generate proportion grids for n components
 */
function generarGrilla(n, step = 5) {
  const result = [];
  const cur = new Array(n).fill(0);
  function recurse(idx, remaining) {
    if (idx === n - 1) {
      if (remaining >= 5 && remaining <= 80) {
        cur[idx] = remaining;
        result.push([...cur]);
      }
      return;
    }
    for (let v = 5; v <= Math.min(80, remaining - (n - idx - 1) * 5); v += step) {
      cur[idx] = v;
      recurse(idx + 1, remaining - v);
    }
  }
  recurse(0, 100);
  return result;
}

/**
 * Generate all valid combinations of materials (2 to maxN)
 */
function generarCombinaciones(finos, gruesos, maxN) {
  const combos = [];
  // 1F + 1G
  for (const f of finos) for (const g of gruesos) combos.push([f, g]);
  if (maxN >= 3) {
    // 1F + 2G
    for (const f of finos) for (let i = 0; i < gruesos.length; i++) for (let j = i + 1; j < gruesos.length; j++) combos.push([f, gruesos[i], gruesos[j]]);
    // 2F + 1G
    for (let i = 0; i < finos.length; i++) for (let j = i + 1; j < finos.length; j++) for (const g of gruesos) combos.push([finos[i], finos[j], g]);
  }
  if (maxN >= 4) {
    // 2F + 2G
    for (let i = 0; i < finos.length; i++) for (let j = i + 1; j < finos.length; j++) for (let k = 0; k < gruesos.length; k++) for (let l = k + 1; l < gruesos.length; l++) combos.push([finos[i], finos[j], gruesos[k], gruesos[l]]);
    // 1F + 3G
    for (const f of finos) for (let i = 0; i < gruesos.length; i++) for (let j = i + 1; j < gruesos.length; j++) for (let k = j + 1; k < gruesos.length; k++) combos.push([f, gruesos[i], gruesos[j], gruesos[k]]);
  }
  return combos.filter(c => c.length <= maxN);
}

/**
 * Main entry: optimize granulometry
 * @param {Object} params
 * @param {Array} params.materiales - available materials with { id, nombre, tipo, granulometria, tmn }
 * @param {number} params.maxTolvas - max number of fractions (from planta config)
 * @param {number} params.cementoKg - cement content kg/m3
 * @param {number} params.tmnMezcla - current mix TMN
 * @param {string} params.zonaActual - current Shilstone zone code
 * @param {number} params.wfActual - current WF
 * @param {number} params.fdgActual - current FdG
 * @param {number} params.maxResultados - max suggestions (default 2)
 * @returns {Array} suggestions sorted by score
 */
function optimizarGranulometria(params) {
  const { materiales, maxTolvas = 4, cementoKg = 300, tmnMezcla, maxResultados = 2 } = params;

  if (!materiales || materiales.length < 2) return [];

  const finos = materiales.filter(m => (m.tipo || '').toUpperCase() === 'FINO');
  const gruesos = materiales.filter(m => (m.tipo || '').toUpperCase() === 'GRUESO');

  if (finos.length === 0 || gruesos.length === 0) return [];

  // Fuller target curve
  const tmn = tmnMezcla || 19;
  const nFuller = tmn <= 19 ? 0.45 : 0.50;
  const targetCurve = fullerCurve(tmn, nFuller);

  const combinaciones = generarCombinaciones(finos, gruesos, maxTolvas);
  const soluciones = [];

  for (const combo of combinaciones) {
    const grilla = generarGrilla(combo.length, 5);
    let mejorScore = -Infinity;
    let mejorSol = null;

    for (const props of grilla) {
      // Ensure at least one fino has >= 5% and at least one grueso has >= 5%
      const tieneFinoActivo = combo.some((c, i) => (c.tipo || '').toUpperCase() === 'FINO' && props[i] >= 5);
      const tieneGruesoActivo = combo.some((c, i) => (c.tipo || '').toUpperCase() === 'GRUESO' && props[i] >= 5);
      if (!tieneFinoActivo || !tieneGruesoActivo) continue;

      const gran = calcularGranCombinada(combo, props);
      const result = scoreCombination(gran, cementoKg, tmn, targetCurve);

      if (result.score > mejorScore) {
        mejorScore = result.score;
        mejorSol = {
          componentes: combo.map((c, i) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, porcentaje: props[i] })),
          proporciones: props,
          granulometria: gran,
          mf: calcMF(gran),
          tmn: calcTMN(gran),
          ...result,
        };
      }
    }

    if (mejorSol) soluciones.push(mejorSol);
  }

  // Sort by score descending
  soluciones.sort((a, b) => b.score - a.score);

  // Filter diverse: don't suggest two nearly identical combinations
  const diversas = [];
  for (const sol of soluciones) {
    if (diversas.length >= maxResultados) break;
    const isDiverse = diversas.every(d => {
      if (sol.componentes.length !== d.componentes.length) return true;
      const idsA = sol.componentes.map(c => c.id).sort().join(',');
      const idsB = d.componentes.map(c => c.id).sort().join(',');
      if (idsA !== idsB) return true;
      const maxDif = Math.max(...sol.proporciones.map((p, i) => Math.abs(p - d.proporciones[i])));
      return maxDif >= 10;
    });
    if (isDiverse) diversas.push(sol);
  }

  return diversas.map((sol, i) => ({
    ...sol,
    ranking: i + 1,
    etiqueta: i === 0 ? 'Recomendada' : 'Alternativa',
  }));
}

/**
 * Check if optimization should be triggered
 */
function debeOptimizar(zonaActual) {
  const zonasProblematicas = ['I', 'IV', 'V', 'I/V', 'II/V', 'III/V', 'II/IV', 'III/IV'];
  return zonasProblematicas.includes(zonaActual);
}

module.exports = { optimizarGranulometria, debeOptimizar, fullerCurve, calcularGranCombinada, scoreCombination };
