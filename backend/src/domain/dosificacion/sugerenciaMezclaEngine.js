'use strict';

/**
 * sugerenciaMezclaEngine.js
 *
 * Motor de sugerencia de mezclas granulares.
 * Dado un set de materiales con granulometria y parametros de diseno,
 * genera las mejores combinaciones de agregados con proporciones optimizadas.
 */

const { calcularFactorGrosor, calcularFactorTrabajabilidad, calcularSuperficieEspecifica, calcularFactorAptitud, determinarZonaShilstone, obtenerOffsetTMN } = require('./trabajabilidadEngine');
// Auditoría 01-calidad Fase C R2: import desde domain/, no de services/.
const { getShilstoneConfig } = require('./shilstoneConfig');
// Auditoría 02-dosificación D6: SSoT funcional de límites contextuales.
// `aptitudMaterialesEngine` resuelve los umbrales de Tabla 3.4 (AF) / 3.6 (AG)
// + IRAM 1512 según contexto (`expuestoDesgaste`, etc.). Antes este engine
// hardcodeaba 5%/7% para suma nocivas; ahora consume la SSoT.
const { resolverLimitesAF } = require('./aptitudMaterialesEngine');

/**
 * Resuelve el límite ponderado de "Suma sustancias nocivas" del agregado fino
 * desde la SSoT (`aptitudMaterialesEngine.resolverLimitesAF`) según el
 * contexto del hormigón. Devuelve `null` si la SSoT no expone el límite.
 *
 * @param {{expuestoDesgaste?: boolean}} ctx
 * @returns {{ limite: number, condicion: string, normaRef: string } | null}
 */
function obtenerLimiteSumaNocivasAF(ctx = {}) {
  const limites = resolverLimitesAF({ expuestoDesgaste: !!ctx.expuestoDesgaste });
  const fila = limites.find(l => l.ensayoCodigo === '_SUMA_NOCIVAS_AF');
  if (!fila || fila.limite == null) return null;
  return {
    limite: Number(fila.limite),
    condicion: fila.condicion || null,
    normaRef: fila.normaRef || 'IRAM 1512 §5.2.2',
  };
}

// Map alternative sieve aberturas to IRAM
const ALT_TO_STD = { 4.8: 4.75, 2.4: 2.36, 1.2: 1.18, 12.5: 13.2, 25: 26.5, 50: 53, 13: 13.2 };
function normAb(ab) { return ALT_TO_STD[ab] ?? ab; }

// IRAM principal sieves
const SERIE_IRAM = [75, 53, 37.5, 26.5, 19, 13.2, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15, 0.075];

/**
 * Evalúa la aptitud de la mezcla combinada a partir de los aptitudSummary de
 * los componentes y las proporciones. Produce un indicador [0..1] que alimenta
 * el score y un objeto de cumplimiento para trazabilidad.
 *
 * PR9.4 — POLÍTICA DE MODO: este engine opera en modo PRESCRIPTIVO INTERNO.
 * La sugerencia automática filtra mezclas que normativamente fallarían (suma
 * de sustancias nocivas IRAM 1512, pasa #200 Tabla 3.4/3.6) sin consultar el
 * catálogo del tenant, porque el operario debe tener la mejor sugerencia
 * técnica disponible y luego decidir si la aprueba bajo su responsabilidad.
 * Si la sugerencia se permite degradar a prestacional, podríamos sugerir
 * mezclas que la planta termine declarando "no obligatorias" pero que
 * normativamente fallan — esto es indeseable para una sugerencia automática.
 *
 * El operario puede SIEMPRE override manual (decisión 3 confirmada por user).
 *
 * Para el agregado fino se pondera la suma de sustancias nocivas contra el
 * límite IRAM 1512 (5% con desgaste / 7% sin desgaste). Para el grueso se
 * verifica pasa #200 ponderado contra el límite de la fracción.
 *
 * @param {Array} componentes - array de { aptitudSummary?, tipo }
 * @param {Array} proporciones - porcentajes (0..100) por componente
 * @param {object} ctx - { expuestoDesgaste } (de parametros._aptitudCtx)
 * @returns {{ indicador, estado, detalles }}
 */
function evaluarAptitudMezcla(componentes, proporciones, ctx = {}) {
  const detalles = [];
  const problemas = [];
  let anyData = false;

  // Suma ponderada de nocivas para fracciones finas
  let sumaNocivasPond = null;
  const finosConDato = [];
  let pctFinosConDato = 0;
  for (let i = 0; i < componentes.length; i++) {
    const c = componentes[i];
    if ((c.tipo || '').toUpperCase() !== 'FINO') continue;
    const s = c.aptitudSummary;
    if (s?.sumaNocivasPct != null) {
      finosConDato.push({ i, val: s.sumaNocivasPct });
      pctFinosConDato += proporciones[i];
    }
  }
  // Resolución del límite vía SSoT (aptitudMaterialesEngine). Fallback IRAM 1512
  // si la SSoT no responde (defensivo, no debería ocurrir).
  const limiteNocivasInfo = obtenerLimiteSumaNocivasAF(ctx) || {
    limite: ctx.expuestoDesgaste ? 5.0 : 7.0,
    condicion: ctx.expuestoDesgaste ? 'Con desgaste (<= 5,0%)' : 'Sin desgaste (<= 7,0%)',
    normaRef: 'IRAM 1512 §5.2.2',
  };

  if (finosConDato.length > 0 && pctFinosConDato > 0) {
    anyData = true;
    // Promedio ponderado de las fracciones finas que tienen dato, respecto al total de finos
    let acum = 0;
    for (const { i, val } of finosConDato) {
      acum += (val * proporciones[i]) / pctFinosConDato;
    }
    sumaNocivasPond = Math.round(acum * 100) / 100;

    detalles.push({
      parametro: 'Suma de sustancias nocivas (AF, ponderada)',
      valor: sumaNocivasPond,
      limite: limiteNocivasInfo.limite,
      unidad: '%',
      contexto: ctx.expuestoDesgaste ? 'con desgaste superficial' : 'sin desgaste superficial',
      normaRef: limiteNocivasInfo.normaRef,
      cumple: sumaNocivasPond <= limiteNocivasInfo.limite,
    });
    if (sumaNocivasPond > limiteNocivasInfo.limite) {
      problemas.push(`Suma nocivas AF ponderada ${sumaNocivasPond}% supera el límite ${limiteNocivasInfo.normaRef} de ${limiteNocivasInfo.limite}% (${ctx.expuestoDesgaste ? 'con' : 'sin'} desgaste).`);
    }
  }

  // Pasa #200 ponderado — por fracción (AF y AG tienen límites diferentes)
  let problemasPasa200AF = null;
  let problemasPasa200AG = null;
  for (const tipo of ['FINO', 'GRUESO']) {
    let pondVal = 0;
    let pondTotal = 0;
    let limite = null;
    for (let i = 0; i < componentes.length; i++) {
      const c = componentes[i];
      if ((c.tipo || '').toUpperCase() !== tipo) continue;
      const s = c.aptitudSummary;
      if (s?.pasa200Pct != null && s.limites?.pasa200 != null) {
        pondVal += s.pasa200Pct * proporciones[i];
        pondTotal += proporciones[i];
        if (limite == null || s.limites.pasa200 < limite) limite = s.limites.pasa200;
      }
    }
    if (pondTotal > 0 && limite != null) {
      anyData = true;
      const valor = Math.round((pondVal / pondTotal) * 100) / 100;
      const cumple = valor <= limite;
      detalles.push({
        parametro: `Pasa #200 (${tipo === 'FINO' ? 'AF' : 'AG'}, ponderado)`,
        valor, limite, unidad: '%', cumple,
      });
      if (!cumple) {
        const msg = `Pasa #200 ${tipo === 'FINO' ? 'AF' : 'AG'} ponderado ${valor}% supera el límite de ${limite}%.`;
        problemas.push(msg);
        if (tipo === 'FINO') problemasPasa200AF = msg; else problemasPasa200AG = msg;
      }
    }
  }

  // Estado consolidado
  let estado, indicador;
  if (!anyData) {
    estado = 'sin_dato';
    indicador = 0.7;  // conservador — sin datos no es culpa de la mezcla
  } else if (problemas.length === 0) {
    estado = 'cumple';
    indicador = 1.0;
  } else if (sumaNocivasPond != null) {
    // Mismo límite resuelto arriba desde la SSoT.
    if (sumaNocivasPond > limiteNocivasInfo.limite * 1.1) { estado = 'no_cumple'; indicador = 0.0; }
    else if (sumaNocivasPond > limiteNocivasInfo.limite) { estado = 'no_cumple'; indicador = 0.2; }
    else { estado = 'cumple_con_atencion'; indicador = 0.6; }
  } else {
    estado = 'no_cumple';
    indicador = 0.3;
  }

  return {
    indicador,
    estado,
    sumaNocivasPond,
    detalles,
    problemas,
    contexto: { expuestoDesgaste: !!ctx.expuestoDesgaste },
  };
}

