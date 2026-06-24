'use strict';

/**
 * modoProduccionEngine.js — PR8.18
 *
 * Conformidad de lotes de hormigón estructural según el Modo de Producción
 * de la Planta (CIRSOC 200-2024 §6.2). Las fórmulas y tolerancias viven en
 * la SSoT `domain/normativa/matrizPrescriptiva.js` (`REGLAS_ACEPTACION_LOTE`);
 * este engine es un consumidor puro.
 *
 * Modo 1 (planta con SGC) — §6.2.3.7:
 *   a) f'cm,3 (media móvil de 3 últimos lotes) ≥ f'c              (fórmula 6-3)
 *   b) f'ci ≥ f'c − 3,5 MPa             si f'c ≤ 35 MPa            (fórmula 6-4)
 *      f'ci ≥ f'c − 0,10·f'c            si f'c > 35 MPa            (fórmula 6-5)
 *
 * Modo 2 (planta sin SGC) — §6.2.4:
 *   a) f'cm,3 ≥ f'c + 5 MPa                                        (fórmula 6-7)
 *   b) f'ci ≥ f'c                                                  (fórmula 6-8)
 *
 * §6.2.2.2 — Cambio automático Modo 1 ↔ Modo 2:
 *   Si en Modo 1 algún lote es NO conforme → forzar Modo 2 inmediato.
 *   Para volver a Modo 1, requiere 4 lotes consecutivos conformes en Modo 2.
 *
 * Función PURA: recibe parámetros + historia, devuelve veredicto. No toca DB.
 *
 * Variantes §6.2.3.6 (evaluación del 100% del lote) y §6.2.3.8 (cálculo
 * mediante herramientas estadísticas) NO están implementadas: roadmap.
 */

const { REGLAS_ACEPTACION_LOTE } = require('./normativa/matrizPrescriptiva');

const RACHA_CONFORMES_VOLVER_A_MODO_1 =
  REGLAS_ACEPTACION_LOTE.CAMBIO_AUTOMATICO_MODO.rachaConformesVolverAModo1;

/**
 * Evalúa la conformidad de un lote según el modo de producción.
 *
 * @param {object} lote - {
 *   fcMpa: f'c especificado (clase del hormigón),
 *   fciValores: array de resistencias individuales (MPa),
 *   fcm3: media móvil de los 3 últimos lotes (incluido este),
 * }
 * @param {string} modo - '1' | '2'
 * @returns {{ conforme, modo, criterios, mensajes, fuente }}
 */
function evaluarLote(lote, modo) {
  const reglas = modo === '1'
    ? REGLAS_ACEPTACION_LOTE.MODO_1
    : modo === '2'
      ? REGLAS_ACEPTACION_LOTE.MODO_2
      : null;

  const out = {
    conforme: false,
    modo,
    criterios: {},
    mensajes: [],
    fuente: reglas ? reglas.fuente : null,
  };

  if (!reglas) {
    out.mensajes.push(`Modo "${modo}" inválido. Esperado: '1' o '2'.`);
    return out;
  }

  const fc = Number(lote.fcMpa);
  if (!Number.isFinite(fc) || fc <= 0) {
    out.mensajes.push("f'c del lote inválido o no provisto.");
    return out;
  }

  // Mínimo individual del lote
  const fciValores = (lote.fciValores || []).map(Number).filter(Number.isFinite);
  if (fciValores.length === 0) {
    out.mensajes.push("Sin resistencias individuales f'ci provistas.");
    return out;
  }
  const fciMin = Math.min(...fciValores);

  // ── Criterio individual ──
  const minIndividual = reglas.individualMin.calc(fc);
  out.criterios.individual = {
    fciMin,
    minPermitido: round2(minIndividual),
    ok: fciMin >= minIndividual,
    cita: reglas.individualMin.cita,
  };
  if (!out.criterios.individual.ok) {
    out.mensajes.push(
      `f'ci mínimo ${fciMin} MPa < ${round2(minIndividual)} MPa según ${reglas.individualMin.cita}.`
    );
  }

  // ── Criterio media móvil ──
  if (lote.fcm3 != null) {
    const fcm3 = Number(lote.fcm3);
    const minMedia = reglas.mediaMovilMin.calc(fc);
    out.criterios.media = {
      fcm3,
      minPermitido: round2(minMedia),
      ok: fcm3 >= minMedia,
      cita: reglas.mediaMovilMin.cita,
    };
    if (!out.criterios.media.ok) {
      out.mensajes.push(
        `Media móvil 3 lotes ${fcm3} MPa < ${round2(minMedia)} MPa según ${reglas.mediaMovilMin.cita}.`
      );
    }
  } else {
    out.criterios.media = { fcm3: null, ok: null, cita: reglas.mediaMovilMin.cita };
    out.mensajes.push(
      `f'cm,3 no provisto — criterio de media móvil no evaluado (${reglas.mediaMovilMin.cita}).`
    );
  }

  // Conforme si TODOS los criterios provistos cumplen.
  // ind === true Y media !== false (null = no evaluada, no descalifica)
  out.conforme = out.criterios.individual.ok === true && out.criterios.media.ok !== false;

  if (out.conforme && out.mensajes.length === 0) {
    out.mensajes.push(`Lote conforme según ${out.fuente}.`);
  }
  return out;
}

