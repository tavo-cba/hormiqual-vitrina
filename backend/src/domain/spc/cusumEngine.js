'use strict';

/**
 * cusumEngine — CUSUM tabular (Page 1954) para control estadístico de
 * resistencia de hormigón en HormiQual.
 *
 * Engine puro (sin DB, sin HTTP, sin Sequelize). Recibe datos materializados,
 * devuelve series acumuladas + alertas. Reutilizable desde ensayos
 * end-to-end, recálculo masivo o tests aislados.
 *
 * Contexto técnico
 * ----------------
 * El gráfico CUSUM de dos lados (V-mask alternativa: tabular, recomendada
 * por NIST/SEMATECH) detecta DESPLAZAMIENTOS PEQUEÑOS de la media (0,5σ–1,5σ)
 * que la carta Shewhart típicamente no flagea hasta que ocurra una violación
 * Western Electric. Para el caso de hormigón es relevante: una baja
 * sostenida de 0,7σ en la resistencia media (≈ 1 MPa para σ=1.5 MPa) puede
 * preceder un fail de aceptación CIRSOC §6.2.3 antes de que la carta de
 * control lo dispare.
 *
 * Parámetros estándar (NIST/SEMATECH §6.3.2):
 *   k = 0,5σ (slack) — distancia entre media objetivo y referencia.
 *   h = 4σ ó 5σ (decision interval) — umbral de alerta.
 *   ARL típico (Average Run Length) ≈ 8 con h=4, k=0,5 para shifts de 1σ.
 *
 * Output:
 *   { points: [{ idx, valor, cPlus, cMinus, alertaPlus, alertaMinus }],
 *     stats: { target, sigma, k, h, alertasPlus, alertasMinus, totalAlertas } }
 */

const DEFAULT_K_SIGMAS = 0.5;
const DEFAULT_H_SIGMAS = 4.0;

/**
 * Calcula CUSUM tabular de dos lados.
 *
 * @param {object} input
 * @param {Array<number>} input.values        Serie de mediciones (en orden cronológico).
 * @param {number}        input.target        Valor objetivo (ej. f'c).
 * @param {number}        input.sigma         Desviación estándar del proceso (no de la muestra).
 *                                            Si se desconoce, calcular desde un período "en control".
 * @param {number}        [input.kSigmas]     k en unidades de σ (default 0,5).
 * @param {number}        [input.hSigmas]     h en unidades de σ (default 4,0).
 * @returns {{
 *   points: Array<{ idx: number, valor: number, cPlus: number, cMinus: number,
 *                   alertaPlus: boolean, alertaMinus: boolean }>,
 *   stats: { target: number, sigma: number, k: number, h: number, kSigmas: number,
 *            hSigmas: number, alertasPlus: number, alertasMinus: number, totalAlertas: number }
 * }}
 */
function calcularCusum({ values, target, sigma, kSigmas = DEFAULT_K_SIGMAS, hSigmas = DEFAULT_H_SIGMAS }) {
  if (!Array.isArray(values) || values.length === 0) {
    return { points: [], stats: emptyStats(target, sigma, kSigmas, hSigmas) };
  }
  if (!Number.isFinite(target)) throw new Error('target debe ser un número finito');
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new Error('sigma debe ser un número finito positivo');
  }

  const k = kSigmas * sigma;
  const h = hSigmas * sigma;

  let cPlus = 0;
  let cMinus = 0;
  let alertasPlus = 0;
  let alertasMinus = 0;

  const points = values.map((v, idx) => {
    if (!Number.isFinite(v)) {
      // Mantener serie continua: cuando hay un null, no acumulamos pero
      // no reseteamos (el efecto del missing es informativo, no neutro).
      return { idx, valor: null, cPlus, cMinus, alertaPlus: false, alertaMinus: false };
    }
    cPlus = Math.max(0, cPlus + (v - target) - k);
    cMinus = Math.min(0, cMinus + (v - target) + k);
    const alertaPlus = cPlus > h;
    const alertaMinus = cMinus < -h;
    if (alertaPlus) alertasPlus += 1;
    if (alertaMinus) alertasMinus += 1;
    return {
      idx,
      valor: v,
      cPlus: round4(cPlus),
      cMinus: round4(cMinus),
      alertaPlus,
      alertaMinus,
    };
  });

  return {
    points,
    stats: {
      target,
      sigma,
      k: round4(k),
      h: round4(h),
      kSigmas,
      hSigmas,
      alertasPlus,
      alertasMinus,
      totalAlertas: alertasPlus + alertasMinus,
    },
  };
}

function emptyStats(target, sigma, kSigmas, hSigmas) {
  return {
    target: target ?? null,
    sigma: sigma ?? null,
    k: Number.isFinite(sigma) ? round4(kSigmas * sigma) : null,
    h: Number.isFinite(sigma) ? round4(hSigmas * sigma) : null,
    kSigmas, hSigmas,
    alertasPlus: 0,
    alertasMinus: 0,
    totalAlertas: 0,
  };
}

function round4(x) {
  if (!Number.isFinite(x)) return x;
  return Math.round(x * 10000) / 10000;
}

module.exports = {
  calcularCusum,
  DEFAULT_K_SIGMAS,
  DEFAULT_H_SIGMAS,
};