/**
 * Calculate combined granulometry from components with given proportions
 */
function calcularGranulometriaCombinada(componentes, proporciones) {
  const combined = {};
  // Pre-compute max tamiz with data for each component (for extrapolation)
  const maxTamizConDato = componentes.map(c => {
    const g = c.granulometria || {};
    let maxT = 0;
    for (const [k, v] of Object.entries(g)) {
      if (v != null && Number(k) > maxT) maxT = Number(k);
    }
    return maxT;
  });

  for (const tamiz of SERIE_IRAM) {
    let pasaPonderado = 0;
    for (let i = 0; i < componentes.length; i++) {
      const gran = componentes[i].granulometria || {};
      let pasa = gran[tamiz] ?? gran[normAb(tamiz)];
      // If component has no data for this sieve but its max sieve with data
      // has pasa >= 95%, extrapolate to 100% for larger sieves
      if (pasa == null && tamiz > maxTamizConDato[i] && maxTamizConDato[i] > 0) {
        const maxVal = gran[maxTamizConDato[i]];
        if (maxVal != null && maxVal >= 95) pasa = 100;
      }
      if (pasa != null) {
        pasaPonderado += (pasa * proporciones[i]) / 100;
      }
    }
    combined[tamiz] = Math.round(pasaPonderado * 10) / 10;
  }
  return combined;
}

/**
 * Calculate MF from combined granulometry
 */
function calcularMF(granulometria) {
  const tamicesMF = [0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 19, 37.5, 75];
  let sumaRetenido = 0;
  for (const tamiz of tamicesMF) {
    const pasa = granulometria[tamiz];
    if (pasa != null) sumaRetenido += (100 - pasa);
  }
  return Math.round(sumaRetenido) / 100;
}

/**
 * Calculate TMN from combined granulometry.
 * TMN = menor tamiz donde pasa >= 95%.
 * Ignora tamices con 100% si todos los superiores también son 100% (son irrelevantes).
 */
function calcularTMN(granulometria) {
  const tamicesAsc = [...SERIE_IRAM].sort((a, b) => a - b);
  let tmn = null;
  let encontroMenorQue100 = false;

  for (const tamiz of tamicesAsc) {
    const pasa = granulometria[tamiz];
    if (pasa == null) continue;
    if (pasa < 100) encontroMenorQue100 = true;
    if (pasa >= 95) {
      tmn = tamiz;
      // Si ya encontramos un tamiz < 100% antes, este es el TMN real
      if (encontroMenorQue100) break;
    }
  }
  return tmn;
}

/**
 * Calculate TMN from component TMNs (max TMN of gruesos)
 */
/**
 * Simplified ICPA tables for cement estimation (used in suggestions, not in final dosification).
 *
 * Ábaco 1 (agua base): MF × Asentamiento → L/m³ for canto rodado.
 * Triturado adds ~10 L/m³ over canto rodado.
 * TMN correction applied separately (ICPA tabla).
 *
 * Ábaco 2 (a/c): f'cm → a/c for CP40 canto rodado (ICPA genérica).
 */
const AGUA_ICPA_CANTO_RODADO = {
  // MF → { asentamiento(cm) → agua (L/m³) } — valores Ábaco 1 ICPA para TMN 19mm
  3.0: { 6: 170, 8: 176, 10: 182, 12: 188, 14: 194, 16: 200, 18: 206 },
  3.5: { 6: 172, 8: 178, 10: 184, 12: 190, 14: 196, 16: 202, 18: 208 },
  4.0: { 6: 176, 8: 182, 10: 188, 12: 194, 14: 200, 16: 206, 18: 212 },
  4.5: { 6: 180, 8: 186, 10: 192, 12: 198, 14: 204, 16: 210, 18: 216 },
  5.0: { 6: 184, 8: 190, 10: 196, 12: 202, 14: 208, 16: 214, 18: 220 },
  5.5: { 6: 188, 8: 194, 10: 200, 12: 206, 14: 212, 16: 218, 18: 224 },
  6.0: { 6: 192, 8: 198, 10: 204, 12: 210, 14: 216, 16: 222, 18: 228 },
};
// TMN correction over TMN 19mm reference (ICPA)
const TMN_CORR_AGUA = { 9.5: +15, 13.2: +8, 19: 0, 26.5: -8, 37.5: -15, 53: -20, 75: -25 };

// a/c vs f'cm for CP40 canto rodado (ICPA Ábaco 2 — valores reales de la curva genérica)
const AC_ICPA = [
  { fcm: 20, ac: 0.72 }, { fcm: 25, ac: 0.65 }, { fcm: 30, ac: 0.58 },
  { fcm: 35, ac: 0.52 }, { fcm: 40, ac: 0.47 }, { fcm: 45, ac: 0.43 },
  { fcm: 50, ac: 0.39 }, { fcm: 55, ac: 0.36 }, { fcm: 60, ac: 0.34 },
];

/**
 * Estimate water from real ICPA Ábaco 1 curves (AbacoCurvaICPA table from DB).
 * Replicates the bilinear interpolation of hormiqualCalcEngine.estimarAguaBaseReferencia exactly.
 * Columns: asentamientoCm, moduloFinura, formaAgregado, aguaBaseLM3.
 * No TMN correction (as per ICPA methodology — TMN is already implicit in MF).
 */
/**
 * Calculate FdA target range from the user's slump objective.
 * Maps asentamiento (mm) to the corresponding FdA range from RANGOS_FDA_BASE + TMN offset.
 * Returns a tight range that the optimizer should aim for.
 */
function calcularRangoFdAObjetivo(asentMm, tmnOffset) {
  // FdA ↔ asentamiento mapping (from RANGOS_FDA_BASE, base TMN 19)
  const MAP = [
    { conoMin: 0,   conoMax: 0,   fdaMin: 16, fdaMax: 20 },
    { conoMin: 0,   conoMax: 80,  fdaMin: 20, fdaMax: 22 },
    { conoMin: 80,  conoMax: 120, fdaMin: 22, fdaMax: 24 },
    { conoMin: 120, conoMax: 150, fdaMin: 24, fdaMax: 26 },
    { conoMin: 140, conoMax: 180, fdaMin: 26, fdaMax: 28 },
    { conoMin: 180, conoMax: 220, fdaMin: 28, fdaMax: 31 },
  ];

  // Find the range that contains the target slump
  let bestMatch = MAP.find(m => asentMm >= m.conoMin && asentMm <= m.conoMax);
  if (!bestMatch) {
    // Interpolate: find the closest ranges
    if (asentMm < 0) bestMatch = MAP[0];
    else if (asentMm > 220) bestMatch = MAP[MAP.length - 1];
    else {
      // Between ranges (e.g., 115mm is between 80-120 and 120-150)
      for (let i = 0; i < MAP.length - 1; i++) {
        if (asentMm >= MAP[i].conoMin && asentMm <= MAP[i + 1].conoMax) {
          bestMatch = MAP[i]; break;
        }
      }
      if (!bestMatch) bestMatch = MAP[2]; // default structural
    }
  }

  return {
    fdaTargetMin: bestMatch.fdaMin + tmnOffset,
    fdaTargetMax: bestMatch.fdaMax + tmnOffset,
  };
}

function estimarAguaDesdeDB(curvas, mf, asentCm, forma) {
  if (!curvas?.length || !mf || !asentCm) return null;
  const formaKey = forma || 'CANTO_RODADO';
  const filtered = curvas.filter(c => c.formaAgregado === formaKey);
  if (filtered.length === 0) return null;

  const allMFs = [...new Set(filtered.map(c => Number(c.moduloFinura)))].sort((a, b) => a - b);
  let mfLo = null, mfHi = null;
  for (const m of allMFs) {
    if (m <= mf + 1e-9) mfLo = m;
    if (m >= mf - 1e-9 && mfHi === null) mfHi = m;
  }
  if (mfLo === null) mfLo = allMFs[0];
  if (mfHi === null) mfHi = allMFs[allMFs.length - 1];

  const asLo = Math.floor(asentCm), asHi = Math.ceil(asentCm);
  const get = (as, mfV) => {
    const row = filtered.find(c => Number(c.asentamientoCm) === as && Math.abs(Number(c.moduloFinura) - mfV) < 0.01);
    return row ? Number(row.aguaBaseLM3) : null;
  };

  const lerp = (x, x0, y0, x1, y1) => x0 === x1 ? y0 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  const wLL = get(asLo, mfLo), wLH = get(asLo, mfHi);
  const wHL = get(asHi, mfLo), wHH = get(asHi, mfHi);
  if (wLL == null || wLH == null || wHL == null || wHH == null) return null;

  const wAtLo = lerp(mf, mfLo, wLL, mfHi, wLH);
  const wAtHi = lerp(mf, mfLo, wHL, mfHi, wHH);
  return Math.round(lerp(asentCm, asLo, wAtLo, asHi, wAtHi) * 10) / 10;
}

