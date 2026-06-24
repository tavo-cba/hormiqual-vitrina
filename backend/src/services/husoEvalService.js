// src/services/husoEvalService.js
/**
 * Evaluación de una curva granulométrica contra un huso DNV.
 *
 * Para cada tamiz del huso:
 *   - Si la abertura está exactamente en la curva medida → se usa ese valor.
 *   - Si no está, se interpola logarítmicamente desde los puntos adyacentes
 *     de la curva medida.
 *   - Se compara contra [pasaPctMin, pasaPctMax] con una tolerancia mínima
 *     (EPS = 0.05) para absorber errores de coma flotante.
 *
 * Devuelve un reporte estructurado con una fila por tamiz del huso + el
 * veredicto global (cumple todos los tamices vs no cumple alguno).
 *
 * Consumido por:
 *   - agregadoEnsayoService: al crear/actualizar ensayos TBS con
 *     `idHusoDnvReferencia` declarado, para calcular `cumple` automático.
 *   - ensayoRenderers (PDF): para dibujar la tabla "Evaluación contra Huso DNV".
 */

'use strict';

// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// Original: const { interpolarPasaPct } = require('./dotacionObraCalc'); (módulo TBS/DNV).
// `interpolarPasaPct` es una interpolación granulométrica genérica que la vertical
// necesita para evaluar curvas contra husos; se inlinea aquí (copia fiel del original).
function interpolarPasaPct(curva, aberturaMm) {
    if (!Array.isArray(curva) || curva.length === 0) return null;
    const puntos = curva
        .filter((p) => p.aberturaMm != null && p.pasaPct != null)
        .map((p) => ({ aberturaMm: Number(p.aberturaMm), pasaPct: Number(p.pasaPct) }))
        .sort((a, b) => a.aberturaMm - b.aberturaMm);
    if (puntos.length === 0) return null;
    const objetivo = Number(aberturaMm);
    const exacto = puntos.find((p) => p.aberturaMm === objetivo);
    if (exacto) return exacto.pasaPct;
    if (objetivo > puntos[puntos.length - 1].aberturaMm) return 100;
    if (objetivo < puntos[0].aberturaMm) return 0;
    for (let i = 0; i < puntos.length - 1; i++) {
        const a = puntos[i];
        const b = puntos[i + 1];
        if (objetivo > a.aberturaMm && objetivo < b.aberturaMm) {
            const t = (objetivo - a.aberturaMm) / (b.aberturaMm - a.aberturaMm);
            return Math.round((a.pasaPct + t * (b.pasaPct - a.pasaPct)) * 100) / 100;
        }
    }
    return null;
}

const EPS = 0.05;

/**
 * @param {Array<{aberturaMm, pasaPct}>} curvaEnsayo - puntos medidos
 * @param {Array<{aberturaMm, pasaPctMin, pasaPctMax, designacion?}>} husoPuntos
 * @returns {{ cumple, filas, violaciones }}
 */
function evaluarCurvaContraHuso(curvaEnsayo, husoPuntos) {
    const filas = (husoPuntos || []).map((p) => {
        const ab = Number(p.aberturaMm);
        const min = Number(p.pasaPctMin);
        const max = Number(p.pasaPctMax);
        const valor = interpolarPasaPct(curvaEnsayo, ab);

        let cumple = true;
        let motivo = null;
        let desvio = 0;

        if (valor == null) {
            cumple = false;
            motivo = 'sin_dato';
        } else if (valor < min - EPS) {
            cumple = false;
            motivo = 'por_debajo';
            desvio = Math.round((valor - min) * 100) / 100;
        } else if (valor > max + EPS) {
            cumple = false;
            motivo = 'por_encima';
            desvio = Math.round((valor - max) * 100) / 100;
        }

        const exacto = (curvaEnsayo || []).some(
            (c) => Math.abs(Number(c.aberturaMm) - ab) < 0.001 && c.pasaPct != null,
        );

        return {
            aberturaMm: ab,
            designacion: p.designacion,
            pasaMedido: valor,
            interpolado: valor != null && !exacto,
            min,
            max,
            cumple,
            motivo,
            desvio,
        };
    }).sort((a, b) => b.aberturaMm - a.aberturaMm);

    const violaciones = filas.filter((f) => !f.cumple);
    return {
        cumple: violaciones.length === 0,
        filas,
        violaciones,
    };
}

module.exports = {
    evaluarCurvaContraHuso,
};
