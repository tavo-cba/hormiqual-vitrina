'use strict';

/**
 * granulometriaEvalService.js
 *
 * Evalúa datos granulométricos medidos contra una curva objetivo (BANDA IRAM/ASTM).
 *
 * La evaluación se realiza en los tamices de la BANDA (no en los medidos).
 * Para obtener el %pasa medido en una abertura de la banda que no coincide
 * exactamente con un tamiz medido, se usa interpolación log-lineal:
 *   %pasa(d) = lerp( %pasa(d1), %pasa(d2), (log(d)-log(d1))/(log(d2)-log(d1)) )
 * donde d1 y d2 son las aberturas medidas adyacentes que encierran d.
 *
 * Devuelve:
 *   - estado: "CUMPLE" | "NO_CUMPLE" | "INCOMPLETO"
 *   - cumple: boolean (true solo si estado === "CUMPLE")
 *   - fueraDeBanda: detalle de tamices que no cumplen
 *   - faltantes: tamices de la banda que no pudieron evaluarse
 *   - stats: { nTamices, nFuera, peorDesvioPct }
 *   - series: { medida, bandaMin, bandaMax } (para gráfico overlay)
 *   - calculos: { moduloFinura, tmn }
 */

const { MF_ABERTURAS, EQUIVALENT_SIEVES } = require('../catalog/tamicesCatalog');

/* ════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════ */

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Normaliza puntos medidos a un array ordenado desc por aberturaMm.
 * Filtra isNA, habilitado===false, y valores null.
 */
function normalizeMedidos(puntosMedidos) {
  if (!Array.isArray(puntosMedidos)) return [];

  // Build alt→std mapping from EQUIVALENT_SIEVES
  const altToStd = new Map();
  for (const [std, alt] of EQUIVALENT_SIEVES) {
    altToStd.set(alt, std);
  }

  return puntosMedidos
    .filter((p) =>
      p.pasaPct !== null && p.pasaPct !== undefined && p.pasaPct !== '' &&
      p.isNA !== true && p.habilitado !== false
    )
    .map((p) => {
      const rawAb = Number(p.aberturaMm);
      // Map alternative sieve to IRAM standard if applicable
      const stdAb = altToStd.get(rawAb) ?? rawAb;
      return {
        aberturaMm: stdAb,
        pasaPct: Number(p.pasaPct),
        tamiz: p.tamiz || `${stdAb} mm`,
      };
    })
    // Deduplicate: if two points map to same abertura, keep the one with data
    .reduce((acc, p) => {
      const existing = acc.find(a => a.aberturaMm === p.aberturaMm);
      if (!existing) acc.push(p);
      return acc;
    }, [])
    .sort((a, b) => b.aberturaMm - a.aberturaMm); // desc (grueso → fino)
}

/* ════════════════════════════════════════════════════════
   Deducción por saturación
   ════════════════════════════════════════════════════════ */

/**
 * Deduce %pasa en una abertura objetivo a partir de valores de saturación
 * en los puntos medidos:
 *
 *  1) Si algún tamiz medido (habilitado) tiene pasaPct ≈ 100 y la abertura
 *     objetivo es MAYOR que ese tamiz ⇒ pasa = 100 (todo pasa por tamices
 *     más gruesos).
 *  2) Si algún tamiz medido (habilitado) tiene pasaPct ≈ 0 y la abertura
 *     objetivo es MENOR que ese tamiz ⇒ pasa = 0 (nada pasa por tamices
 *     más finos).
 *
 * Se usa cuando interpolarLogLineal no puede resolver el punto (fuera del
 * rango medido) pero la lógica de saturación permite deducirlo.
 *
 * @param {Array<{aberturaMm:number, pasaPct:number}>} medidosSorted
 *   Ordenados descendente por aberturaMm (output de normalizeMedidos).
 * @param {number} targetAberturaMm  Abertura del tamiz a deducir.
 * @returns {{ pasaPct: number, reason: string }|null}
 */
function deducirPorSaturacion(medidosSorted, targetAberturaMm) {
  if (!medidosSorted.length || targetAberturaMm <= 0) return null;

  // Rule 1 — buscar el MENOR tamiz medido con pasaPct ≈ 100.
  //   Si target > ese tamiz ⇒ pasa = 100
  let minWith100 = null;
  for (const m of medidosSorted) {
    if (m.pasaPct >= 99.999) {
      if (!minWith100 || m.aberturaMm < minWith100.aberturaMm) {
        minWith100 = m;
      }
    }
  }
  if (minWith100 && targetAberturaMm > minWith100.aberturaMm) {
    return {
      pasaPct: 100,
      reason: `pasa=100% en ${minWith100.aberturaMm} mm → tamices mayores también`,
    };
  }

  // Rule 2 — buscar el MAYOR tamiz medido con pasaPct ≈ 0.
  //   Si target < ese tamiz ⇒ pasa = 0
  let maxWith0 = null;
  for (const m of medidosSorted) {
    if (m.pasaPct <= 0.001) {
      if (!maxWith0 || m.aberturaMm > maxWith0.aberturaMm) {
        maxWith0 = m;
      }
    }
  }
  if (maxWith0 && targetAberturaMm < maxWith0.aberturaMm) {
    return {
      pasaPct: 0,
      reason: `pasa=0% en ${maxWith0.aberturaMm} mm → tamices menores también`,
    };
  }

  return null;
}

/* ════════════════════════════════════════════════════════
   Interpolación log-lineal
   ════════════════════════════════════════════════════════ */

/**
 * Interpola %pasa en una abertura arbitraria `d` usando los puntos medidos.
 *
 * Usa escala logarítmica en el eje X (abertura) y lineal en Y (%pasa).
 *
 * @param {Array<{aberturaMm:number, pasaPct:number}>} medidosSorted
 *   Ordenados descendente por aberturaMm.
 * @param {number} d  Abertura objetivo en mm.
 * @returns {number|null}  %pasa interpolado, o null si d está fuera del rango medido.
 */