/**
 * Estimate a/c from real ICPA Ábaco 2 curves (CurvaACResistencia table from DB).
 * Replicates hormiqualCalcEngine corrections:
 *   - Triturado: fcm / 1.20 (piedra partida gives +20% strength)
 *   - Mixto: fcm / 1.10
 *   - Air: fcm / (1 - 0.05*(air%-1)) per ICPA
 * Columns: edadDias, resistenciaMpa, relacionAC, tipoCemento, formaAgregado.
 */
function estimarACDesdeDB(curvas, fce, desvioS, forma, airePct) {
  if (!curvas?.length || !fce) return null;
  const S = desvioS || 4;
  // f'cm = f'ce + 1.65·S (CIRSOC 200:2024 §5.6.3 — percentil 5 (z₀.₉₅ ≈ 1.645)).
  // Alineado con hormiqualCalcEngine; cualquier sugerencia se debe poder validar
  // con el motor oficial sin caer del lado débil.
  const fcm = fce + 1.65 * S;
  const edadDias = 28;

  // Apply ICPA corrections (same as hormiqualCalcEngine lines 970-987)
  let fcmCorregido = fcm;
  if (forma === 'TRITURADO' || forma === 'PIEDRA_PARTIDA') fcmCorregido = fcmCorregido / 1.20;
  else if (forma === 'MIXTO') fcmCorregido = fcmCorregido / 1.10;
  const aireInc = Number(airePct) || 0;
  if (aireInc > 1) {
    const factorAire = 1 - 0.05 * (aireInc - 1);
    if (factorAire > 0) fcmCorregido = fcmCorregido / factorAire;
  }

  // Filter for the right age
  const filtered = curvas.filter(c => Number(c.edadDias) === edadDias);
  if (filtered.length === 0) return null;

  // Sort by resistance ascending
  const sorted = [...filtered].sort((a, b) => Number(a.resistenciaMpa) - Number(b.resistenciaMpa));

  // Find bounding rows and interpolate
  for (let i = 0; i < sorted.length - 1; i++) {
    const rLo = Number(sorted[i].resistenciaMpa);
    const rHi = Number(sorted[i + 1].resistenciaMpa);
    if (fcmCorregido >= rLo && fcmCorregido <= rHi) {
      const acLo = Number(sorted[i].relacionAC);
      const acHi = Number(sorted[i + 1].relacionAC);
      return acLo + (acHi - acLo) * (fcmCorregido - rLo) / (rHi - rLo);
    }
  }

  // Extrapolation: use closest
  if (fcmCorregido < Number(sorted[0].resistenciaMpa)) return Number(sorted[0].relacionAC);
  return Number(sorted[sorted.length - 1].relacionAC);
}

function estimarCementoICPA(mf, tmn, asentCm, fce, forma, desvioS) {
  // 1. Estimate water from simplified Ábaco 1 (fallback when DB not available)
  // NOTE: No TMN correction — consistent with ICPA methodology (TMN implicit in MF)
  const mfKeys = Object.keys(AGUA_ICPA_CANTO_RODADO).map(Number).sort((a, b) => a - b);
  const mfClamp = Math.max(mfKeys[0], Math.min(mfKeys[mfKeys.length - 1], mf));

  let mfLo = mfKeys[0], mfHi = mfKeys[mfKeys.length - 1];
  for (let i = 0; i < mfKeys.length - 1; i++) {
    if (mfClamp >= mfKeys[i] && mfClamp <= mfKeys[i + 1]) { mfLo = mfKeys[i]; mfHi = mfKeys[i + 1]; break; }
  }

  const asKeys = [6, 8, 10, 12, 14, 16, 18];
  let asLo = 6, asHi = 18;
  for (let i = 0; i < asKeys.length - 1; i++) {
    if (asentCm >= asKeys[i] && asentCm <= asKeys[i + 1]) { asLo = asKeys[i]; asHi = asKeys[i + 1]; break; }
  }

  const lerp = (x, x0, y0, x1, y1) => x0 === x1 ? y0 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);

  const tLo = AGUA_ICPA_CANTO_RODADO[mfLo] || {};
  const tHi = AGUA_ICPA_CANTO_RODADO[mfHi] || {};
  const wLoLo = tLo[asLo] || 190, wLoHi = tLo[asHi] || 200;
  const wHiLo = tHi[asLo] || 195, wHiHi = tHi[asHi] || 205;

  const wAtLo = lerp(asentCm, asLo, wLoLo, asHi, wLoHi);
  const wAtHi = lerp(asentCm, asLo, wHiLo, asHi, wHiHi);
  let agua = lerp(mfClamp, mfLo, wAtLo, mfHi, wAtHi);

  // Triturado correction (+10% over canto rodado, consistent with ICPA)
  if (forma === 'TRITURADO' || forma === 'PIEDRA_PARTIDA') agua *= 1.10;
  else if (forma === 'MIXTO') agua *= 1.05;

  agua = Math.max(150, Math.min(235, agua));

  // 2. Estimate a/c from f'cm (Ábaco 2 ICPA CP40, same corrections as hormiqualCalcEngine)
  // f'cm = f'ce + 1.65·S (CIRSOC 200:2024 §5.6.3 — percentil 5 (z₀.₉₅ ≈ 1.645)).
  const S = desvioS || 4.0;
  let fcmParaCurva = fce + 1.65 * S;
  // ICPA corrections: curves are for canto rodado, correct fcm for other forms
  if (forma === 'TRITURADO' || forma === 'PIEDRA_PARTIDA') fcmParaCurva /= 1.20;
  else if (forma === 'MIXTO') fcmParaCurva /= 1.10;

  let ac = 0.50; // default
  for (let i = 0; i < AC_ICPA.length - 1; i++) {
    if (fcmParaCurva >= AC_ICPA[i].fcm && fcmParaCurva <= AC_ICPA[i + 1].fcm) {
      ac = lerp(fcmParaCurva, AC_ICPA[i].fcm, AC_ICPA[i].ac, AC_ICPA[i + 1].fcm, AC_ICPA[i + 1].ac);
      break;
    }
  }
  if (fcmParaCurva < AC_ICPA[0].fcm) ac = AC_ICPA[0].ac;
  if (fcmParaCurva > AC_ICPA[AC_ICPA.length - 1].fcm) ac = AC_ICPA[AC_ICPA.length - 1].ac;

  ac = Math.max(0.30, Math.min(0.70, ac));

  return Math.round(agua / ac);
}

function calcularTMNDesdeComponentes(componentes) {
  const gruesos = componentes.filter(c => (c.tipo || '').toUpperCase() === 'GRUESO');
  if (gruesos.length === 0) return null;
  return Math.max(...gruesos.map(g => g.tmn || 0));
}

/**
 * Build granMap for trabajabilidad calculations
 */
function buildGranMap(granulometria) {
  const map = {};
  for (const [k, v] of Object.entries(granulometria)) {
    if (v != null) map[normAb(Number(k))] = v;
  }
  return map;
}

/**
 * Generate all feasible combinations of materials
 * At least 1 fino + 1 grueso, max 5 total
 */
function generarCombinaciones(finos, gruesos) {
  const combos = [];

  // HRDC u otros casos sin AG: combinaciones sólo de finos (1F, 2F, 3F).
  if (!gruesos || gruesos.length === 0) {
    for (const f of finos) combos.push([f]);
    for (let i = 0; i < finos.length; i++) {
      for (let j = i + 1; j < finos.length; j++) combos.push([finos[i], finos[j]]);
    }
    for (let i = 0; i < finos.length; i++) {
      for (let j = i + 1; j < finos.length; j++) {
        for (let k = j + 1; k < finos.length; k++) combos.push([finos[i], finos[j], finos[k]]);
      }
    }
    return combos;
  }

  // 1F + 1G
  for (const f of finos) for (const g of gruesos) combos.push([f, g]);

  // 1F + 2G
  for (const f of finos)
    for (let i = 0; i < gruesos.length; i++)
      for (let j = i + 1; j < gruesos.length; j++)
        combos.push([f, gruesos[i], gruesos[j]]);

  // 2F + 1G
  for (let i = 0; i < finos.length; i++)
    for (let j = i + 1; j < finos.length; j++)
      for (const g of gruesos)
        combos.push([finos[i], finos[j], g]);

  // 2F + 2G
  for (let i = 0; i < finos.length; i++)
    for (let j = i + 1; j < finos.length; j++)
      for (let k = 0; k < gruesos.length; k++)
        for (let l = k + 1; l < gruesos.length; l++)
          combos.push([finos[i], finos[j], gruesos[k], gruesos[l]]);

  // 1F + 3G
  for (const f of finos)
    for (let i = 0; i < gruesos.length; i++)
      for (let j = i + 1; j < gruesos.length; j++)
        for (let k = j + 1; k < gruesos.length; k++)
          combos.push([f, gruesos[i], gruesos[j], gruesos[k]]);

  // 2F + 3G
  for (let fi = 0; fi < finos.length; fi++)
    for (let fj = fi + 1; fj < finos.length; fj++)
      for (let gi = 0; gi < gruesos.length; gi++)
        for (let gj = gi + 1; gj < gruesos.length; gj++)
          for (let gk = gj + 1; gk < gruesos.length; gk++)
            combos.push([finos[fi], finos[fj], gruesos[gi], gruesos[gj], gruesos[gk]]);

  return combos;
}

