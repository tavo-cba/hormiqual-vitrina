'use strict';

/**
 * Western Electric Rules Engine (puro).
 *
 * CTL-29 / A4 (sesión 2026-05-10) — refactor de controlCalidadService.
 *
 * Detecta patrones de "fuera de control estadístico" sobre una serie
 * temporal de valores de la carta Shewhart, usando las 4 reglas clásicas
 * del Western Electric Handbook (1956):
 *
 *   1. Un punto fuera de ±3σ del centerline.
 *   2. 2 de 3 puntos consecutivos fuera de ±2σ del mismo lado.
 *   3. 4 de 5 puntos consecutivos fuera de ±1σ del mismo lado.
 *   4. 8 puntos consecutivos del mismo lado del centerline.
 *
 * Referencias:
 *   - Western Electric Co. (1956). "Statistical Quality Control Handbook".
 *   - NIST/SEMATECH e-Handbook §6.3.2.
 *
 * Devuelve violaciones con shape:
 *   {
 *     index: number,         // punto que dispara la violación (último del patrón)
 *     rule:  1 | 2 | 3 | 4,
 *     range: [start, end],   // rango del patrón completo (inclusivo)
 *     side:  'above' | 'below',
 *     message: string,
 *   }
 *
 * Si sd = 0 (todos los puntos iguales) o values vacío → devuelve [].
 * Los duplicados (mismo index+rule) se filtran al final.
 */

const round2 = (n) => Math.round((n || 0) * 100) / 100;

function evaluateWesternElectric(values, mean, sd) {
    if (!Array.isArray(values) || values.length === 0) return [];
    if (sd === 0 || !Number.isFinite(sd)) return [];

    const violations = [];

    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const z = (v - mean) / sd;

        // Rule 1: One point beyond 3σ
        if (Math.abs(z) > 3) {
            violations.push({
                index: i, rule: 1,
                range: [i, i],
                side: z > 0 ? 'above' : 'below',
                message: `Punto #${i + 1} fuera de 3σ (z=${round2(z)})`,
            });
        }

        // Rule 2: 2 of 3 consecutive beyond 2σ (same side)
        if (i >= 2) {
            const window = [values[i - 2], values[i - 1], values[i]];
            const above2 = window.filter(w => (w - mean) / sd > 2).length;
            const below2 = window.filter(w => (w - mean) / sd < -2).length;
            if (above2 >= 2 || below2 >= 2) {
                violations.push({
                    index: i, rule: 2,
                    range: [i - 2, i],
                    side: above2 >= 2 ? 'above' : 'below',
                    message: `2 de 3 puntos consecutivos fuera de 2σ (índices ${i - 1}–${i + 1})`,
                });
            }
        }

        // Rule 3: 4 of 5 consecutive beyond 1σ (same side)
        if (i >= 4) {
            const window = values.slice(i - 4, i + 1);
            const above1 = window.filter(w => (w - mean) / sd > 1).length;
            const below1 = window.filter(w => (w - mean) / sd < -1).length;
            if (above1 >= 4 || below1 >= 4) {
                violations.push({
                    index: i, rule: 3,
                    range: [i - 4, i],
                    side: above1 >= 4 ? 'above' : 'below',
                    message: `4 de 5 puntos consecutivos fuera de 1σ (índices ${i - 3}–${i + 1})`,
                });
            }
        }

        // Rule 4: 8 consecutive points on one side of centerline
        if (i >= 7) {
            const window = values.slice(i - 7, i + 1);
            const allAbove = window.every(w => w > mean);
            const allBelow = window.every(w => w < mean);
            if (allAbove || allBelow) {
                violations.push({
                    index: i, rule: 4,
                    range: [i - 7, i],
                    side: allAbove ? 'above' : 'below',
                    message: `8 puntos consecutivos del mismo lado (índices ${i - 6}–${i + 1})`,
                });
            }
        }
    }

    // Deduplicate by index+rule (mantiene el rango completo del primer match).
    const seen = new Set();
    return violations.filter(v => {
        const key = `${v.index}-${v.rule}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

module.exports = { evaluateWesternElectric };
