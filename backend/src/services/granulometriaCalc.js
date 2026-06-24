'use strict';

/**
 * granulometriaCalc.js
 * Server-side granulometric calculations:
 *   - % retenido individual
 *   - % retenido acumulado
 *   - % pasa (= 100 - ret acum)
 *   - Módulo de finura (MF) for fine aggregates
 *   - TMN (tamaño máximo nominal) for coarse aggregates
 *   - Monotonicity validation
 *   - Min tamices check
 */

/* ── Tamices — importados del catálogo centralizado ───── */
const {
  TAMICES_IRAM,
  TAMICES_ASTM,
  MF_ABERTURAS,
  EQUIVALENT_SIEVES,
  MONOTONICITY_TOLERANCE,
  MIN_TAMICES_REVISADO,
} = require('../catalog/tamicesCatalog');

/**
 * Compute all granulometric calculations from tamices data.
 * @param {Array<{tamiz:string, aberturaMm:number, pasaPct:number}>} tamices
 * @param {string} tipoAgregado - 'FINO'|'GRUESO'|'MEZCLA' (optional, will be inferred)
 * @returns {{ calculos, faltantesGrano, erroresGrano }}
 */
function computeGranulometria(tamices, tipoAgregado) {
  const errores = [];
  const warnings = [];

  if (!Array.isArray(tamices) || tamices.length === 0) {
    return {
      calculos: null,
      faltantesGrano: ['tamices'],
      erroresGrano: ['No se proporcionaron datos de tamices'],
    };
  }

  // Filter enabled tamices and sort by abertura descending
  const datos = tamices
    .filter((t) => t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== '')
    .map((t) => ({
      tamiz: t.tamiz,
      aberturaMm: Number(t.aberturaMm) || 0,
      pasaPct: Number(t.pasaPct),
    }))
    .sort((a, b) => b.aberturaMm - a.aberturaMm);

  if (datos.length < 2) {
    return {
      calculos: { retenidoPctPorTamiz: [], retenidoAcumPct: [], moduloFinura: null, tmnMm: null, validaMonotonia: false, erroresValidacion: ['Se necesitan al menos 2 tamices con datos'] },
      faltantesGrano: datos.length === 0 ? ['tamices'] : [],
      erroresGrano: ['Se necesitan al menos 2 tamices con datos'],
    };
  }

  // Validate pasaPct range
  for (const d of datos) {
    if (d.pasaPct < 0 || d.pasaPct > 100) {
      errores.push(`${d.tamiz}: % pasa debe estar entre 0 y 100 (valor: ${d.pasaPct})`);
    }
  }

  // Compute retenido individual and acumulado
  const retenidoPctPorTamiz = [];
  const retenidoAcumPct = [];
  let acum = 0;

  for (let i = 0; i < datos.length; i++) {
    const retenido = i === 0 ? (100 - datos[i].pasaPct) : (datos[i - 1].pasaPct - datos[i].pasaPct);
    acum += Math.max(0, retenido);
    retenidoPctPorTamiz.push({
      tamiz: datos[i].tamiz,
      aberturaMm: datos[i].aberturaMm,
      retenidoPct: Math.round(Math.max(0, retenido) * 100) / 100,
    });
    retenidoAcumPct.push({
      tamiz: datos[i].tamiz,
      aberturaMm: datos[i].aberturaMm,
      retenidoAcumPct: Math.round(acum * 100) / 100,
    });
  }

  // Monotonicity check: % pasa should decrease (or stay equal) as abertura decreases
  let validaMonotonia = true;
  for (let i = 1; i < datos.length; i++) {
    if (datos[i].pasaPct > datos[i - 1].pasaPct + MONOTONICITY_TOLERANCE) {
      validaMonotonia = false;
      errores.push(
        `Monotonicidad: ${datos[i].tamiz} (${datos[i].pasaPct}%) > ${datos[i - 1].tamiz} (${datos[i - 1].pasaPct}%)`
      );
    }
  }

  // Infer tipo if not provided
  let inferredTipo = tipoAgregado || null;
  if (!inferredTipo) {
    // If 4.75mm sieve exists and pasa >= 85%, likely fine aggregate
    const tamiz4_75 = datos.find((d) => Math.abs(d.aberturaMm - 4.75) < 0.01);
    if (tamiz4_75) {
      inferredTipo = tamiz4_75.pasaPct >= 85 ? 'FINO' : 'GRUESO';
    } else {
      // If smallest abertura <= 0.3mm, probably fine
      const smallest = datos[datos.length - 1].aberturaMm;
      inferredTipo = smallest <= 0.3 ? 'FINO' : 'GRUESO';
    }
  }

  // Módulo de Finura (for fine aggregates, sum of %ret.acum for specific sieves / 100)
  let moduloFinura = null;
  if (inferredTipo === 'FINO' || inferredTipo === 'MEZCLA') {
    // Build equivalences lookup (53↔50, 26.5↔25, 13.2↔12.5)
    const mfEquivMap = new Map();
    for (const [stdAb, altAb] of EQUIVALENT_SIEVES) {
      if (!mfEquivMap.has(stdAb)) mfEquivMap.set(stdAb, []);
      mfEquivMap.get(stdAb).push(altAb);
      if (!mfEquivMap.has(altAb)) mfEquivMap.set(altAb, []);
      mfEquivMap.get(altAb).push(stdAb);
    }
    let sumRetAcum = 0;
    let mfCount = 0;
    for (const ab of MF_ABERTURAS) {
      let match = retenidoAcumPct.find((r) => Math.abs(r.aberturaMm - ab) < 0.01);
      // Fallback to equivalent sieve if nominal not present
      if (!match && mfEquivMap.has(ab)) {
        for (const altAb of mfEquivMap.get(ab)) {
          match = retenidoAcumPct.find((r) => Math.abs(r.aberturaMm - altAb) < 0.01);
          if (match) break;
        }
      }
      if (match) {
        sumRetAcum += match.retenidoAcumPct;
        mfCount++;
      }
    }
    if (mfCount >= 3) {
      moduloFinura = Math.round((sumRetAcum / 100) * 100) / 100;
    } else {
      warnings.push('No hay suficientes tamices estándar para calcular MF con precisión');
    }
  }

  // TMN — Tamaño Máximo Nominal (for coarse aggregates)
  // TMN = smallest sieve where ret.acum >= 15% ... or more practically:
  // the largest sieve that retains ≤ 5% (some variants exist)
  // We use: TMN = first sieve (from largest) where %pasa is between 90-100%
  let tmnMm = null;
  if (inferredTipo === 'GRUESO' || inferredTipo === 'MEZCLA') {
    for (let i = 0; i < datos.length; i++) {
      if (datos[i].pasaPct < 100) {
        // TMN is the first sieve that retains material, using ASTM C125 definition
        // TMN = one sieve size larger than the first sieve to retain more than 10%
        if ((100 - datos[i].pasaPct) > 10) {
          tmnMm = i > 0 ? datos[i - 1].aberturaMm : datos[i].aberturaMm;
          break;
        }
      }
    }
    // Fallback: first sieve where passes < 95%
    if (tmnMm === null) {
      for (const d of datos) {
        if (d.pasaPct < 95) {
          tmnMm = d.aberturaMm;
          break;
        }
      }
    }
  }

  // Check for 75µm data
  const has75um = datos.some((d) => Math.abs(d.aberturaMm - 0.075) < 0.01);
  if (!has75um) {
    warnings.push('No se incluyó tamiz 75 µm (N° 200) — considere agregarlo');
  }

  // Enough tamices check
  if (datos.length < MIN_TAMICES_REVISADO) {
    warnings.push(`Se requieren al menos ${MIN_TAMICES_REVISADO} tamices para marcar como Revisado (hay ${datos.length})`);
  }

  const allErrors = [...errores, ...warnings];

  return {
    calculos: {
      retenidoPctPorTamiz,
      retenidoAcumPct,
      moduloFinura,
      tmnMm,
      tipoInferido: inferredTipo,
      validaMonotonia,
      cantidadTamices: datos.length,
      erroresValidacion: allErrors,
    },
    faltantesGrano: [],
    erroresGrano: errores, // only hard errors, not warnings
  };
}