/**
 * Generate proportion grids for n components
 * Step = 5%, each component 5-80%, sum = 100%
 */
/**
 * Generate proportion grid for n components.
 * @param {number} n — number of components
 * @param {number} step — step size (default 5%)
 * @param {Array} [bounds] — optional per-component [{min, max}], default {min:5, max:80}
 */
function generarGrillaProporciones(n, step = 5, bounds = null) {
  const result = [];
  const current = new Array(n).fill(0);
  const lo = bounds ? bounds.map(b => b.min ?? 5) : new Array(n).fill(5);
  const hi = bounds ? bounds.map(b => b.max ?? 80) : new Array(n).fill(80);

  function recurse(idx, remaining) {
    if (idx === n - 1) {
      if (remaining >= lo[idx] && remaining <= hi[idx]) {
        current[idx] = remaining;
        result.push([...current]);
      }
      return;
    }
    const minRemaining = lo.slice(idx + 1).reduce((s, v) => s + v, 0);
    for (let v = lo[idx]; v <= Math.min(hi[idx], remaining - minRemaining); v += step) {
      current[idx] = v;
      recurse(idx + 1, remaining - v);
    }
  }

  recurse(0, 100);
  return result;
}

/**
 * Calculate score for a solution.
 * Score components (approximate scale):
 *   Cement:   0..+200  (lower cement → higher score)
 *   Zone:     -150..+60  (Shilstone zone quality)
 *   FdA:      -40..+40  (within target range)
 *   Band:     -50..+30  (IRAM 1627 compliance)
 *   Finos:    -20..+10  (proportion balance)
 */
/**
 * Score a mix solution using balanced multi-criteria approach.
 *
 * Philosophy: Zone II (workability) and band compliance are BOTH important.
 * A mix in Zone II with small band deviations is better than a mix in Zone IV
 * perfectly inside the band. The scoring quantifies deviations continuously
 * rather than using binary tiers.
 *
 * Weight distribution (~1000 total for a perfect mix):
 *   Zona Shilstone:  up to 300 pts (primary workability criterion)
 *   Banda IRAM 1627: up to 250 pts (granulometric compliance, continuous)
 *   FdA coherence:   up to 150 pts (slump consistency)
 *   Cement economy:  up to 150 pts
 *   FdG in range:    up to  50 pts
 *   Fino proportion: up to  50 pts
 *   Tipología rules: up to  50 pts (penalties)
 */
function calcularScore(indicadores, parametros) {
  const { cemento, zona, fda, fdaMin, fdaMax, fdg, fdt, se, proporcionFinos,
    bandaTier, bandaABFuera, bandaACFuera, bandaABDesvMax, bandaACDesvMax, tmn } = indicadores;
  const shilstone = getShilstoneConfig(parametros.tipologia);
  const esTMNBajo = (tmn || 0) <= 13.2;
  let score = 0;

  // ── 0. TMN OBJETIVO (0–300 pts) ──
  // When the user explicitly selects a TMN, mixes matching it get a strong bonus.
  // When no TMN is specified, a moderate bonus for larger TMN encourages using
  // coarser mixes (less water demand, less paste, better economy) up to the max.
  const tmnObj = parametros.tmnObjetivo ? Number(parametros.tmnObjetivo) : null;
  const tmnMaxEff = parametros._tmnMax || 53;
  if (tmnObj && tmn) {
    if (tmn === tmnObj) {
      score += 300; // exact match
    } else if (tmn > tmnObj * 0.7 && tmn < tmnObj) {
      // Close but below: proportional bonus (e.g., 26.5 when asking 37.5 → ~70% match)
      score += Math.round(300 * (tmn / tmnObj) * 0.5);
    } else if (tmn <= tmnObj * 0.7) {
      // Far below: penalty (e.g., 19 when asking 37.5 → only 51%)
      score -= Math.round(150 * (1 - tmn / tmnObj));
    }
  } else if (!tmnObj && tmn) {
    // No explicit TMN objective: moderate bonus for larger TMN (up to tmnMax).
    // Larger TMN = less water demand, less paste volume, better aggregate utilization.
    // Scale: 19mm → ~50 pts, 26.5mm → ~100 pts, 37.5mm → ~140 pts (relative to tmnMax)
    const tmnRatio = Math.min(tmn / tmnMaxEff, 1.0);
    score += Math.round(150 * tmnRatio);
  }

  // ── 1. ZONA SHILSTONE (0–300 pts) — primary workability criterion ──
  const z = zona?.zona || '';
  if (shilstone.zonaObjetivo) {
    const zonasOk = esTMNBajo ? (shilstone.zonaAceptableTMNBajo || shilstone.zonaObjetivo) : shilstone.zonaObjetivo;
    const isTarget = shilstone.zonaObjetivo.includes(z);
    const isAcceptable = zonasOk.includes(z);
    const peso = shilstone.severidad === 'obligatorio' ? 1.0 : shilstone.severidad === 'advertencia' ? 0.5 : 0.15;
    if (isTarget) score += 300 * peso;
    else if (isAcceptable) score += 200 * peso;
    else if (z === 'IV') score -= 100 * peso;   // excess of fines
    else if (z === 'V') score -= 150 * peso;     // excess of coarse
    else if (z === 'I') score -= 200 * peso;     // gap graded
    else score -= 50 * peso;
  }

  // ── 2. BANDA IRAM 1627 (0–250 pts) — continuous, not binary ──
  // Full A-B compliance: 250. Full A-C: 150. Near-miss: proportional.
  // Quantify by average deviation across all sieves, not just count.
  if (bandaTier === 'AB') {
    score += 250;
  } else if (bandaTier === 'AC') {
    // Inside A-C: bonus 150, plus bonus for closeness to A-B
    const abDesvMaxPp = bandaABDesvMax || 10;
    const closeToAB = Math.max(0, 100 - abDesvMaxPp * 10); // max desviation penalty
    score += 150 + closeToAB * 0.5;
  } else if (bandaTier === 'ninguna') {
    // Outside A-C: penalize by magnitude of deviation
    const acDesvMaxPp = bandaACDesvMax || 10;
    const nFuera = bandaACFuera || 1;
    if (nFuera <= 2 && acDesvMaxPp <= 3) {
      // Near-miss: 1-2 sieves with small deviation — still acceptable
      score += 50 - acDesvMaxPp * 15;
    } else {
      score -= Math.min(nFuera * 20 + acDesvMaxPp * 10, 200);
    }
  }
  // sin_banda: score += 0

  // ── 3. FdA coherence with target slump (0–250 pts) — CRITICAL ──
  // FdA must match the user's asentamiento objective. A mix in Zona II but with
  // FdA suggesting 200mm when the user needs 120mm is not useful.
  const fdaTgtLo = indicadores.fdaTargetMin;
  const fdaTgtHi = indicadores.fdaTargetMax;
  if (fda != null && fdaTgtLo != null && fdaTgtHi != null) {
    const fdaMid = (fdaTgtLo + fdaTgtHi) / 2;
    if (fda >= fdaTgtLo && fda <= fdaTgtHi) {
      // Perfect: within target range. Bonus for centering.
      const centerDist = Math.abs(fda - fdaMid);
      const halfRange = (fdaTgtHi - fdaTgtLo) / 2;
      score += 250 - (halfRange > 0 ? (centerDist / halfRange) * 30 : 0);
    } else if (fda >= fdaTgtLo - 2 && fda <= fdaTgtHi + 2) {
      // Near-miss: within ±2 of target range
      const dist = fda < fdaTgtLo ? fdaTgtLo - fda : fda - fdaTgtHi;
      score += 150 - dist * 40;
    } else {
      // Far from target: strong penalty proportional to distance
      const dist = fda < fdaTgtLo ? fdaTgtLo - fda : fda - fdaTgtHi;
      score -= Math.min(dist * 30, 200);
    }
  }

  // ── 4. CEMENT economy (0–150 pts) — lower is better ──
  score += Math.max(0, Math.min(150, (450 - (cemento || 450)) * 0.75));

  // ── 5. FdG in tipología range (0–50 pts) ──
  if (fdg != null && shilstone.fdg) {
    const { min, obj_min, obj_max, max } = shilstone.fdg;
    if (fdg >= obj_min && fdg <= obj_max) score += 50;
    else if (fdg >= min && fdg <= max) score += 20;
    else score -= 30;
  }

  // ── 6. Balanced fino proportion (0–50 pts) ──
  const finoIdealMin = shilstone.restricciones?.relacion_finos_min || 35;
  const finoIdealMax = shilstone.restricciones?.relacion_finos_max || 45;
  if (proporcionFinos >= finoIdealMin && proporcionFinos <= finoIdealMax) score += 50;
  else if (proporcionFinos >= 25 && proporcionFinos <= 55) score += 15;
  else score -= 30;

  // ── 7. Tipología-specific restrictions (penalties) ──
  if (shilstone.restricciones) {
    const r = shilstone.restricciones;
    const gran = indicadores.granulometria || {};
    if (r.pasante_0_30_min && gran[0.3] != null && gran[0.3] < r.pasante_0_30_min) score -= 50;
    if (r.pasante_0_15_min && gran[0.15] != null && gran[0.15] < r.pasante_0_15_min) score -= 30;
  }

  // ── 8. Cost optimization (bonus for lower cost when prices available) ──
  const preciosMap = parametros._preciosMateriales;
  if (preciosMap && indicadores.componentes) {
    // Estimate cost: sum of (proportion × density × price) for each aggregate
    let costoEst = 0;
    let tienePrecios = false;
    for (const comp of (indicadores.componentes || [])) {
      const precio = preciosMap[comp.id];
      if (precio && comp.porcentaje) {
        const densidad = comp.densidadSSS || comp.densidad || 2.65;
        // kg/m³ ≈ proportion × density × 1000 (for 1m³ of aggregate volume)
        costoEst += (comp.porcentaje / 100) * densidad * 1000 * precio / 1000; // $/ton
        tienePrecios = true;
      }
    }
    if (tienePrecios && costoEst > 0) {
      // Lower cost = better. Scale: $0-50k → 0-50 pts bonus
      score += Math.max(0, Math.min(50, (50000 - costoEst) / 1000));
    }
  }

  // ── 9. Continuity check for pavimentos (gaps > 10% between consecutive sieves) ──
  const tip = (parametros.tipologia || '').toLowerCase();
  if ((tip === 'pavimento' || tip === 'pavimento_rigido') && indicadores.granulometria) {
    const gran = indicadores.granulometria;
    const sieves = SERIE_IRAM.filter(s => gran[s] != null).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 0; i < sieves.length - 1; i++) {
      const gap = Math.abs((gran[sieves[i + 1]] || 0) - (gran[sieves[i]] || 0));
      maxGap = Math.max(maxGap, gap);
    }
    if (maxGap > 10) score -= Math.min((maxGap - 10) * 5, 50); // penalize gaps > 10%
  }

  // ── 9b. Aptitud de materiales ponderada (0–150 pts) ──
  // Premia combinaciones cuyos componentes (individualmente y ponderados)
  // cumplen los requisitos IRAM 1512 del destino declarado. Es un factor real
  // pero no dominante: una buena granulometría con aptitud al borde puede
  // seguir siendo preferida a otra con aptitud perfecta pero Zona I o TMN
  // errado. El filtro duro solo actúa en modo NORMATIVO_ESTRICTO.
  if (indicadores.aptitudMezcla) {
    const apt = indicadores.aptitudMezcla;
    // indicador ∈ [0..1]; mapeamos a ±150 pts con cero en 0.7 (sin dato).
    // cumple=1.0 → +150, cumple_con_atencion=0.6 → -30, no_cumple=0.2 → -150, hard no_cumple=0.0 → -200
    const pts = Math.round((apt.indicador - 0.7) * 500);
    score += Math.max(-200, Math.min(150, pts));
  }

  // ── 10. Pliego restrictions (penalties for non-compliance) ──
  if (cemento != null) {
    // a/c máxima de pliego: if estimated a/c > limit, the dosification will need more cement
    const acMaxPliego = parametros.acMaxPliego ? Number(parametros.acMaxPliego) : null;
    if (acMaxPliego && cemento > 0) {
      // Estimate a/c from agua/cemento (rough)
      const aguaEst = indicadores.granulometria ? null : null; // agua not directly available, use cement as proxy
      // If cementoMinPliego forces more cement, penalize mixes that already have high cement
      const cementoMinPliego = parametros.cementoMinPliego ? Number(parametros.cementoMinPliego) : null;
      if (cementoMinPliego && cemento < cementoMinPliego) {
        // This mix will need extra cement from pliego → penalize
        const deficit = cementoMinPliego - cemento;
        score -= Math.min(deficit * 0.5, 50);
      }
    }
  }

  return score;
}

