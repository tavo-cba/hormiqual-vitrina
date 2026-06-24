'use strict';

/**
 * granulometriaMezcla.js — Verificación granulométrica a NIVEL 2 (mezcla
 * combinada) contra las bandas IRAM 1627 / CIRSOC 200 §3.4.
 *
 * ─── Separación de niveles (auditoría 01-calidad R1, sesión 2026-05-07) ──
 *
 *   Nivel 1 — agregado individual:
 *     Cada agregado FINO se evalúa con `IRAM1505_GRANULOMETRIA` (motor de
 *     ensayos) + `services/granulometriaEvalService.js`, que aplica las 5
 *     reglas de CIRSOC 200 §3.2.3.2 sobre el AF:
 *       - §3.2.3.2.b/d: bandas A-B/A-C de la Tabla 1 IRAM 1627 + tolerancia
 *         10 pp en tamices 1,18 / 0,600 / 0,300 mm.
 *       - §3.2.3.2.b: MF en rango absoluto 2,3-3,1 (verificación adicional
 *         en `aptitudMaterialesEngine`).
 *       - §3.2.3.2.e: fracción retenida entre tamices consecutivos ≤ 45%.
 *       - §3.2.3.2.g: variación MF ≤ 0,20 vs MF de diseño (PR8.1).
 *     Estas reglas aplican al AF individual; NO se replican aquí.
 *
 *   Nivel 2 — mezcla combinada (este módulo):
 *     Una vez consolidada la dosificación, la curva del agregado total se
 *     evalúa contra IRAM 1627 §3.4 (Tablas 3-8 por TMN, curvas A/B/C):
 *       - Cumple A-B → pass.
 *       - Cumple A-C pero no A-B → conditionalPass con
 *         `requires_technical_evidence` (CIRSOC 200 §3.2.3.2 f).
 *       - No cumple ninguna → fail.
 *     IRAM 1627 NO define para la mezcla combinada: tolerancia adicional,
 *     MF (rango ni variación), ni fracción 45%. Esas reglas son del AF.
 *
 * ─── Estado de implementación ─────────────────────────────────────────
 *
 * Este módulo absorbe la lógica de `evaluarBandaDualIRAM1627` que vivía
 * en `services/mezclaService.js:571-662` con shape canónico nativo. La
 * firma `(designMix, usageContext) → ComplianceResult` queda fijada.
 *
 * El módulo está completo respecto a IRAM 1627 §3.4. Si en el futuro la
 * norma agrega reglas explícitas para mezcla combinada (ej. tolerancia
 * por TMN intermedio o interpolación entre bandas adyacentes) se suman
 * acá sin romper el shape de retorno.
 */

const { Compliance } = require('./ComplianceResult');

/**
 * Verifica una curva granulométrica de mezcla combinada contra las bandas
 * IRAM 1627 para el TMN dado.
 *
 * Pureza arquitectónica (auditoría 01-calidad Fase C R2):
 *   El engine es puro: NO carga tablas IRAM ni accede a disco/DB. El caller
 *   (service) provee la tabla normativa y el evaluador pre-cargados.
 *
 * @param {Object} designMix - { curvaMix, tmnMm, ... }
 *   - `curvaMix`: Array<{ aberturaMm: number, pasaPct: number }>
 *   - `tmnMm`: number — Tamaño máximo nominal de la mezcla combinada
 * @param {Object} [usageContext] - Reservado para Prompt 5 (clase de
 *   exposición puede modular la tolerancia). Hoy NO se usa.
 * @param {Object} [deps] - Dependencias inyectadas por el caller (services).
 *   - `bandasIRAM1627Tablas`: objeto con shape { [tmnStr]: { curvas: { A, B, C? }, referenciaTabla? } }
 *     Cargado típicamente por `services/importIRAM1627Service.loadSeedData().totales.tablas`.
 *   - `evalContraSpec({medidos, spec})`: función pura que evalúa la curva
 *     medida contra la spec en formato { specMode: 'RANGO', puntos: [...] }.
 *     Cargada típicamente desde `services/granulometriaEvalService.evalAgainstSpec`.
 *   - Si falta cualquier dependencia, retorna `notEvaluated` con la razón.
 * @returns {ComplianceResult}
 */