/**
 * Check if granulometría data is ready for REVISADO
 */
function canMarcarRevisadoGranulometria(calculos, erroresGrano) {
  if (!calculos) return false;
  if (erroresGrano && erroresGrano.length > 0) return false;
  if (calculos.cantidadTamices < MIN_TAMICES_REVISADO) return false;
  if (!calculos.validaMonotonia) return false;
  return true;
}

/* ═══════════════════════════════════════════════════════════
   Fórmulas de curvas teóricas  (centralizadas)
   ═══════════════════════════════════════════════════════════ */

/**
 * Normaliza parámetros: acepta tanto claves nuevas (formulaKey, D)
 * como claves legacy (formula, dmax).
 */
function normalizeFormulaParams(raw) {
  if (!raw) return {};
  // Handle JSON-string parametros (common with MariaDB / bulkInsert)
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const p = { ...parsed };
  if (p.formulaKey && !p.formula) p.formula = p.formulaKey;
  if (p.formula && !p.formulaKey) p.formulaKey = p.formula;
  if (p.D != null && p.dmax == null) p.dmax = p.D;
  if (p.dmax != null && p.D == null) p.D = p.dmax;
  return p;
}

/**
 * Fuller / Talbot: P = 100 × (d / D)^n
 */
function fullerPct(d, params) {
  const D = params.D || params.dmax || 25;
  const n = params.n || 0.5;
  if (d >= D) return 100;
  if (d <= 0) return 0;
  return 100 * Math.pow(d / D, n);
}