/**
 * Aplica regla §6.2.2.2 de cambio automático de modo.
 *
 * Comportamiento (CIRSOC 200-2024 §6.2.2.2):
 *   - Si modoActual = '1' y el último lote registrado fue NO conforme →
 *     `debeForzarseModo2 = true` (forzar al primer no conforme).
 *   - Si modoActual = '2' y los últimos 4 lotes fueron conformes (todos) →
 *     `puedeVolverAModo1 = true`.
 *   - Otros casos: ninguna acción.
 *
 * El historial debe estar ordenado cronológicamente (más antiguo primero).
 *
 * @param {Array<{conforme: boolean, modo?: string}>} historial - lotes ordenados.
 * @param {string} modoActual - modo actual de la planta ('1' | '2').
 * @returns {{
 *   debeForzarseModo2: boolean,
 *   puedeVolverAModo1: boolean,
 *   racha: number,        // racha relevante: no conformes en Modo 1 / conformes en Modo 2
 *   motivo: string|null,
 * }}
 */
function evaluarCambioAutomaticoModo(historial, modoActual) {
  const result = {
    debeForzarseModo2: false,
    puedeVolverAModo1: false,
    racha: 0,
    motivo: null,
  };

  if (!Array.isArray(historial) || historial.length === 0) {
    return result;
  }

  if (modoActual === '1') {
    // Forzar Modo 2 al PRIMER lote no conforme.
    const ultimo = historial[historial.length - 1];
    if (ultimo && ultimo.conforme === false) {
      result.debeForzarseModo2 = true;
      result.racha = 1;
      result.motivo =
        'Lote no conforme en Modo 1 → forzar Modo 2 (CIRSOC 200-2024 §6.2.2.2).';
    }
    return result;
  }

  if (modoActual === '2') {
    // Volver a Modo 1 tras N lotes consecutivos conformes en Modo 2.
    let racha = 0;
    for (let i = historial.length - 1; i >= 0; i--) {
      if (historial[i].conforme === true) racha++;
      else break;
    }
    result.racha = racha;
    if (racha >= RACHA_CONFORMES_VOLVER_A_MODO_1) {
      result.puedeVolverAModo1 = true;
      result.motivo =
        `Racha de ${racha} lotes consecutivos conformes en Modo 2 → volver a Modo 1 (CIRSOC 200-2024 §6.2.2.2).`;
    }
    return result;
  }

  return result;
}

/** Redondeo a 2 decimales para presentación numérica estable. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  evaluarLote,
  evaluarCambioAutomaticoModo,
  RACHA_CONFORMES_VOLVER_A_MODO_1,
};