function evaluarGranulometriaMezcla(designMix, usageContext = {}, deps = {}) {
  if (!designMix || !Array.isArray(designMix.curvaMix) || designMix.curvaMix.length === 0) {
    return Compliance.notEvaluated({
      reason: 'Sin curva combinada para evaluar contra IRAM 1627',
      norm: 'IRAM 1627',
    });
  }
  const tmnMm = Number(designMix.tmnMm);
  if (!Number.isFinite(tmnMm) || tmnMm <= 0) {
    return Compliance.notEvaluated({
      reason: 'TMN de mezcla no especificado o inválido',
      norm: 'IRAM 1627',
    });
  }

  const { bandasIRAM1627Tablas, evalContraSpec } = deps;
  if (!bandasIRAM1627Tablas) {
    return Compliance.notEvaluated({
      reason: 'Tablas IRAM 1627 no provistas al engine. El caller (service) debe inyectarlas via deps.bandasIRAM1627Tablas.',
      norm: 'IRAM 1627',
    });
  }
  if (typeof evalContraSpec !== 'function') {
    return Compliance.notEvaluated({
      reason: 'Evaluador contra-spec no provisto al engine. El caller (service) debe inyectarlo via deps.evalContraSpec.',
      norm: 'IRAM 1627',
    });
  }

  const tabla = _resolverTablaIRAM1627(tmnMm, bandasIRAM1627Tablas);
  if (!tabla?.curvas?.A || !tabla.curvas.B) {
    return Compliance.notEvaluated({
      reason: `Sin tabla IRAM 1627 para TMN ${tmnMm} mm (ni cercana ±5 mm)`,
      norm: 'IRAM 1627',
    });
  }

  const tablaRef = tabla.referenciaTabla || `Tabla IRAM 1627 TMN ${tmnMm}`;
  const tamicesMix = designMix.curvaMix
    .filter(p => (p.pasaPct ?? p.pasa) != null)
    .map(p => ({
      aberturaMm: p.aberturaMm ?? p.abertura,
      pasaPct: p.pasaPct ?? p.pasa,
      tamiz: p.tamiz || `${p.aberturaMm} mm`,
    }));

  // Banda A-B (estricta)
  const bandaAB = _buildBandaPuntos(tabla.curvas.A, tabla.curvas.B);
  const evalAB = _evalContraBanda(tamicesMix, bandaAB, evalContraSpec);

  if (evalAB.cumple) {
    return Compliance.pass({
      message: `Cumple banda A-B (${tablaRef}). ${tamicesMix.length} tamices comparados.`,
      norm: `IRAM 1627 / ${tablaRef}`,
      details: ['Banda A-B: cumple'],
    });
  }

  // Banda A-C (ampliada) — solo si la tabla la trae
  let evalAC = null;
  if (tabla.curvas.C) {
    const bandaAC = _buildBandaPuntos(tabla.curvas.A, tabla.curvas.C);
    evalAC = _evalContraBanda(tamicesMix, bandaAC, evalContraSpec);
  }

  if (evalAC?.cumple) {
    // Cumple A-C pero NO A-B → conditionalPass por CIRSOC §3.2.3.2 f).
    // Requiere evidencia técnica: estudios de laboratorio o antecedentes.
    return Compliance.conditionalPass({
      conditions: [{
        kind: 'requires_documentation',
        key: 'requires_technical_evidence',
        value: ['lab_study', 'prior_project'],
        description: 'La curva de la mezcla cumple banda A-C pero excede ' +
          'banda A-B. CIRSOC §3.2.3.2 f) exige evidencia técnica: estudios ' +
          'de laboratorio O antecedentes documentados de obras similares.',
        source: 'CIRSOC 200 §3.2.3.2 f) / IRAM 1627',
      }],
      message: `Cumple banda A-C, no banda A-B. ${evalAB.nFuera} tamiz(es) ` +
        `fuera de A-B (desvío máx ${evalAB.maxDesvioAbs.toFixed(1)} pp). ${tablaRef}.`,
      norm: `IRAM 1627 / ${tablaRef}`,
      details: [
        'Banda A-B: no cumple',
        `${evalAB.nFuera} tamiz(es) fuera, desvío máximo ${evalAB.maxDesvioAbs.toFixed(1)} pp`,
        'Banda A-C: cumple',
      ],
    });
  }

  // No cumple ni A-C
  const ref = evalAC || evalAB;
  return Compliance.fail({
    reasons: [
      `La mezcla combinada no cumple banda ${evalAC ? 'A-C' : 'A-B'} de ${tablaRef}: ` +
      `${ref.nFuera} tamiz(es) fuera (desvío máx ${ref.maxDesvioAbs.toFixed(1)} pp).`,
    ],
    norm: `IRAM 1627 / ${tablaRef}`,
    details: ref.fueraDeBanda?.map(f =>
      `${f.tamiz || f.aberturaMm + ' mm'}: ${f.pasaPct ?? '?'}% (banda [${f.limInfPct ?? '?'}, ${f.limSupPct ?? '?'}])`
    ) || [],
    severity: 'bloqueante',
  });
}