/**
 * Evaluate a single proportion set: compute granulometry, indicators, and score.
 * @returns {{ indicadores, granulometria, score }} or null if constraints violated
 */
function evaluarProporcion(componentes, proporciones, tipoIdx, parametros) {
  const { cementanteEstimado, airePct, tmnObjetivo, fce } = parametros;
  const finosMin = parametros.proporcionFinosMin || 25;
  const finosMax = parametros.proporcionFinosMax || 55;

  const proporcionFinos = proporciones.reduce((sum, p, i) => tipoIdx[i] === 'F' ? sum + p : sum, 0);
  // La banda de proporción de finos (25–55% por defecto) es la regla de
  // proporcionamiento AF/AG: sólo tiene sentido cuando la mezcla TIENE
  // agregado grueso. En mezclas sin grueso (sólo arenas) es estructuralmente
  // inaplicable —caso típico HRDC, hormigón liviano celular fuera de CIRSOC
  // 200, que se dosifica con arena + espumígeno sin AG—. Forzarla rechazaría
  // toda combinación 100% fina ("La combinación no pudo evaluarse").
  // "Tiene grueso" = hay AG con proporción > 0 (no basta con que el AG esté
  // en la lista a 0%: el usuario puede dejar el ripio en 0 para una mezcla
  // sólo de arenas).
  const hayGrueso = tipoIdx.some((t, i) => t === 'G' && Number(proporciones[i]) > 0);
  if (hayGrueso && (proporcionFinos < finosMin || proporcionFinos > finosMax)) return null;

  const granulometria = calcularGranulometriaCombinada(componentes, proporciones);
  const granMap = buildGranMap(granulometria);
  const mf = calcularMF(granulometria);
  // TMN de la mezcla combinada (no del grueso individual más grande)
  const tmn = calcularTMN(granulometria) || calcularTMNDesdeComponentes(componentes);

  // Rechazar si TMN combinado excede el máximo permitido
  const tmnMax = parametros._tmnMax;
  if (tmnMax && tmn && tmn > tmnMax) return null;

  const fdg = calcularFactorGrosor(granMap);
  // FdT needs cement to compute Cc correction — estimate cement first (rough)
  // Then recalculate FdT with Cc for accurate zone placement
  const fdtArido = calcularFactorTrabajabilidad(granMap); // solo esqueleto (sin Cc)
  const seResult = calcularSuperficieEspecifica(granMap);
  const se = seResult.valor;

  // Cement estimation — prefer real ICPA curves from DB, fallback to simplified tables
  const asentCm = (parametros.asentamientoMm || 120) / 10;
  let cemento = cementanteEstimado;
  if (!cemento) {
    const forma = parametros.formaAgregado || 'CANTO_RODADO';
    let aguaEst = estimarAguaDesdeDB(parametros._aguaCurvasICPA, mf, asentCm, forma);
    const acFromDB = estimarACDesdeDB(parametros._acCurvasICPA, fce || 25, parametros.desvioS || 4, forma, airePct);

    // Apply additive water reduction effect (if additive info provided)
    // This corrects the cement estimate to be closer to the real dosification
    const reduccionAguaPct = parametros._reduccionAguaAditivoPct || 0;
    if (aguaEst && reduccionAguaPct > 0) {
      aguaEst = Math.round(aguaEst * (1 - reduccionAguaPct / 100));
    }

    if (aguaEst && acFromDB) {
      cemento = Math.round(aguaEst / acFromDB);
    } else {
      cemento = estimarCementoICPA(mf, tmn || 19, asentCm, fce || 25, forma, parametros.desvioS);
      if (reduccionAguaPct > 0) cemento = Math.round(cemento * (1 - reduccionAguaPct / 200)); // approximate
    }
  }

  // Recalculate FdT with Cc correction (matches dosification engine behavior)
  const fdt = calcularFactorTrabajabilidad(granMap, cemento);
  const zona = determinarZonaShilstone(fdg, fdt);

  const fda = calcularFactorAptitud(se, cemento, airePct || 2);
  const offset = obtenerOffsetTMN(tmn || tmnObjetivo || 19);

  // FdA target range matched to the user's slump objective (not generic 22-28)
  const asentMm = parametros.asentamientoMm || 120;
  const { fdaTargetMin, fdaTargetMax } = calcularRangoFdAObjetivo(asentMm, offset);

  // Band compliance — dual evaluation A-B then A-C (IRAM 1627)
  let bandaABCumple = null, bandaABFuera = 0, bandaABDesvMax = 0;
  let bandaACCumple = null, bandaACFuera = 0, bandaACDesvMax = 0;
  let bandaTier = 'sin_banda'; // 'AB' | 'AC' | 'ninguna' | 'sin_banda'

  // Find the right band for this combination's TMN
  const bandasPorTMN = parametros._bandasPorTMN;
  if (bandasPorTMN && tmn) {
    const tmnKey = String(tmn);
    const closest = Object.keys(bandasPorTMN).map(Number).sort((a, b) => Math.abs(a - tmn) - Math.abs(b - tmn))[0];
    const banda = bandasPorTMN[tmnKey] || (closest && Math.abs(closest - tmn) <= 5 ? bandasPorTMN[String(closest)] : null);

    const evalBanda = (puntos) => {
      if (!puntos?.length) return { cumple: null, fuera: 0, desvMax: 0 };
      let nFuera = 0, maxDesv = 0;
      for (const sp of puntos) {
        const ab = sp.aberturaMm;
        const pasa = granulometria[ab] ?? granulometria[normAb(ab)];
        if (pasa == null) continue;
        let desv = 0;
        if (sp.limInfPct != null && pasa < sp.limInfPct) desv = sp.limInfPct - pasa;
        if (sp.limSupPct != null && pasa > sp.limSupPct) desv = Math.max(desv, pasa - sp.limSupPct);
        if (desv > 0) nFuera++;
        maxDesv = Math.max(maxDesv, desv);
      }
      return { cumple: nFuera === 0, fuera: nFuera, desvMax: Math.round(maxDesv * 10) / 10 };
    };

    if (banda?.bandaAB) {
      const rAB = evalBanda(banda.bandaAB);
      bandaABCumple = rAB.cumple;
      bandaABFuera = rAB.fuera;
      bandaABDesvMax = rAB.desvMax;
    }
    if (banda?.bandaAC) {
      const rAC = evalBanda(banda.bandaAC);
      bandaACCumple = rAC.cumple;
      bandaACFuera = rAC.fuera;
      bandaACDesvMax = rAC.desvMax;
    }

    if (bandaABCumple) bandaTier = 'AB';
    else if (bandaACCumple) bandaTier = 'AC';
    else if (bandaABCumple !== null) bandaTier = 'ninguna';
  }

  // Legacy compat
  const bandaCumple = bandaABCumple || bandaACCumple || null;
  const bandaFuera = bandaABCumple ? 0 : bandaACCumple ? bandaABFuera : Math.min(bandaABFuera, bandaACFuera);

  const fdaMin = fdaTargetMin;
  const fdaMax = fdaTargetMax;

  // Aptitud ponderada de la mezcla combinada (suma nocivas AF, pasa #200, etc.)
  // vs el contexto de destino declarado. Produce indicador [0..1] que alimenta
  // el score; el objeto completo queda en indicadores.aptitudMezcla para
  // exposición en la solución.
  const aptitudCtx = parametros._aptitudCtx || { expuestoDesgaste: !!parametros.expuestoDesgaste };
  const aptitudMezcla = evaluarAptitudMezcla(componentes, proporciones, aptitudCtx);

  // Modo NORMATIVO_ESTRICTO: excluir directamente combinaciones que no cumplen
  // aptitud (cuando hay datos suficientes). En PRESTACIONAL (default) seguimos
  // evaluando y penalizando en score.
  const reportMode = parametros.reportMode === 'NORMATIVO_ESTRICTO' ? 'NORMATIVO_ESTRICTO' : 'PRESTACIONAL';
  if (reportMode === 'NORMATIVO_ESTRICTO' && aptitudMezcla.estado === 'no_cumple') {
    return null;
  }

  const indicadores = { cemento, zona, fda, fdaMin, fdaMax, fdaTargetMin, fdaTargetMax, proporcionFinos, bandaCumple, bandaFuera, bandaTier, bandaABCumple, bandaABFuera, bandaABDesvMax, bandaACCumple, bandaACFuera, bandaACDesvMax, mf, tmn, fdg, fdt, se, granulometria, aptitudMezcla };
  const score = calcularScore(indicadores, parametros);

  // Estimate shrinkage risk (informative)
  // Higher paste content (water + cement) and higher a/c → more shrinkage
  if (cemento > 0) {
    const aguaEst = cemento * 0.50; // rough a/c estimate
    const pastaVolPct = ((cemento / 3.15 + aguaEst) / 1000) * 100; // % of paste volume
    indicadores.riesgoContraccion = pastaVolPct > 32 ? 'alto' : pastaVolPct > 28 ? 'medio' : 'bajo';
    indicadores.volPastaPct = Math.round(pastaVolPct * 10) / 10;
  }

  return { indicadores, granulometria, score, proporciones: [...proporciones] };
}

