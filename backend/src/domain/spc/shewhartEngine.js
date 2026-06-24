'use strict';

/**
 * Shewhart Stats Engine (puro).
 *
 * CTL-29 / A4 (sesión 2026-05-10) — refactor de controlCalidadService:
 * las stats de la carta de control eran funciones puras pero vivían en
 * `services/`. Acá quedan en `domain/spc/` como motor reutilizable.
 *
 * Devuelve la media, σ muestral (n-1 en el denominador) y los límites
 * UCL/LCL a 1σ, 2σ y 3σ para construir la carta Shewhart.
 *
 * Referencias:
 *   - Shewhart W. A. (1931). "Economic Control of Quality of Manufactured
 *     Product".
 *   - NIST/SEMATECH e-Handbook of Statistical Methods §6.3.2.
 *
 * Comportamiento con n < 2: σ = 0 (no se puede estimar dispersión), los
 * UCL/LCL coinciden con la media. El caller debe filtrar esos casos
 * antes de mostrar veredictos.
 */

const round2 = (n) => Math.round((n || 0) * 100) / 100;

/**
 * Calcula la media y σ muestral (Bessel: dividir por n-1).
 *
 * @param {number[]} values
 * @returns {{ n: number, mean: number, sd: number, variance: number }}
 *          Valores crudos, sin redondear.
 */
function computeMeanSd(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return { n: 0, mean: 0, sd: 0, variance: 0 };
    }
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1
        ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)
        : 0;
    const sd = Math.sqrt(variance);
    return { n, mean, sd, variance };
}

/**
 * Stats completas para una carta Shewhart: media, σ, UCL/LCL a 1σ/2σ/3σ.
 *
 * @param {number[]} values
 * @returns {{
 *   n: number, mean: number, sd: number,
 *   ucl: number, lcl: number,
 *   ucl2: number, lcl2: number,
 *   ucl1: number, lcl1: number,
 * } | null}
 *   `null` si no hay valores. Todos los números redondeados a 2 decimales
 *   para presentación en UI (espejo del comportamiento previo en services).
 */
function computeShewhartStats(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const { n, mean, sd } = computeMeanSd(values);
    return {
        mean: round2(mean),
        sd: round2(sd),
        ucl: round2(mean + 3 * sd),
        lcl: round2(mean - 3 * sd),
        ucl2: round2(mean + 2 * sd),
        lcl2: round2(mean - 2 * sd),
        ucl1: round2(mean + sd),
        lcl1: round2(mean - sd),
        n,
    };
}

module.exports = {
    computeMeanSd,
    computeShewhartStats,
};
