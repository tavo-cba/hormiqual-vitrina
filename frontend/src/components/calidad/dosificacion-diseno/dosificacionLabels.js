'use strict';

/**
 * SSoT compartida de labels usados en informes y trazabilidad de dosificación.
 *
 * Antes M7 estos labels estaban duplicados en `dosificacionInformePdf.js` y
 * `dosificacionTraceSections.js`, con pequeñas variaciones de redacción
 * que producían reports inconsistentes (ej. "o cliente" vs "/ cliente").
 *
 * Cualquier nuevo consumer que necesite estos labels debe importarlos de
 * acá, no redefinirlos.
 */

// ── Restricción gobernante de la relación a/c ──
//
// Cuando hay múltiples restricciones sobre a/c (resistencia objetivo,
// durabilidad CIRSOC, pliego del cliente), el motor adopta la más estricta
// y reporta cuál fue. Estos labels traducen el código a texto humano.
const AC_GOBERNANTE_LABELS = Object.freeze({
  RESISTENCIA: 'Resistencia (curva del cemento)',
  EXPOSICION:  'Durabilidad / clase de exposición (CIRSOC 200:2024)',
  PLIEGO:      'Restricción de pliego / cliente',
});

// ── Origen del cemento adoptado en la dosificación ──
const CEMENTO_GOBERNANTE_LABELS = Object.freeze({
  CALCULO:    'Cálculo (agua ÷ a/c)',
  CIRSOC_MIN: 'Mínimo CIRSOC §4.1.5.2 (250/280/300 según armadura)',
  PLIEGO:     'Restricción de pliego / cliente',
  TABLA_2_5:  'Tabla 2.5 (cemento mínimo por clase de exposición)',
});

module.exports = {
  AC_GOBERNANTE_LABELS,
  CEMENTO_GOBERNANTE_LABELS,
};