/**
 * Optimize proportions for a given set of components.
 * Two-pass strategy: 5% grid → 1% refinement around best.
 * Returns topN diverse solutions (default 1 for compat, higher for low-combo scenarios).
 */
function optimizarProporciones(componentes, parametros, topN = 1) {
  const n = componentes.length;
  const tipoIdx = componentes.map(c => c.tipo?.toUpperCase() === 'FINO' ? 'F' : 'G');

  // Build per-component bounds from constraints (if provided)
  const matMin = parametros._materialesMin || {};
  const matMax = parametros._materialesMax || {};
  const bounds = componentes.map(c => ({
    min: matMin[c.id] ?? 5,
    max: matMax[c.id] ?? 80,
  }));

  // Collect ALL valid results for this combination
  const allResults = [];

  // ── Pass 1: Coarse grid — finer step for fewer components ──
  const coarseStep = n <= 2 ? 2 : n <= 3 ? 3 : 5;
  const grilla5 = generarGrillaProporciones(n, coarseStep, bounds);
  for (const proporciones of grilla5) {
    const result = evaluarProporcion(componentes, proporciones, tipoIdx, parametros);
    if (result) allResults.push(result);
  }

  if (allResults.length === 0) return topN > 1 ? [] : null;

  // ── Pass 2: Fine grid (1% step) around top solutions ──
  if (n <= 4) {
    // Refine around top 3 coarse results (not just the best) for more diversity
    allResults.sort((a, b) => b.score - a.score);
    const refineBases = allResults.slice(0, Math.min(3, allResults.length));

    for (const baseResult of refineBases) {
      const base = baseResult.proporciones;
      const refineRange = 4;
      const refineCandidates = [];
      const refCurrent = new Array(n).fill(0);

      function refineRecurse(idx, remaining) {
        if (idx === n - 1) {
          if (remaining >= 5 && remaining <= 80) {
            refCurrent[idx] = remaining;
            refineCandidates.push([...refCurrent]);
          }
          return;
        }
        const lo = Math.max(5, base[idx] - refineRange);
        const hi = Math.min(80, base[idx] + refineRange, remaining - (n - idx - 1) * 5);
        for (let v = lo; v <= hi; v++) {
          refCurrent[idx] = v;
          refineRecurse(idx + 1, remaining - v);
        }
      }
      refineRecurse(0, 100);

      for (const proporciones of refineCandidates) {
        const result = evaluarProporcion(componentes, proporciones, tipoIdx, parametros);
        if (result) allResults.push(result);
      }
    }
  }

  // Sort by score and deduplicate by proportion similarity
  allResults.sort((a, b) => b.score - a.score);

  if (topN <= 1) {
    // Legacy: return single best
    const best = allResults[0];
    return buildSolucion(componentes, best);
  }

  // Return top N diverse solutions
  const selected = [allResults[0]];
  for (const r of allResults.slice(1)) {
    if (selected.length >= topN) break;
    // Require at least 5% fino difference for diversity
    const finoPctR = r.proporciones.reduce((s, p, i) => tipoIdx[i] === 'F' ? s + p : s, 0);
    const isDiverse = selected.every(s => {
      const finoPctS = s.proporciones.reduce((sum, p, i) => tipoIdx[i] === 'F' ? sum + p : sum, 0);
      return Math.abs(finoPctR - finoPctS) >= 5;
    });
    if (isDiverse) selected.push(r);
  }
  return selected.map(r => buildSolucion(componentes, r));
}