/**
 * Andreasen & Andersen (original): P = 100 × (d / D)^q
 * Si se provee dmin, actúa como corte inferior (P = 0 para d ≤ dmin).
 */
function andreasenPct(d, params) {
  const D = params.D || params.dmax || 25;
  const q = params.q || 0.37;
  const dmin = params.dmin || 0;
  if (d >= D) return 100;
  if (d <= 0 || d <= dmin) return 0;
  return 100 * Math.pow(d / D, q);
}

/**
 * Funk & Dinger (Modified Andreasen-Andersen):
 * P = 100 × (d^q - dmin^q) / (D^q - dmin^q)
 */
function modifiedAAPct(d, params) {
  const D = params.D || params.dmax || 25;
  const dmin = params.dmin || 0.075;
  const q = params.q || 0.37;
  if (d >= D) return 100;
  if (d <= dmin) return 0;
  const numerator = Math.pow(d, q) - Math.pow(dmin, q);
  const denominator = Math.pow(D, q) - Math.pow(dmin, q);
  if (denominator <= 0) return 0;
  return 100 * numerator / denominator;
}

/**
 * Rosin-Rammler: P = 100 × (1 - exp(-(d/x)^k))
 * x = parámetro de escala (mm), k = parámetro de forma.
 * D opcional: si se provee, normaliza a P(D)=100.
 */
function rosinRammlerPct(d, params) {
  const x = params.x || 12.5;
  const k = params.k || 2.0;
  const D = params.D || params.dmax || null;
  if (d <= 0) return 0;
  if (D && d >= D) return 100;
  let P = 100 * (1 - Math.exp(-Math.pow(d / x, k)));
  if (D && D > 0) {
    const PD = 100 * (1 - Math.exp(-Math.pow(D / x, k)));
    if (PD > 0) P = P / PD * 100;
  }
  return P;
}

/**
 * Mapa canónico de fórmulas.
 * Claves canónicas + legacy para backward compatibility.
 */
const FORMULA_MAP = {
  // Canónicas
  FULLER_TALBOT:   fullerPct,
  ANDREASEN:       andreasenPct,
  ANDREASEN_MOD:   modifiedAAPct,
  ROSIN_RAMMLER:   rosinRammlerPct,
  // Legacy
  fuller:          fullerPct,
  andreasen:       andreasenPct,
  modified_aa:     modifiedAAPct,
};

/**
 * Case-insensitive formula lookup.  Tries exact → UPPER → lower → known aliases.
 */
function resolveFormula(key) {
  if (!key) return null;
  return FORMULA_MAP[key]
    || FORMULA_MAP[key.toUpperCase()]
    || FORMULA_MAP[key.toLowerCase()]
    || FORMULA_MAP[key.replace(/[\s-]/g, '_').toUpperCase()]
    || null;
}

module.exports = {
  computeGranulometria,
  canMarcarRevisadoGranulometria,
  TAMICES_IRAM,
  TAMICES_ASTM,
  MF_ABERTURAS,
  MIN_TAMICES_REVISADO,
  MONOTONICITY_TOLERANCE,
  // Fórmulas de curvas teóricas
  normalizeFormulaParams,
  resolveFormula,
  fullerPct,
  andreasenPct,
  modifiedAAPct,
  rosinRammlerPct,
  FORMULA_MAP,
};