/* ─────────────── Helpers internos ─────────────── */

/**
 * Resuelve la tabla IRAM 1627 para un TMN dado a partir del objeto pre-cargado
 * por el caller. Si no hay coincidencia exacta, busca la más cercana dentro
 * de ±5 mm (mismo criterio que `mezclaService.evaluarBandaDualIRAM1627`).
 *
 * @param {number} tmnMm
 * @param {Object} tablas - shape { [tmnStr]: { curvas: { A, B, C? }, ... } }
 *   Inyectado por el caller (sin acceso a disco/DB desde el engine).
 */
function _resolverTablaIRAM1627(tmnMm, tablas) {
  if (!tablas || typeof tablas !== 'object') return null;
  let tabla = tablas[String(tmnMm)];
  if (!tabla) {
    const keys = Object.keys(tablas).map(Number)
      .sort((a, b) => Math.abs(a - tmnMm) - Math.abs(b - tmnMm));
    if (keys.length > 0 && Math.abs(keys[0] - tmnMm) <= 5) {
      tabla = tablas[String(keys[0])];
    }
  }
  return tabla || null;
}

/**
 * Construye los puntos de banda dual a partir de las curvas low/high.
 * Match por abertura aproximada (±5% + 0.01 mm de tolerancia).
 */
function _buildBandaPuntos(curvaLow, curvaHigh) {
  return curvaLow.map(pL => {
    const pH = curvaHigh.find(p =>
      Math.abs(p.aberturaMm - pL.aberturaMm) < pL.aberturaMm * 0.05 + 0.01
    );
    return pH
      ? { aberturaMm: pL.aberturaMm, tamiz: `${pL.aberturaMm} mm`, limInfPct: pL.target, limSupPct: pH.target, isNA: false }
      : null;
  }).filter(Boolean);
}

/**
 * Evalúa los tamices de la mezcla contra la banda dada usando el evaluador
 * inyectado por el caller. La función `evalContraSpec` debe tener la firma
 * `({ medidos, spec }) => { fueraDeBanda, series, stats }` (típicamente la
 * exportada por `services/granulometriaEvalService.evalAgainstSpec`).
 */
function _evalContraBanda(tamicesMix, bandaPuntos, evalContraSpec) {
  const result = evalContraSpec({
    medidos: tamicesMix,
    spec: { specMode: 'RANGO', puntos: bandaPuntos },
  });
  const fueraDeBanda = result.fueraDeBanda || [];
  const nFuera = fueraDeBanda.length;
  const maxDesvioAbs = fueraDeBanda.reduce((m, f) => Math.max(m, Math.abs(f.desvio || 0)), 0);
  return {
    cumple: nFuera === 0,
    nFuera,
    maxDesvioAbs,
    fueraDeBanda,
    series: result.series,
    stats: result.stats,
  };
}

module.exports = {
  evaluarGranulometriaMezcla,
  // Privados expuestos para tests y reutilización por el wrapper en mezclaService.
  _resolverTablaIRAM1627,
  _buildBandaPuntos,
  _evalContraBanda,
};