function buildSolucion(componentes, result) {
  const ind = result.indicadores;
  return {
    componentes: componentes.map((c, i) => ({ ...c, porcentaje: result.proporciones[i] })),
    proporciones: result.proporciones,
    granulometria: result.granulometria,
    indicadores: {
      mf: ind.mf, tmn: ind.tmn, fdg: ind.fdg, fdt: ind.fdt, se: ind.se, fda: ind.fda,
      zona: ind.zona, cemento: ind.cemento, proporcionFinos: ind.proporcionFinos,
      bandaTier: ind.bandaTier, bandaCumple: ind.bandaCumple,
      bandaABCumple: ind.bandaABCumple, bandaABFuera: ind.bandaABFuera, bandaABDesvMax: ind.bandaABDesvMax,
      bandaACCumple: ind.bandaACCumple, bandaACFuera: ind.bandaACFuera, bandaACDesvMax: ind.bandaACDesvMax,
      fdaTargetMin: ind.fdaTargetMin, fdaTargetMax: ind.fdaTargetMax,
    },
    // Cumplimiento de aptitud de la mezcla combinada (filosofía prestacional):
    // se expone para que el frontend pueda mostrar flags y advertencias.
    cumplimientoAptitud: ind.aptitudMezcla ? {
      estado: ind.aptitudMezcla.estado,
      sumaNocivasPond: ind.aptitudMezcla.sumaNocivasPond,
      detalles: ind.aptitudMezcla.detalles,
      problemas: ind.aptitudMezcla.problemas,
      contexto: ind.aptitudMezcla.contexto,
    } : null,
    score: result.score,
  };
}

/**
 * Filter diverse solutions (avoid near-identical suggestions)
 */
function filtrarSolucionesDiversas(soluciones, n) {
  if (soluciones.length <= n) return soluciones;

  // Group by TMN to ensure diversity
  const porTMN = {};
  for (const sol of soluciones) {
    const tmn = sol.indicadores?.tmn || 0;
    if (!porTMN[tmn]) porTMN[tmn] = [];
    porTMN[tmn].push(sol);
  }
  const tmnKeys = Object.keys(porTMN).map(Number).sort((a, b) => {
    // Sort TMN groups by best score in each group (descending)
    return (porTMN[b][0]?.score || 0) - (porTMN[a][0]?.score || 0);
  });

  const sel = [];

  // Reserve at least 1 slot for the best alternative TMN (if score > 0)
  // This ensures the user sees options with different TMN
  let reservedAltTMN = null;
  if (tmnKeys.length > 1 && n >= 3) {
    const altTMN = tmnKeys[1]; // second-best TMN group
    const altBest = porTMN[altTMN][0];
    if (altBest && altBest.score > 0) {
      reservedAltTMN = altBest;
    }
  }
  const slotsForMain = reservedAltTMN ? n - 1 : n;

  // Fill main slots from best TMN group (diverse by components)
  const mainTMN = tmnKeys[0];
  const mainSols = porTMN[mainTMN] || [];
  sel.push(mainSols[0]); // always include the best

  for (const sol of mainSols.slice(1)) {
    if (sel.length >= slotsForMain) break;
    const esDiversa = sel.every(s => {
      if (sol.componentes.length !== s.componentes.length) return true;
      const idsA = sol.componentes.map(c => c.id).sort().join(',');
      const idsB = s.componentes.map(c => c.id).sort().join(',');
      if (idsA !== idsB) return true;
      const maxDif = Math.max(...sol.proporciones.map((p, i) => Math.abs(p - s.proporciones[i])));
      return maxDif >= 10;
    });
    if (esDiversa) sel.push(sol);
  }

  // Add reserved alternative TMN
  if (reservedAltTMN && !sel.includes(reservedAltTMN)) {
    sel.push(reservedAltTMN);
  }

  // Fill remaining slots from any TMN group
  if (sel.length < n) {
    for (const sol of soluciones) {
      if (sel.length >= n) break;
      if (sel.includes(sol)) continue;
      const esDiversa = sel.every(s => {
        if (sol.componentes.length !== s.componentes.length) return true;
        const idsA = sol.componentes.map(c => c.id).sort().join(',');
        const idsB = s.componentes.map(c => c.id).sort().join(',');
        if (idsA !== idsB) return true;
        const maxDif = Math.max(...sol.proporciones.map((p, i) => Math.abs(p - s.proporciones[i])));
        return maxDif >= 8;
      });
      if (esDiversa) sel.push(sol);
    }
  }

  // Re-sort by score (the alt TMN may have lower score but we want it visible)
  sel.sort((a, b) => b.score - a.score);
  return sel;
}

// ── TMN restrictions by design parameters ──
const TMN_POR_TIPOLOGIA = {
  convencional: 37.5, bombeable: 26.5, estructural: 26.5,
  pavimento: 37.5, proyectado: 12.5, arquitectonico: 19,
  hac: 19, masivo: 75, grout: 9.5, rcc: 75, premoldeado: 19,
  alta_resistencia: 19, liviano: 19, hrdc: 9.5,
};

function obtenerTMNMaximo(parametros) {
  const limites = [];
  // TMN objetivo del usuario (restricción más fuerte si se especifica)
  if (parametros.tmnObjetivo) {
    limites.push({ valor: Number(parametros.tmnObjetivo), fuente: 'TMN objetivo del usuario' });
  }
  const tip = (parametros.tipologia || 'convencional').toLowerCase().replace(/\s/g, '_');
  const tmnTip = TMN_POR_TIPOLOGIA[tip];
  if (tmnTip) limites.push({ valor: tmnTip, fuente: `Tipologia: ${tip}` });
  if (parametros.bombeable) limites.push({ valor: 26.5, fuente: 'Condicion: bombeable' });
  if (parametros.aspectoSuperficial) limites.push({ valor: 19, fuente: 'Condicion: aspecto superficial' });
  limites.push({ valor: 53, fuente: 'Limite absoluto del sistema' }); // nunca > 53
  const min = limites.reduce((m, l) => l.valor < m.valor ? l : m);
  return { tmnMaximo: min.valor, fuente: min.fuente, limites };
}

function restriccionesPorAsentamiento(asentamientoCm) {
  if (asentamientoCm >= 18) return { proporcionFinosMin: 35, proporcionFinosMax: 55 };
  if (asentamientoCm >= 12) return { proporcionFinosMin: 30, proporcionFinosMax: 55 };
  if (asentamientoCm <= 5) return { proporcionFinosMin: 25, proporcionFinosMax: 45 };
  return { proporcionFinosMin: 25, proporcionFinosMax: 55 };
}

/**
 * Main entry point: generate mix suggestions with full restriction pipeline
 */