function interpolarLogLineal(medidosSorted, d) {
  if (!medidosSorted.length) return null;
  if (d <= 0) return null;

  const logD = Math.log10(d);

  // Exact match (tolerance 0.1%)
  for (const m of medidosSorted) {
    if (Math.abs(m.aberturaMm - d) / Math.max(d, 0.001) < 0.001) {
      return m.pasaPct;
    }
  }

  // medidosSorted is desc — convert to asc for bracket search
  const asc = [...medidosSorted].reverse();

  // Check range
  if (d < asc[0].aberturaMm || d > asc[asc.length - 1].aberturaMm) {
    return null; // outside measured range → cannot interpolate
  }

  // Find bracketing points
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

/* ════════════════════════════════════════════════════════
   Módulo de Finura (MF) — con completado lógico por monotonicidad
   ════════════════════════════════════════════════════════ */

/**
 * Obtiene pasaPct para una abertura dada usando:
 *   1) Valor exacto medido
 *   2) Interpolación log-lineal entre dos puntos medidos
 *   3) Completado lógico por monotonicidad:
 *      - Si un tamiz medido mayor tiene pasaPct=0  → tamices menores = 0
 *      - Si un tamiz medido menor tiene pasaPct=100 → tamices mayores = 100
 *   4) null si no se puede resolver
 *
 * @param {Array<{aberturaMm:number, pasaPct:number}>} medidosSorted  desc by aberturaMm
 * @param {number} d  abertura objetivo en mm
 * @returns {{ pasaPct: number, metodo: 'EXACTO'|'INTERPOLADO'|'COMPLETADO_LOGICO' }|null}
 */
function resolverPasaPct(medidosSorted, d) {
  if (!medidosSorted.length || d <= 0) return null;

  // 1) Exact match
  for (const m of medidosSorted) {
    if (Math.abs(m.aberturaMm - d) / Math.max(d, 0.001) < 0.001) {
      return { pasaPct: m.pasaPct, metodo: 'EXACTO' };
    }
  }

  // 2) Interpolation
  const interp = interpolarLogLineal(medidosSorted, d);
  if (interp !== null) {
    return { pasaPct: interp, metodo: 'INTERPOLADO' };
  }

  // 3) Logical completion by monotonicity
  // 3a) If any measured sieve with LARGER aperture has pasaPct=0 → this smaller sieve = 0
  //     (everything is retained above, so nothing passes below)
  for (const m of medidosSorted) {
    if (m.aberturaMm > d && m.pasaPct <= 0.001) {
      return { pasaPct: 0, metodo: 'COMPLETADO_LOGICO' };
    }
  }

  // 3b) If any measured sieve with SMALLER aperture has pasaPct>=99.999 → this larger sieve = 100
  //     (everything passes below, so everything passes above too)
  for (const m of medidosSorted) {
    if (m.aberturaMm < d && m.pasaPct >= 99.999) {
      return { pasaPct: 100, metodo: 'COMPLETADO_LOGICO' };
    }
  }

  // 3c) Extrapolation below measured range: if smallest measured sieve has pasaPct=0
  //     then all sieves below it also have pasaPct=0
  const smallest = medidosSorted[medidosSorted.length - 1];
  if (d < smallest.aberturaMm && smallest.pasaPct <= 0.001) {
    return { pasaPct: 0, metodo: 'COMPLETADO_LOGICO' };
  }

  // 3d) Extrapolation above measured range: if largest measured sieve has pasaPct=100
  //     then all sieves above it also have pasaPct=100
  const largest = medidosSorted[0];
  if (d > largest.aberturaMm && largest.pasaPct >= 99.999) {
    return { pasaPct: 100, metodo: 'COMPLETADO_LOGICO' };
  }

  // B1 fix: Extrapolation below measured range with monotonic floor.
  // If the smallest measured sieve has pasaPct > 0 (e.g. sand test ends at 0.150mm
  // with 2% passing), extrapolate that same value to smaller sieves (0.075mm).
  // This is conservative: the actual pasa% at 0.075mm is some value <= the one at
  // 0.150mm. Marking it as the upper bound preserves traceability and avoids the
  // "0.0%" false value in the combined mix (e.g. Pasante #200 of the total mix).
  if (d < smallest.aberturaMm && smallest.pasaPct > 0.001) {
    return { pasaPct: smallest.pasaPct, metodo: 'EXTRAPOLADO' };
  }

  return null;
}

/**
 * Calcula el Módulo de Finura a partir de los puntos medidos normalizados.
 *
 * MF = Σ (%retenido acumulado en cada tamiz MF_ABERTURAS) / 100
 * donde retAcum = 100 - pasaPct
 *
 * Usa resolverPasaPct que incluye interpolación + completado lógico.
 * Cuando un tamiz nominal no tiene dato, se intenta con su equivalente métrico/imperial
 * definido en EQUIVALENT_SIEVES (53↔50, 26.5↔25, 13.2↔12.5).
 *
 * @param {Array<{aberturaMm:number, pasaPct:number}>} medidosSorted
 *   Ordenados descendente por aberturaMm (output de normalizeMedidos).
 * @param {string} [tipoAgregado] - 'FINO', 'GRUESO', etc. Para GRUESO,
 *   tamices estándar ≤ 4.75mm sin datos se asumen como 0% pasa (100% retenido).
 * @returns {{ valor: number, completo: boolean, disponibles: number, total: number,
 *             faltantes: number[], porEquivalencia: Array<{requerido:number,usado:number}> }|null}
 *   null si no hay suficientes datos.
 */
function calcularModuloFinura(medidosSorted, tipoAgregado) {
  if (!medidosSorted || medidosSorted.length === 0) return null;

  const isGrueso = tipoAgregado && tipoAgregado.toUpperCase() === 'GRUESO';

  // Build quick lookup: stdMm → [altMm, ...] and altMm → [stdMm, ...]
  const equivMap = new Map();
  for (const [stdAb, altAb] of EQUIVALENT_SIEVES) {
    if (!equivMap.has(stdAb)) equivMap.set(stdAb, []);
    equivMap.get(stdAb).push(altAb);
    if (!equivMap.has(altAb)) equivMap.set(altAb, []);
    equivMap.get(altAb).push(stdAb);
  }

  let sumaRetAcum = 0;
  let disponibles = 0;
  const total = MF_ABERTURAS.length;
  const faltantes = [];
  const porEquivalencia = [];

  for (const ab of MF_ABERTURAS) {
    let resolved = resolverPasaPct(medidosSorted, ab);
    // Si no hay dato directo, intentar con equivalentes
    if (resolved === null && equivMap.has(ab)) {
      for (const altAb of equivMap.get(ab)) {
        const altResolved = resolverPasaPct(medidosSorted, altAb);
        if (altResolved !== null) {
          resolved = altResolved;
          porEquivalencia.push({ requerido: ab, usado: altAb });
          break;
        }
      }
    }

    if (resolved === null) {
      // Para grueso: tamices ≤ 4.75mm sin datos → 0% pasa (100% retenido)
      if (isGrueso && ab <= 4.75) {
        disponibles++;
        sumaRetAcum += 100;
        continue;
      }
      faltantes.push(ab);
      continue;
    }
    disponibles++;
    sumaRetAcum += (100 - resolved.pasaPct);
  }

  if (disponibles === 0) return null;
  const completo = faltantes.length === 0 && porEquivalencia.length === 0;

  // Si tiene menos de la mitad de los tamices, resultado no confiable
  if (disponibles < total / 2) return null;

  return {
    valor: round2(sumaRetAcum / 100),
    completo,
    disponibles,
    total,
    faltantes,
    porEquivalencia,
  };
}

/* ════════════════════════════════════════════════════════
   Tamaño Máximo Nominal (TMN)
   ════════════════════════════════════════════════════════ */

/**
 * Calcula el TMN a partir de los puntos medidos normalizados.
 *
 * TMN = el tamiz de menor abertura que deja pasar ≥ 95% del material
 *       (retención acumulada ≤ 5%).
 *
 * Se busca entre los tamices REALMENTE medidos (no interpolados),
 * de grueso a fino (desc).
 *
 * @param {Array<{aberturaMm:number, pasaPct:number, tamiz?:string}>} medidosSorted
 *   Ordenados descendente por aberturaMm.
 * @returns {{ valor: number, tamiz: string }|null}
 */
function calcularTMN(medidosSorted) {
  if (!medidosSorted || medidosSorted.length === 0) return null;

  let tmnPoint = null;

  // Recorrer de grueso a fino (ya está desc)
  for (const pt of medidosSorted) {
    if (pt.pasaPct >= 95) {
      tmnPoint = pt; // candidato — seguir buscando uno más fino que también cumpla
    } else {
      break; // ya no pasa ≥95%, el anterior era el último que cumplía
    }
  }

  if (!tmnPoint) return null;

  return {
    valor: tmnPoint.aberturaMm,
    tamiz: tmnPoint.tamiz || `${tmnPoint.aberturaMm} mm`,
  };
}

/* ════════════════════════════════════════════════════════
   evalAgainstSpec  —  evaluación principal
   ════════════════════════════════════════════════════════ */

/**
 * Evalúa puntos medidos contra una especificación (curva BANDA).
 *
 * Itera los tamices de la BANDA; para cada uno obtiene el %pasa medido
 * mediante interpolación log-lineal.
 *
 * @param {object} opts
 * @param {Array<{aberturaMm, pasaPct, isNA?, tamiz?}>} opts.medidos
 * @param {object} opts.spec
 * @param {string} opts.spec.specMode  RANGO | MAX_ONLY | MIN_ONLY | OBJETIVO
 * @param {Array<{aberturaMm, tamiz, limInfPct, limSupPct, targetPct, isNA?}>} opts.spec.puntos
 * @param {string} [opts.serieTamices]
 *
 * @returns {{
 *   cumple: boolean,
 *   estado: "CUMPLE"|"NO_CUMPLE"|"INCOMPLETO",
 *   fueraDeBanda: Array<{tamiz, aberturaMm, medido, min, max, deltaMin, deltaMax}>,
 *   faltantes: Array<{tamiz, aberturaMm}>,
 *   stats: {nTamices:number, nFuera:number, peorDesvioPct:number},
 *   series: {
 *     medida:  Array<{aberturaMm, pasaPct}>,
 *     bandaMin: Array<{aberturaMm, pasaPct}>,
 *     bandaMax: Array<{aberturaMm, pasaPct}>
 *   },
 *   errores: Array  (legacy compat – equal to fueraDeBanda),
 *   resumen: {total, evaluados, fuera}  (legacy compat)
 * }}
 */
function evalAgainstSpec({ medidos, spec, serieTamices, tipoAgregado }) {
  const specMode = spec.specMode || 'RANGO';
  const specPuntos = (spec.puntos || []).filter((sp) => sp.isNA !== true);
  const medidosNorm = normalizeMedidos(medidos);

  const fueraDeBanda = [];
  const faltantes = [];
  const deducidos = [];
  let evaluados = 0;
  let peorDesvioPct = 0;

  // Series accumulators (asc by aberturaMm)
  const serMedida = [];
  const serBandaMin = [];
  const serBandaMax = [];

  // Sort spec points ascending by aberturaMm for series output
  const specAsc = [...specPuntos].sort((a, b) => a.aberturaMm - b.aberturaMm);

  for (const sp of specAsc) {
    const abMm = Number(sp.aberturaMm);
    const tamizLabel = sp.tamiz || `${abMm} mm`;
    const limInf = sp.limInfPct;
    const limSup = sp.limSupPct;

    // Only consider spec points that have actual limits
    const hasLimits = limInf != null || limSup != null || sp.targetPct != null;
    if (!hasLimits) continue;

    // Build band series
    if (limInf != null) serBandaMin.push({ aberturaMm: abMm, pasaPct: limInf });
    if (limSup != null) serBandaMax.push({ aberturaMm: abMm, pasaPct: limSup });

    // Get measured %pasa at this sieve via interpolation, then saturation deduction
    let medido = interpolarLogLineal(medidosNorm, abMm);
    let esDeducido = false;

    if (medido === null) {
      const deduccion = deducirPorSaturacion(medidosNorm, abMm);
      if (deduccion) {
        medido = deduccion.pasaPct;
        esDeducido = true;
        deducidos.push({ tamiz: tamizLabel, aberturaMm: abMm, pasaPct: medido, reason: deduccion.reason });
      } else {
        faltantes.push({ tamiz: tamizLabel, aberturaMm: abMm });
        continue;
      }
    }

    evaluados++;
    serMedida.push({ aberturaMm: abMm, pasaPct: medido, deducido: esDeducido || undefined });

    // Check against limits
    const deltaMin = limInf != null ? round2(medido - limInf) : null;
    const deltaMax = limSup != null ? round2(medido - limSup) : null;

    let fuera = false;

    if (specMode === 'RANGO') {
      if (limInf != null && medido < limInf) fuera = true;
      if (limSup != null && medido > limSup) fuera = true;
    } else if (specMode === 'MAX_ONLY') {
      if (limSup != null && medido > limSup) fuera = true;
    } else if (specMode === 'MIN_ONLY') {
      if (limInf != null && medido < limInf) fuera = true;
    }
    // OBJETIVO never counts as fuera

    if (fuera) {
      // P1.10: convención unificada de signos.
      //   desvio < 0  → medido por DEBAJO del límite inferior (faltante)
      //   desvio > 0  → medido por ENCIMA del límite superior (exceso)
      // Coincide con mezclaService.buildTrazabilidad y dosificacionDisenoService.
      // Para tamaño absoluto del problema usar `Math.abs(desvio)` o el campo
      // `desvioMagnitud` que mantenemos por compat de UI.
      let desvio = 0;
      if (deltaMin != null && deltaMin < 0) desvio = deltaMin;          // negativo
      else if (deltaMax != null && deltaMax > 0) desvio = deltaMax;     // positivo
      const magnitud = Math.abs(desvio);
      if (magnitud > peorDesvioPct) peorDesvioPct = magnitud;

      fueraDeBanda.push({
        tamiz: tamizLabel,
        aberturaMm: abMm,
        medido: round2(medido),
        min: limInf,
        max: limSup,
        deltaMin,
        deltaMax,
        desvio: round2(desvio),
        desvioMagnitud: round2(magnitud), // compat para call sites que mostraban siempre positivo
      });
    }
  }

  // Determine estado
  const nEvaluable = specAsc.filter(
    (sp) => sp.limInfPct != null || sp.limSupPct != null || sp.targetPct != null
  ).length;
  const faltanRatio = nEvaluable > 0 ? faltantes.length / nEvaluable : 0;

  let estado;
  if (evaluados === 0 || faltanRatio > 0.5) {
    estado = 'INCOMPLETO';
  } else if (fueraDeBanda.length > 0) {
    estado = 'NO_CUMPLE';
  } else {
    estado = 'CUMPLE';
  }

  const cumple = estado === 'CUMPLE';

  // ── Cálculos derivados ──
  const mfResult = calcularModuloFinura(medidosNorm, tipoAgregado);
  const tmnResult = calcularTMN(medidosNorm);
  const calculos = {
    moduloFinura: mfResult ? { valor: mfResult.valor, completo: mfResult.completo, disponibles: mfResult.disponibles, total: mfResult.total } : null,
    tmn: tmnResult ? { valor: tmnResult.valor, tamiz: tmnResult.tamiz } : null,
  };

  // ── Reglas CIRSOC 200-2024 §3.2.3.2 (solo para agregado fino) ──
  const reglasCI = {};
  const esFino = tipoAgregado === 'FINO' || (spec.uso || '').toUpperCase() === 'FINO';

  if (esFino) {
    // REGLA 2 — MF: variación ±0.20 vs MF de diseño (CIRSOC §3.2.3.2.g) [PR8.1]
    //
    // CAMBIO PR8.1: el rango 2.3-3.1 que se aplicaba antes NO existe en
    // CIRSOC 200:2024 ni en IRAM 1627. CIRSOC §3.2.3.2.g establece:
    //   "Si el módulo de finura del agregado fino varía más de 0.20 en más
    //   o en menos con respecto al del material empleado para determinar
    //   las proporciones del hormigón (dosificación), la partida de
    //   agregado fino debe ser RECHAZADA, salvo que se realicen ajustes
    //   en las proporciones de la mezcla."
    //
    // Por eso el MF se compara contra el MF de DISEÑO (proviene del context
    // de la dosificación, opcional). Si no se conoce → solo se reporta el
    // valor, sin veredicto. Si se conoce y |Δ| > 0.20 → se emite warning
    // (NO NO_CUMPLE; la decisión es del DO según ajuste de proporciones).
    const mfVal = mfResult?.valor;
    const mfDiseno = (spec?.mfDiseno != null) ? Number(spec.mfDiseno) : null;
    let delta = null;
    let estadoMfRule = 'sin_dato';
    if (mfVal != null && mfDiseno != null) {
      delta = round2(mfVal - mfDiseno);
      estadoMfRule = Math.abs(delta) <= 0.20 ? 'dentro_tolerancia' : 'desviado';
    } else if (mfVal != null) {
      estadoMfRule = 'sin_diseno';
    }
    reglasCI.moduloFinura = {
      regla: 'CIRSOC §3.2.3.2.g',
      valor: mfVal != null ? round2(mfVal) : null,
      mfDiseno,
      delta,
      toleranciaMax: 0.20,
      estado: estadoMfRule,
      severidad: estadoMfRule === 'desviado' ? 'warning' : null,
      // `cumple` se mantiene por compat de UI/PDF anterior, pero ahora es
      // semántico de WARNING, no de NO_CUMPLE. Una partida con MF desviado
      // del diseño puede usarse si se ajustan proporciones (decisión DO).
      cumple: estadoMfRule === 'desviado' ? false : (estadoMfRule === 'dentro_tolerancia' ? true : null),
    };

    // REGLA 3 — Tolerancia 10 pp sobre Curva B (solo banda A-B)
    //
    // PR8.5 — versión ESTRICTA conforme a IRAM 1627 §3.2.4 (= CIRSOC §3.2.3.2 d).
    // Reemplaza la versión legacy laxa que solo sumaba exceso sobre B en los
    // 3 tamices pero NO verificaba las otras condiciones obligatorias. La
    // tolerancia SOLO aplica si se cumplen las 4 condiciones siguientes:
    //   1. La curva no cumple A-B estrictamente (hay tamices fuera).
    //   2. TODOS los tamices fuera están en {1.18 mm, 600 µm, 300 µm}.
    //   3. Todas las violaciones son por EXCESO (sobre curva B); no hay
    //      tamices por DEBAJO de la curva A.
    //   4. La suma de excedencias en esos 3 tamices ≤ 10 pp absoluto.
    //
    // Si alguna condición falla, la tolerancia NO aplica y la curva queda
    // como NO_CUMPLE A-B. Esta versión es coherente con evalTolerancia_3_2_4
    // (línea ~837) usado por autoEvaluarGranulometriaFinoIRAM1627.
    const esBandaAB = (spec.nombre || '').includes('A-B') || ((spec.curveLetter || '').toUpperCase() === 'B');
    const TAMICES_TOL_PERMITIDOS = new Set([1.18, 0.6, 0.3]);
    const tolDetalle = [];
    let excesoTotal = 0;

    // Particionamos `fueraDeBanda` por dirección.
    // deltaMin < 0 → medido por debajo de curva A (faltante)
    // deltaMax > 0 → medido por encima de curva B (exceso)
    const fueraPorDefecto = fueraDeBanda.filter((f) => f.deltaMin != null && f.deltaMin < 0);
    const fueraPorExceso = fueraDeBanda.filter((f) => f.deltaMax != null && f.deltaMax > 0);

    let tolAplica = false;
    let motivoNoAplica = null;
    if (!esBandaAB) {
      motivoNoAplica = 'Solo aplica para banda A-B';
    } else if (fueraDeBanda.length === 0) {
      // La banda cumple estrictamente; la tolerancia no aplica porque no se
      // necesita. cumple=true via la regla principal, no via tolerancia.
      motivoNoAplica = 'A-B cumple sin necesidad de tolerancia';
    } else if (fueraPorDefecto.length > 0) {
      // Condición 3: hay tamices por debajo de A → la tolerancia §3.2.4 solo
      // cubre excedencias sobre B.
      motivoNoAplica = `${fueraPorDefecto.length} tamiz(es) por debajo de curva A — la tolerancia §3.2.4 solo cubre exceso sobre curva B`;
    } else {
      // Condición 2: todos los fuera deben estar en {1.18, 0.600, 0.300}.
      const tamicesFueraNoPermitidos = fueraDeBanda.filter((f) => !TAMICES_TOL_PERMITIDOS.has(f.aberturaMm));
      if (tamicesFueraNoPermitidos.length > 0) {
        const lista = tamicesFueraNoPermitidos.map((f) => `${f.aberturaMm} mm`).join(', ');
        motivoNoAplica = `Tamiz(es) fuera de banda B en ${lista} — la tolerancia §3.2.4 solo cubre 1,18 / 0,600 / 0,300 mm`;
      } else {
        // Las 4 condiciones se cumplen — sumar excedencias sobre los 3 tamices.
        tolAplica = true;
        for (const f of fueraPorExceso) {
          const exceso = round2(f.deltaMax);
          excesoTotal += exceso;
          tolDetalle.push({ aberturaMm: f.aberturaMm, medido: round2(f.medido), limiteB: f.max, exceso });
        }
        excesoTotal = round2(excesoTotal);
      }
    }

    reglasCI.tolerancia10pp = {
      regla: 'CIRSOC §3.2.3.2 d / IRAM 1627 §3.2.4',
      aplica: tolAplica,
      excesoTotal,
      maxPermitido: 10,
      cumple: tolAplica ? excesoTotal <= 10 : null,
      detalle: tolDetalle,
      motivoNoAplicable: motivoNoAplica,
    };

    // REGLA 4 — Fracción máxima entre tamices consecutivos ≤ 45%
    const TAMICES_TABLA = [9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15];
    const fracDetalle = [];
    let fracMax = 0;
    let fracMaxEntre = '';
    let fracCumple = true;

    for (let i = 0; i < TAMICES_TABLA.length - 1; i++) {
      const abSup = TAMICES_TABLA[i];
      const abInf = TAMICES_TABLA[i + 1];
      const pasaSup = interpolarLogLineal(medidosNorm, abSup);
      const pasaInf = interpolarLogLineal(medidosNorm, abInf);
      if (pasaSup != null && pasaInf != null) {
        const fraccion = round2(pasaSup - pasaInf);
        const ok = fraccion <= 45;
        if (!ok) fracCumple = false;
        if (fraccion > fracMax) { fracMax = fraccion; fracMaxEntre = `${abSup}-${abInf} mm`; }
        fracDetalle.push({ entre: `${abSup}-${abInf} mm`, abSup, abInf, pasaSup: round2(pasaSup), pasaInf: round2(pasaInf), fraccion, cumple: ok });
      }
    }
    reglasCI.fraccionMaxima = {
      regla: '§3.2.3.2 e',
      maxPermitido: 45,
      fraccionMax: fracMax,
      fraccionMaxEntre: fracMaxEntre,
      cumple: fracCumple,
      detalle: fracDetalle,
    };

    // Resultado global considerando todas las reglas.
    // PR8.1: MF desviado del diseño es WARNING, NO descalifica el cumple global.
    // El usuario/DO decide si ajusta proporciones (CIRSOC §3.2.3.2.g).
    const reglasIncumplidas = [];
    if (fueraDeBanda.length > 0) reglasIncumplidas.push('insercion');
    if (reglasCI.tolerancia10pp.aplica && !reglasCI.tolerancia10pp.cumple) reglasIncumplidas.push('tolerancia10pp');
    if (!reglasCI.fraccionMaxima.cumple) reglasIncumplidas.push('fraccionMaxima');
    // PR8.1: NO se incluye moduloFinura en reglasIncumplidas. Su severidad
    // máxima es 'warning'. El estado se reporta vía reglasCI.moduloFinura.estado.
    const moduloFinuraWarning = reglasCI.moduloFinura.estado === 'desviado';

    reglasCI.resultadoGlobal = {
      cumple: reglasIncumplidas.length === 0 && evaluados > 0,
      reglasIncumplidas,
      totalReglas: 4,
      reglasOk: 4 - reglasIncumplidas.length,
      moduloFinuraWarning,  // PR8.1 — indicador independiente del cumple
    };
  }

  return {
    cumple: esFino && reglasCI.resultadoGlobal ? reglasCI.resultadoGlobal.cumple : cumple,
    estado: esFino && reglasCI.resultadoGlobal ? (reglasCI.resultadoGlobal.cumple ? 'CUMPLE' : 'NO_CUMPLE') : estado,
    fueraDeBanda,
    faltantes,
    deducidos,
    stats: {
      nTamices: evaluados,
      nDeducidos: deducidos.length,
      nFuera: fueraDeBanda.length,
      peorDesvioPct: round2(peorDesvioPct),
    },
    series: {
      medida: serMedida,
      bandaMin: serBandaMin,
      bandaMax: serBandaMax,
    },
    calculos,
    ...(esFino && { reglasCIRSOC: reglasCI }),
    // Legacy compatibility
    errores: fueraDeBanda,
    resumen: {
      total: nEvaluable,
      evaluados,
      fuera: fueraDeBanda.length,
    },
  };
}

/* ════════════════════════════════════════════════════════════════════════
   Bloque A — Validador único de granulometría IRAM 1627 (P0.9 / v2 audit)
   ────────────────────────────────────────────────────────────────────────
   Single source of truth para evaluar finos contra A-B y A-C, con la regla
   de tolerancia §3.2.4 implementada correctamente. Antes vivía duplicado
   en agregadoEnsayoService._evalContraBandaFino.
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Bandas IRAM 1627 para agregado fino. Tabla 1 + Figura 1.
 *   curvaA = límite inferior común para A-B y A-C.
 *   curvaB = límite superior de la banda A-B (granulometría primaria).
 *   curvaC = límite superior de la banda A-C (granulometría ampliada §3.2.5).
 */
const BANDA_FINO_IRAM1627 = Object.freeze({
  tamices: [9.5, 4.75, 2.36, 1.18, 0.600, 0.300, 0.150],
  curvaA:  [100,   95,   80,   50,    25,    10,     2],
  curvaB:  [100,  100,  100,   85,    60,    30,    10],
  curvaC:  [100,  100,  100,  100,    95,    50,    10],
});

/**
 * Tamices sobre los que aplica la tolerancia §3.2.4.
 * (excedencia total ≤ 10pp absoluto sobre curva B en estos 3 tamices).
 */
const TAMICES_TOLERANCIA_3_2_4 = Object.freeze([1.18, 0.600, 0.300]);

/**
 * Reducción de límites A para tamices 0,300 mm y 0,150 mm según §3.2.3.
 * Tabla original A en estos tamices: [10, 2]
 * Tabla reducida cuando se cumple alguna condición: [5, 0]
 */
const REDUCCION_3_2_3 = Object.freeze({
  tamiz_300um: { aberturaMm: 0.300, valorOriginal: 10, valorReducido: 5 },
  tamiz_150um: { aberturaMm: 0.150, valorOriginal: 2,  valorReducido: 0 },
});

/**
 * Evalúa si el contexto de uso del hormigón satisface alguna de las
 * condiciones de §3.2.3 IRAM 1627 que habilitan la reducción de límites A
 * en los tamices 0,300 mm y 0,150 mm.
 *
 * Tres condiciones (cualquiera basta):
 *   1. Aire intencionalmente incorporado ≥ 3% Y cemento ≥ 250 kg/m³
 *   2. Hormigón normal con cemento ≥ 300 kg/m³
 *   3. Aditivo mineral que mejore trabajabilidad
 *
 * @param {Object} ctx - { cementContent, airContent, airIncorporated, mineralAdmixture }
 * @returns {{ aplica: boolean, condicionAplicada?: string, motivo: string }}
 */
function evaluar_3_2_3(ctx = {}) {
  if (!ctx || typeof ctx !== 'object') {
    return { aplica: false, motivo: 'Sin contexto de uso del hormigón' };
  }
  const cement = Number(ctx.cementContent);
  const air = Number(ctx.airContent);
  const airIntencional = ctx.airIncorporated === true;
  const tieneAditivoMineral = ctx.mineralAdmixture === true || (typeof ctx.mineralAdmixture === 'string' && ctx.mineralAdmixture.length > 0);

  // Condición 1: aire intencional ≥3% Y cemento ≥ 250
  if (airIntencional && Number.isFinite(air) && air >= 3 && Number.isFinite(cement) && cement >= 250) {
    return {
      aplica: true,
      condicionAplicada: 'aire_intencional_y_cemento_min',
      motivo: `Aire intencional ${air}% >= 3% y cemento ${cement} kg/m³ >= 250`,
    };
  }
  // Condición 2: cemento ≥ 300 (sin aire intencional)
  if (Number.isFinite(cement) && cement >= 300) {
    return {
      aplica: true,
      condicionAplicada: 'cemento_min_300',
      motivo: `Cemento ${cement} kg/m³ >= 300 (hormigón normal)`,
    };
  }
  // Condición 3: aditivo mineral
  if (tieneAditivoMineral) {
    return {
      aplica: true,
      condicionAplicada: 'aditivo_mineral',
      motivo: 'Aditivo mineral correctivo de trabajabilidad declarado',
    };
  }
  return {
    aplica: false,
    motivo: cement || air ? `Cemento ${cement || 'n/a'} kg/m³, aire ${air || 'n/a'}% — ninguna condición §3.2.3 satisfecha` : 'Sin contexto suficiente',
  };
}

/**
 * Devuelve la curvaA aplicable según el contexto (con o sin reducción §3.2.3).
 * @param {Object} ctx
 * @returns {{ curvaA: number[], reducida: boolean, reduccion: Object|null }}
 */
function curvaAEfectiva(ctx) {
  const evalRed = evaluar_3_2_3(ctx);
  if (!evalRed.aplica) {
    return { curvaA: BANDA_FINO_IRAM1627.curvaA, reducida: false, reduccion: null };
  }
  // Aplicar reducción solo en posiciones de 0.300 y 0.150 mm
  const curvaA = [...BANDA_FINO_IRAM1627.curvaA];
  const idx300 = BANDA_FINO_IRAM1627.tamices.indexOf(0.300);
  const idx150 = BANDA_FINO_IRAM1627.tamices.indexOf(0.150);
  if (idx300 >= 0) curvaA[idx300] = REDUCCION_3_2_3.tamiz_300um.valorReducido;
  if (idx150 >= 0) curvaA[idx150] = REDUCCION_3_2_3.tamiz_150um.valorReducido;
  return { curvaA, reducida: true, reduccion: evalRed };
}

/**
 * Construye el map abertura→pasaPct desde la lista de tamices del ensayo.
 * Ignora tamices deshabilitados o sin valor.
 */
function buildMedidosMap(tamices) {
  const map = new Map();
  if (!Array.isArray(tamices)) return map;
  for (const t of tamices) {
    if (t && t.pasaPct != null && t.habilitado !== false) {
      map.set(Number(t.aberturaMm), Number(t.pasaPct));
    }
  }
  return map;
}

/**
 * Evalúa la curva medida contra una banda inf/sup definida por dos arrays.
 * Devuelve detalle por tamiz con desvío SIGNED (P1.10).
 *   desvio < 0  → por debajo del límite inferior
 *   desvio > 0  → por encima del límite superior
 */
function evalContraBandaFino(medidosMap, curvaInfArr, curvaSupArr, nombre) {
  const tamicesArr = BANDA_FINO_IRAM1627.tamices;
  const detalle = [];
  let fueraSup = 0;     // excede curvaSup
  let fueraInf = 0;     // por debajo de curvaInf
  let peorDesvio = 0;
  for (let i = 0; i < tamicesArr.length; i++) {
    const ab = tamicesArr[i];
    const pasa = medidosMap.get(ab) ?? medidosMap.get(String(ab)) ?? null;
    if (pasa == null) continue;
    const limInf = curvaInfArr[i];
    const limSup = curvaSupArr[i];
    let desvio = 0;
    let estado = 'OK';
    if (pasa < limInf) {
      desvio = pasa - limInf;     // negativo
      fueraInf++;
      estado = 'FUERA';
    } else if (pasa > limSup) {
      desvio = pasa - limSup;     // positivo
      fueraSup++;
      estado = 'FUERA';
    }
    const magnitud = Math.abs(desvio);
    if (magnitud > peorDesvio) peorDesvio = magnitud;
    detalle.push({ aberturaMm: ab, pasa, limInf, limSup, estado, desvio, desvioMagnitud: magnitud });
  }
  const fuera = fueraInf + fueraSup;
  return {
    nombre,
    cumple: fuera === 0,
    fueraDeBanda: fuera,
    fueraSup,
    fueraInf,
    peorDesvio,
    detalle,
    tamicesEvaluados: detalle.length,
  };
}

/**
 * Evalúa la regla §3.2.4 — tolerancia 10pp absoluto sobre curva B en los
 * tamices {1.18mm, 600µm, 300µm}.
 *
 * IMPORTANTE — la regla aplica SOLO si:
 *   1. La curva NO cumple A-B estrictamente (tiene tamices fuera).
 *   2. TODOS los tamices fuera están en el conjunto {1.18, 600, 300}.
 *   3. Todas las violaciones son por EXCESO (sobre curvaB), no por defecto bajo curvaA.
 *   4. La SUMA de excedencias sobre los 3 tamices ≤ 10 pp absoluto.
 *
 * Si cualquiera de las condiciones falla, la tolerancia NO aplica y la
 * evaluación cae a "no cumple A-B".
 *
 * @param {ReturnType<typeof evalContraBandaFino>} bandaAB - resultado de A-B
 * @param {Map} medidosMap
 */
function evalTolerancia_3_2_4(bandaAB, medidosMap) {
  // Condición 1: si A-B cumple sin más, no hace falta tolerancia
  if (bandaAB.cumple) {
    return { aplicable: false, motivo: 'A-B cumple sin tolerancia', cumple: true, excesoTotal: 0, detalle: [] };
  }

  // Condición 3: todas las violaciones deben ser por exceso (sobre curvaB)
  if (bandaAB.fueraInf > 0) {
    return {
      aplicable: false,
      motivo: `Hay ${bandaAB.fueraInf} tamiz(es) por debajo de curva A — la tolerancia §3.2.4 solo aplica a excedencias sobre curva B`,
      cumple: false,
      excesoTotal: 0,
      detalle: [],
    };
  }

  // Condición 2: todos los tamices fuera deben estar en {1.18, 0.600, 0.300}
  const tamicesFueraPermitidos = bandaAB.detalle
    .filter((d) => d.estado === 'FUERA')
    .every((d) => TAMICES_TOLERANCIA_3_2_4.includes(d.aberturaMm));
  if (!tamicesFueraPermitidos) {
    const fueraNoPermitidos = bandaAB.detalle
      .filter((d) => d.estado === 'FUERA' && !TAMICES_TOLERANCIA_3_2_4.includes(d.aberturaMm))
      .map((d) => `${d.aberturaMm} mm`);
    return {
      aplicable: false,
      motivo: `Tamiz(es) fuera de banda B en ${fueraNoPermitidos.join(', ')} — la tolerancia §3.2.4 solo cubre 1,18 / 0,600 / 0,300 mm`,
      cumple: false,
      excesoTotal: 0,
      detalle: [],
    };
  }

  // Condición 4: suma de excedencias sobre los 3 tamices ≤ 10 pp
  const detalle = [];
  let excesoTotal = 0;
  const idxByAb = { 1.18: 3, 0.600: 4, 0.300: 5 };
  for (const ab of TAMICES_TOLERANCIA_3_2_4) {
    const pasa = medidosMap.get(ab) ?? medidosMap.get(String(ab)) ?? null;
    if (pasa == null) continue;
    const limiteB = BANDA_FINO_IRAM1627.curvaB[idxByAb[ab]];
    const exceso = Math.max(0, pasa - limiteB);
    if (exceso > 0) {
      excesoTotal += exceso;
      detalle.push({ aberturaMm: ab, pasa, limiteB, exceso: round2(exceso) });
    }
  }
  excesoTotal = round2(excesoTotal);

  return {
    aplicable: true,
    motivo: 'Todas las violaciones son sobre curva B en tamices admitidos por §3.2.4',
    cumple: excesoTotal <= 10,
    excesoTotal,
    limite: 10,
    detalle,
  };
}

/**
 * Evalúa la regla de fracción máxima entre tamices consecutivos
 * (criterio CIRSOC: ≤ 45% retenido entre dos tamices consecutivos).
 */
function evalFraccionMaxima(medidosMap) {
  const tamicesArr = BANDA_FINO_IRAM1627.tamices;
  let peor = 0;
  let peorEntre = '';
  const detalle = [];
  for (let i = 0; i < tamicesArr.length - 1; i++) {
    const sup = medidosMap.get(tamicesArr[i]) ?? medidosMap.get(String(tamicesArr[i]));
    const inf = medidosMap.get(tamicesArr[i + 1]) ?? medidosMap.get(String(tamicesArr[i + 1]));
    if (sup == null || inf == null) continue;
    const frac = round2(sup - inf);
    const entre = `${tamicesArr[i]}-${tamicesArr[i + 1]}`;
    detalle.push({ entre, fraccion: frac, cumple: frac <= 45 });
    if (frac > peor) { peor = frac; peorEntre = entre; }
  }
  return { peorValor: round2(peor), peorEntre, cumple: peor <= 45, detalle };
}

/**
 * Auto-evaluación granulométrica de FINO contra IRAM 1627 (única).
 *
 * Devuelve un objeto que contiene:
 *   - bandaAB, bandaAC: detalles tamiz por tamiz (mismo shape para ambos)
 *   - tolerancia_3_2_4: aplicable + cumple + excesoTotal
 *   - fraccionMaxima
 *   - moduloFinura (si está disponible)
 *   - resultadoGlobal: estado consolidado por dimensión
 *   - implicancias: array de strings explicativos coherentes con el badge
 *
 * El campo `resultadoGlobal.bandaAB` puede ser:
 *   'cumple'                    → A-B estricta
 *   'cumple_con_tolerancia'     → §3.2.4 aplicable y cumplida
 *   'no_cumple'                 → no entra ni con tolerancia
 *
 * El campo `resultadoGlobal.bandaAC` puede ser:
 *   'cumple'                    → A-C cumple (admisible solo en obras §3.2.5)
 *   'no_cumple'
 *
 * @param {Object} resultado - resultado JSON del ensayo (mutado in-place)
 * @param {Object} [context] - contexto de uso del hormigón para §3.2.3:
 *   { cementContent, airContent, airIncorporated, mineralAdmixture, mfDiseno }
 *   - cementContent / airContent / airIncorporated / mineralAdmixture: para
 *     evaluar la reducción §3.2.3 de curva A en 300/150 µm.
 *   - mfDiseno (PR8.1): MF de diseño de la dosificación, para verificar
 *     CIRSOC §3.2.3.2.g (variación ≤ 0.20). Si no se provee, no se emite
 *     warning de MF (solo se reporta el valor).
 *   Sin contexto, se hace evaluación dual (estricta + reducida) y se reporta
 *   ambas para que el lector decida.
 */
function autoEvaluarGranulometriaFinoIRAM1627(resultado, context = null) {
  const g = resultado?.granulometria;
  if (!g?.tamices?.length) return resultado;

  const medidosMap = buildMedidosMap(g.tamices);
  if (medidosMap.size < 3) return resultado;

  const B = BANDA_FINO_IRAM1627;
  // P0.13 — §3.2.3: si el contexto satisface alguna condición, aplicar la
  // curva A reducida (5/0 en 0,300 y 0,150 mm). Sin contexto: usar la estricta.
  const efectiva = curvaAEfectiva(context);
  const curvaAUsada = efectiva.curvaA;
  const bandaAB = evalContraBandaFino(medidosMap, curvaAUsada, B.curvaB, 'A-B');
  const bandaAC = evalContraBandaFino(medidosMap, curvaAUsada, B.curvaC, 'A-C');
  const tolerancia = evalTolerancia_3_2_4(bandaAB, medidosMap);
  const fraccion = evalFraccionMaxima(medidosMap);

  // Sin contexto: hacer también evaluación con curva A reducida para
  // surface al usuario "qué pasaría si el diseño cumpliera §3.2.3".
  let bandaAB_reducida = null;
  if (!context) {
    const curvaA_reducida = [...B.curvaA];
    const idx300 = B.tamices.indexOf(0.300);
    const idx150 = B.tamices.indexOf(0.150);
    if (idx300 >= 0) curvaA_reducida[idx300] = REDUCCION_3_2_3.tamiz_300um.valorReducido;
    if (idx150 >= 0) curvaA_reducida[idx150] = REDUCCION_3_2_3.tamiz_150um.valorReducido;
    bandaAB_reducida = evalContraBandaFino(medidosMap, curvaA_reducida, B.curvaB, 'A-B (reducida §3.2.3)');
  }

  // MF — usar el ya calculado o recomputar
  let mfValor = g.evaluacion?.calculos?.moduloFinura?.valor ?? null;
  if (mfValor == null) {
    try {
      const medidos = normalizeMedidos(g.tamices);
      const mfCalc = calcularModuloFinura(medidos, 'FINO');
      mfValor = mfCalc?.valor ?? null;
    } catch { /* MF opcional para esta evaluación */ }
  }

  // PR8.1 — Evaluación MF según CIRSOC §3.2.3.2.g: variación ≤ 0.20 vs MF de
  // diseño de la dosificación. El rango fijo 2.3-3.1 (ASTM C 33) NO está en
  // CIRSOC ni en IRAM 1627, por lo cual se ELIMINA como criterio prescriptivo.
  // Si no se provee mfDiseno en el context → solo se reporta el valor sin
  // emitir warning. La regla NO descalifica el cumple global del agregado:
  // un MF desviado del diseño es WARNING, no NO_APTO. La decisión de aceptar
  // o rechazar la partida (ajustando proporciones) es del Director de Obra.
  const mfDiseno = (context?.mfDiseno != null) ? Number(context.mfDiseno) : null;
  let mfDelta = null;
  let estadoMF = 'sin_dato';
  if (mfValor != null && mfDiseno != null) {
    mfDelta = round2(mfValor - mfDiseno);
    estadoMF = Math.abs(mfDelta) <= 0.20 ? 'dentro_tolerancia' : 'desviado';
  } else if (mfValor != null) {
    estadoMF = 'sin_diseno';  // medido pero sin MF de diseño para comparar
  }

  const mfEval = {
    valor: mfValor,
    mfDiseno,
    delta: mfDelta,
    toleranciaMax: 0.20,
    estado: estadoMF,
    severidad: estadoMF === 'desviado' ? 'warning' : null,
    norma: 'CIRSOC 200:2024 §3.2.3.2.g',
    // `cumple` mantenido por backward-compat: ahora solo refleja el warning
    // (true si dentro_tolerancia, false si desviado, null si sin_dato/sin_diseno).
    cumple: estadoMF === 'dentro_tolerancia' ? true : (estadoMF === 'desviado' ? false : null),
  };

  // Estado consolidado (P0.9: badge y texto resumen DEBEN coincidir)
  const estadoBandaAB = bandaAB.cumple
    ? 'cumple'
    : (tolerancia.aplicable && tolerancia.cumple ? 'cumple_con_tolerancia' : 'no_cumple');
  const estadoBandaAC = bandaAC.cumple ? 'cumple' : 'no_cumple';
  const estadoFraccion = fraccion.cumple ? 'cumple' : 'no_cumple';

  // PR8.1 — campo `mf` en resultadoGlobal mantiene shape legacy
  // ('cumple'/'no_cumple'/'sin_dato') por compat de UI/PDF; se agrega
  // `mfEstado` y `mfWarning` con la nueva semántica.
  const mfLegacy = estadoMF === 'dentro_tolerancia'
    ? 'cumple'
    : estadoMF === 'desviado'
      ? 'no_cumple'
      : 'sin_dato';  // sin_diseno y sin_dato se reportan como sin_dato en legacy
  const resultadoGlobal = {
    bandaAB: estadoBandaAB,
    bandaAC: estadoBandaAC,
    mf: mfLegacy,
    mfEstado: estadoMF,                    // PR8.1 — estado completo nuevo
    mfWarning: estadoMF === 'desviado',    // PR8.1 — true si requiere ajuste proporciones
    fraccion: estadoFraccion,
  };

  // Implicancias: textos coherentes con los estados (cero contradicciones).
  // PR8.1: estadoMF puede ser 'dentro_tolerancia' (OK), 'desviado' (warning),
  // 'sin_diseno' (medido pero sin MF de diseño), o 'sin_dato' (no medido).
  const implicancias = [];
  const mfOk = estadoMF === 'dentro_tolerancia' || estadoMF === 'sin_diseno' || estadoMF === 'sin_dato';
  if (estadoBandaAB === 'cumple' && mfOk && estadoFraccion === 'cumple') {
    implicancias.push('Cumple todos los requisitos granulométricos para cualquier tipo de hormigón.');
  } else if (estadoBandaAB === 'cumple_con_tolerancia') {
    implicancias.push(
      `Cumple banda A-B aplicando la tolerancia §3.2.4 (excedencia total ${tolerancia.excesoTotal} pp <= 10 pp en tamices 1,18 / 600 / 300 µm).`
    );
  } else if (estadoBandaAB === 'no_cumple' && estadoBandaAC === 'cumple') {
    implicancias.push(
      'No cumple banda A-B (ni con tolerancia IRAM 1627 §3.2.4) pero sí cumple banda A-C.'
    );
    implicancias.push(
      'Liberación condicionada por CIRSOC 200:2024 §3.2.3.2 f) — exige resistencia <= H-20 Y evidencia técnica (estudios de laboratorio O antecedentes de obras similares). IRAM 1627 §3.2.5 (obras corrientes con control en obra) es referencia complementaria.'
    );
  } else if (estadoBandaAB === 'no_cumple' && estadoBandaAC === 'no_cumple') {
    implicancias.push('No cumple banda A-B ni banda A-C. No apta como fracción única para hormigón normalizado.');
  }
  // PR8.1 — MF: emitir warning solo si está desviado del MF de diseño.
  // Si NO hay MF de diseño en la dosificación, agregar nota informativa.
  if (estadoMF === 'desviado' && mfValor != null) {
    const direccion = mfDelta > 0 ? 'mayor' : 'menor';
    implicancias.push(
      `MF=${round2(mfValor)} difiere ${Math.abs(mfDelta)} unidades respecto al MF de diseño (${mfDiseno}). CIRSOC §3.2.3.2.g requiere variación <= 0.20: la partida debe ser RECHAZADA salvo que se ajusten las proporciones de la mezcla. La decisión final corresponde al Director de Obra.`
    );
  } else if (estadoMF === 'sin_diseno' && mfValor != null) {
    implicancias.push(
      `MF medido: ${round2(mfValor)}. La verificación CIRSOC §3.2.3.2.g (variación <= 0,20 respecto al MF de diseño) se realiza al asignar este agregado a una mezcla con MF de diseño definido.`
    );
  }
  if (estadoFraccion === 'no_cumple') {
    implicancias.push(
      `Fracción entre tamices ${fraccion.peorEntre} excede 45% (${fraccion.peorValor}%). Arena con tendencia monogranular.`
    );
  }

  // P0.13 — agregar implicancia explicando si se aplicó la reducción §3.2.3
  // o si el caso "sin contexto" mostraría una mejora con la curva reducida.
  if (efectiva.reducida) {
    implicancias.push(
      `Se aplicó reducción IRAM 1627 §3.2.3 a tamices 0,300 y 0,150 mm (curva A: 5/0 en lugar de 10/2). Justificación: ${efectiva.reduccion.motivo}.`
    );
  } else if (bandaAB_reducida && estadoBandaAB === 'no_cumple' && bandaAB_reducida.cumple) {
    // El caso típico que cambia el veredicto
    implicancias.push(
      'Esta arena CUMPLIRÍA la banda A-B aplicando la reducción §3.2.3 (curva A 5/0 en 0,300 y 0,150 mm), si el hormigón satisface alguna de: aire intencional >=3% + cemento >=250 kg/m³, cemento >=300 kg/m³, o aditivo mineral correctivo.'
    );
  }

  resultado.granulometria.evaluacionAuto = {
    tipo: 'granulometria_fino',
    bandaAB,
    bandaAC,
    bandaAB_reducida,    // P0.13 — null si se evaluó CON contexto; sino comparativo
    moduloFinura: mfEval,
    tolerancia_3_2_4: tolerancia,
    // Backward-compat: el shape antiguo era `tolerancia10pp`; mantenemos alias
    // hasta migrar todos los call sites del frontend.
    tolerancia10pp: { aplica: tolerancia.aplicable, excesoTotal: tolerancia.excesoTotal, cumple: tolerancia.cumple, detalle: tolerancia.detalle },
    fraccionMaxima: fraccion,
    reduccion_3_2_3: efectiva.reducida
      ? { aplicada: true, motivo: efectiva.reduccion.motivo, condicion: efectiva.reduccion.condicionAplicada, curvaAUsada }
      : { aplicada: false, motivo: 'No se aplicó (sin contexto o no se cumplen condiciones §3.2.3)' },
    resultadoGlobal,
    implicancias: implicancias.join('\n'),
  };

  return resultado;
}

/* ════════════════════════════════════════════════════════════════════════
   resolverCumpleGrueso  —  veredicto unificado para granulometría de grueso
   ────────────────────────────────────────────────────────────────────────
   La función pura vive en `domain/granulometria/resolverCumpleGrueso` desde
   la auditoría 01-calidad Fase C R2 (sesión 2026-05-07). Acá la
   re-exportamos para preservar el contrato del service (callers existentes
   en `agregadoEnsayoService.js` siguen funcionando sin cambios).

   Escenario: un agregado grueso puede traer DOS evaluaciones paralelas:
     - `evaluacion`           — contra la curva objetivo elegida por el usuario
                                (idCurvaObjetivo). Fuente explícita.
     - `evaluacionAutoGrueso` — contra Tabla 3.5 CIRSOC, con banda elegida por
                                heurística de TMN. Fuente automática.
   Las dos pueden discrepar cuando la heurística elige banda continua en un
   agregado fraccionado (p. ej. TMN=37,5 → "37,5 a 4,75" en vez de "37,5 a 19,0").
   El usuario conoce mejor el material que la heurística, así que:
     - Si hay curva objetivo y evaluación contra ella → esa dicta el cumple.
     - Si las dos difieren, se registra `_discrepanciaBanda` en el resultado
       para que la UI avise que la curva objetivo puede estar mal elegida.
     - Si no hay curva objetivo → se usa la auto-eval (comportamiento previo).
   Mutates `resultado` in-place (setea o borra `granulometria._discrepanciaBanda`).
   ════════════════════════════════════════════════════════════════════════ */
// Re-export del module de domain (la lógica vive ahí — función pura).
const { resolverCumpleGrueso } = require('../domain/granulometria/resolverCumpleGrueso');

module.exports = {
  normalizeMedidos,
  interpolarLogLineal,
  deducirPorSaturacion,
  resolverPasaPct,
  calcularModuloFinura,
  calcularTMN,
  evalAgainstSpec,
  resolverCumpleGrueso,
  // P0.9 — validador único IRAM 1627
  BANDA_FINO_IRAM1627,
  TAMICES_TOLERANCIA_3_2_4,
  REDUCCION_3_2_3,
  evalContraBandaFino,
  evalTolerancia_3_2_4,
  evalFraccionMaxima,
  evaluar_3_2_3,
  curvaAEfectiva,
  autoEvaluarGranulometriaFinoIRAM1627,
};