function generarSugerencias(materiales, parametros, maxResultados = 3) {
  const maxComp = parametros.maxComponentes || 5;
  const asentCm = (parametros.asentamientoMm || 120) / 10;
  const excluidos = [];

  // ── ETAPA 1: Filtrar materiales individuales ──
  const tmnInfo = obtenerTMNMaximo(parametros);
  const tmnMax = tmnInfo.tmnMaximo;

  const materialesFiltrados = materiales.filter(m => {
    // Sin granulometria — aplica a finos y gruesos
    if (!m.granulometria || Object.keys(m.granulometria).length === 0) {
      excluidos.push({ id: m.id, nombre: m.nombre, motivo: 'Sin granulometría cargada' });
      return false;
    }
    // Sin densidad — aplica a finos y gruesos
    if (!m.densidadSSS && !m.densidad) {
      excluidos.push({ id: m.id, nombre: m.nombre, motivo: 'Sin ensayo de densidad' });
      return false;
    }
    // Nota: NO excluir gruesos por TMN individual — el TMN relevante es
    // el de la mezcla combinada, que depende de las proporciones.
    // Una fracción con TMN 37.5 puede participar en una mezcla TMN 26.5.
    return true;
  });

  const finos = materialesFiltrados.filter(m => (m.tipo || '').toUpperCase() === 'FINO');
  const gruesos = materialesFiltrados.filter(m => (m.tipo || '').toUpperCase() === 'GRUESO');

  const esHRDC = String(parametros.tipologia || '').toLowerCase() === 'hrdc';
  if (finos.length === 0) throw new Error('No hay agregados finos con granulometria disponible');
  // Debug logs removed
  // HRDC admite mezcla 100% arena (sin AG). Otras tipologías exigen al menos 1 grueso.
  if (gruesos.length === 0 && !esHRDC) {
    throw new Error(`No hay agregados gruesos con TMN <= ${tmnMax} mm disponibles (${tmnInfo.fuente})`);
  }

  // ── ETAPA 2: Generar y filtrar combinaciones ──
  let combinaciones = generarCombinaciones(finos, gruesos);

  // Filtrar por cantidad de tolvas
  combinaciones = combinaciones.filter(c => c.length <= maxComp);

  // Filtrar por reglas de combinacion
  combinaciones = combinaciones.filter(combo => {
    const gs = combo.filter(c => (c.tipo || '').toUpperCase() === 'GRUESO');
    // No dos gruesos con mismo TMN y mismo origen
    if (gs.length >= 2) {
      for (let i = 0; i < gs.length; i++) {
        for (let j = i + 1; j < gs.length; j++) {
          if (gs[i].tmn === gs[j].tmn && gs[i].origen === gs[j].origen) return false;
        }
      }
    }
    // Heurística: no más de 3 gruesos (demasiado complejo)
    if (gs.length > 3) return false;
    return true;
  });

  // combinaciones filtered
  if (combinaciones.length === 0) throw new Error('No se encontraron combinaciones viables con los materiales y restricciones');

  // Restricciones de proporcion por asentamiento y bombeo
  const restAsent = restriccionesPorAsentamiento(asentCm);
  const restBombeo = parametros.bombeable ? { proporcionFinosMin: Math.max(restAsent.proporcionFinosMin, 35) } : {};
  // HRDC: las restricciones AF/AG no aplican; la mezcla puede ser 100% finos.
  const finosMin = esHRDC ? 0 : (restBombeo.proporcionFinosMin || restAsent.proporcionFinosMin);
  const finosMax = esHRDC ? 100 : restAsent.proporcionFinosMax;

  // Override parametros con restricciones calculadas
  const paramConRestricciones = {
    ...parametros,
    proporcionFinosMin: finosMin,
    proporcionFinosMax: finosMax,
    tmnMaximo: tmnMax,
    _tmnMax: tmnMax,  // Used by evaluarProporcion to reject combinations exceeding TMN
  };

  // ── ETAPA 3: Optimizar y validar ──
  // When few combinations available, request multiple solutions per combo for diversity
  const topNPerCombo = combinaciones.length <= 2 ? maxResultados : combinaciones.length <= 4 ? 2 : 1;
  const soluciones = [];
  for (const combo of combinaciones) {
    try {
      const resultado = optimizarProporciones(combo, paramConRestricciones, topNPerCombo);
      if (!resultado) continue;
      // optimizarProporciones returns array when topN > 1, single object when topN = 1
      const solsFromCombo = Array.isArray(resultado) ? resultado : [resultado];
      for (const solucion of solsFromCombo) {
        if (!solucion) continue;

      // Validacion post-optimizacion
      const ind = solucion.indicadores;
      const zona = ind.zona?.zona || '';

      // Zona I (gap-graded) is always rejected — indicates discontinuous granulometry
      if (zona === 'I') continue;
      // Zona V: only reject if no TMN objective (user didn't ask for large TMN)
      // When user selects TMN, Zona V may be acceptable for coarser mixes
      if (zona === 'V' && !parametros.tmnObjetivo) continue;

      // Para bombeable: verificar pasante 0,3 mm
      if (parametros.bombeable && solucion.granulometria) {
        const p03 = solucion.granulometria[0.3];
        if (p03 != null && p03 < 15) {
          solucion.alertas = solucion.alertas || [];
          solucion.alertas.push('Pasante 0,3 mm bajo para bombeo (< 15%). ACI 304.2R recomienda >= 15%.');
        }
      }

      soluciones.push(solucion);
      } // end for solsFromCombo
    } catch (e) { /* skip */ }
  }

  // soluciones filtered
  if (soluciones.length === 0) throw new Error('No se encontraron mezclas factibles para los parametros seleccionados');

  // Orden final: por score, pero con desempate blando a favor de las soluciones
  // que cumplen aptitud. Si dos mezclas tienen score ~equivalente, la que
  // cumple IRAM 1512 sube. En PRESTACIONAL nunca oculta las no cumplidoras;
  // solo las acomoda más abajo.
  const aptitudRank = (sol) => {
    const e = sol.cumplimientoAptitud?.estado;
    if (e === 'cumple') return 0;
    if (e === 'sin_dato') return 1;
    if (e === 'cumple_con_atencion') return 2;
    if (e === 'no_cumple') return 3;
    return 4;
  };
  soluciones.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) < 30) return aptitudRank(a) - aptitudRank(b);
    return diff;
  });
  const diversas = filtrarSolucionesDiversas(soluciones, maxResultados);

  // Build warnings
  const advertencias = [];
  if (parametros.tmnObjetivo && diversas.length > 0) {
    const tmnUser = Number(parametros.tmnObjetivo);
    const tmnsLogrados = [...new Set(diversas.map(s => s.indicadores?.tmn || 0))].sort((a, b) => b - a);
    const tmnBest = tmnsLogrados[0];

    // Check if a normative restriction overrides user's TMN
    const normLimits = tmnInfo.limites.filter(l => l.fuente !== 'TMN objetivo del usuario' && l.fuente !== 'Limite absoluto del sistema');
    const restrictivo = normLimits.find(l => l.valor < tmnUser);
    if (restrictivo) {
      advertencias.push({
        tipo: 'tmn_conflicto',
        mensaje: `TMN objetivo ${tmnUser} mm excede la restricción "${restrictivo.fuente}" (máx. ${restrictivo.valor} mm). Se aplicó el límite normativo.`,
      });
    }

    // Inform if TMN achieved differs from objective (only if no normative conflict explains it)
    if (tmnBest < tmnUser && !restrictivo) {
      const gruesoMax = Math.max(...gruesos.map(g => g.tmn || 0), 0);
      if (gruesoMax < tmnUser) {
        advertencias.push({
          tipo: 'tmn_inferior',
          mensaje: `TMN objetivo: ${tmnUser} mm. El agregado grueso de mayor TMN disponible es ${gruesoMax} mm. Las mezclas alcanzan TMN ${tmnBest} mm.`,
        });
      } else {
        advertencias.push({
          tipo: 'tmn_inferior',
          mensaje: `TMN objetivo: ${tmnUser} mm. Las mezclas optimizadas alcanzan TMN ${tmnBest} mm. Para lograr TMN ${tmnUser} mm se requeriría mayor proporción de gruesos, lo cual no es compatible con los indicadores de trabajabilidad.`,
        });
      }
    }

    // Show available TMNs if multiple
    if (tmnsLogrados.length > 1) {
      advertencias.push({
        tipo: 'tmn_info',
        mensaje: `TMN disponibles en las sugerencias: ${tmnsLogrados.join(', ')} mm.`,
      });
    }
  }

  return diversas.map((sol, i) => ({
    ...sol,
    ranking: i + 1,
    estrellas: i === 0 ? 4 : i === 1 ? 3 : i === 2 ? 2 : 1,
    etiqueta: i === 0 ? 'Recomendada' : null,
    _meta: {
      tmnMaximo: tmnMax, tmnFuente: tmnInfo.fuente, excluidos, advertencias,
      restricciones: { finosMin, finosMax, bombeable: !!parametros.bombeable },
      shilstone: getShilstoneConfig(parametros.tipologia),
    },
  }));
}

/**
 * Evalúa una combinación ya elegida (no busca la óptima). Se usa desde el
 * editor interactivo del frontend para mostrar preview en vivo cuando el
 * usuario ajusta las proporciones de una sugerencia previamente seleccionada.
 *
 * Recibe componentes + proporciones explícitas, arma el tipoIdx, dispara
 * evaluarProporcion y empaqueta la solución con el mismo shape del sugeridor.
 *
 * @param {Array} componentes - array con tipo + granulometría + aptitudSummary
 * @param {Array} proporciones - porcentajes (0..100) en el mismo orden
 * @param {object} parametros - mismos parámetros que recibe generarSugerencias
 * @returns {object|null} solución al estilo buildSolucion, o null si no evalúa
 */
function evaluarCombinacionStandalone(componentes, proporciones, parametros) {
  if (!Array.isArray(componentes) || componentes.length === 0) return null;
  if (!Array.isArray(proporciones) || proporciones.length !== componentes.length) return null;
  const tipoIdx = componentes.map(c => (c.tipo || '').toUpperCase() === 'FINO' ? 'F' : 'G');
  const result = evaluarProporcion(componentes, proporciones, tipoIdx, parametros);
  if (!result) return null;
  return buildSolucion(componentes, result);
}

module.exports = {
  generarSugerencias,
  generarCombinaciones,
  optimizarProporciones,
  evaluarProporcion,
  evaluarCombinacionStandalone,
  calcularGranulometriaCombinada,
  calcularMF,
  calcularTMN,
  calcularTMNDesdeComponentes,
  calcularScore,
  obtenerTMNMaximo,
};
