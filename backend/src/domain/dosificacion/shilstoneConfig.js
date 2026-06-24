'use strict';

/**
 * shilstoneConfig.js — Tablas técnicas Shilstone por tipología de hormigón.
 *
 * Función + constantes puras, extraídas de `services/tipologiaHormigonService`
 * en la auditoría 01-calidad Fase C R2 (sesión 2026-05-07). El servicio sigue
 * exportando `getShilstoneConfig` y las constantes vía re-export para no
 * romper callers existentes (tests + dosificación), pero la fuente vive aquí
 * en `domain/` para que `sugerenciaMezclaEngine` y otros engines puedan
 * consumirla sin cruzar capas.
 *
 * Fuentes:
 *   - Shilstone (1990) "Concrete Mixture Optimization", Concrete International.
 *   - Ken Day (2006) "Concrete Mix Design, Quality Control and Specification".
 *   - ACI 211, 302, 304, 506.
 *   - EFNARC (autocompactante).
 *   - CIRSOC 201 (estructuras armadas).
 *
 * `severidad`:
 *   - 'obligatorio': fuera de rango = rechazo.
 *   - 'advertencia': fuera de rango = warning, no rechazo.
 *   - 'informativo': se muestra pero no condiciona estado.
 */
const SHILSTONE_POR_TIPOLOGIA = {
  convencional: {
    severidad: 'obligatorio',
    zonaObjetivo: ['II'],                   // Zona III aceptable si TMN ≤ 13.2
    zonaAceptableTMNBajo: ['II', 'III'],    // TMN ≤ 13.2 mm
    fdg: { min: 40, obj_min: 55, obj_max: 65, max: 75 },
    fdt: { min: 30, obj_min: 34, obj_max: 38, max: 42 },
    fda: { min: 22, obj_min: 25, obj_max: 27, max: 30 },
    se:  { min: 16, obj_min: 20, obj_max: 25, max: 30 },
  },
  estructural: {  // alias de convencional
    severidad: 'obligatorio',
    zonaObjetivo: ['II'],
    zonaAceptableTMNBajo: ['II', 'III'],
    fdg: { min: 40, obj_min: 55, obj_max: 65, max: 75 },
    fdt: { min: 30, obj_min: 34, obj_max: 38, max: 42 },
    fda: { min: 22, obj_min: 25, obj_max: 27, max: 30 },
    se:  { min: 16, obj_min: 20, obj_max: 25, max: 30 },
  },
  bombeable: {
    severidad: 'obligatorio',
    zonaObjetivo: ['II'],
    zonaAceptableTMNBajo: ['II', 'III'],
    fdg: { min: 35, obj_min: 45, obj_max: 55, max: 65 },
    fdt: { min: 33, obj_min: 36, obj_max: 40, max: 45 },
    fda: { min: 24, obj_min: 26, obj_max: 29, max: 32 },
    se:  { min: 18, obj_min: 22, obj_max: 28, max: 32 },
    restricciones: { pasante_0_30_min: 15, pasante_0_15_min: 5, vol_pasta_min_pct: 28 },
  },
  autocompactante: {
    severidad: 'advertencia',
    zonaObjetivo: ['II', 'III'],
    zonaAceptableTMNBajo: ['II', 'III', 'IV'],
    fdg: { min: 20, obj_min: 30, obj_max: 45, max: 55 },
    fdt: { min: 38, obj_min: 42, obj_max: 50, max: 55 },
    fda: { min: 28, obj_min: 32, obj_max: 38, max: 42 },
    se:  { min: 22, obj_min: 28, obj_max: 35, max: 42 },
    restricciones: { vol_pasta_min_pct: 34, vol_mortero_min_pct: 60, grueso_max_vol_pct: 50 },
    nota: 'Shilstone es indicador secundario. Priorizar criterios EFNARC.',
  },
  hac: null, // alias → autocompactante (resuelto en getShilstoneConfig)
  pavimento: {
    severidad: 'obligatorio',
    zonaObjetivo: ['II'],
    zonaAceptableTMNBajo: ['II'],  // Pavimento no acepta Zona III ni con TMN bajo
    fdg: { min: 45, obj_min: 55, obj_max: 65, max: 75 },
    fdt: { min: 28, obj_min: 32, obj_max: 36, max: 40 },
    fda: { min: 18, obj_min: 20, obj_max: 24, max: 26 },
    se:  { min: 15, obj_min: 18, obj_max: 23, max: 27 },
  },
  pavimento_rigido: null, // alias → pavimento
  proyectado: {
    severidad: 'advertencia',
    zonaObjetivo: ['II', 'III'],
    zonaAceptableTMNBajo: ['II', 'III'],
    fdg: { min: 25, obj_min: 35, obj_max: 50, max: 55 },
    fdt: { min: 34, obj_min: 38, obj_max: 44, max: 48 },
    fda: { min: 24, obj_min: 27, obj_max: 32, max: 35 },
    se:  { min: 22, obj_min: 26, obj_max: 32, max: 38 },
    restricciones: { pasante_0_30_min: 15, pasante_0_30_max: 30, pasante_0_15_min: 5, pasante_0_15_max: 10, cemento_min_kg: 380 },
    nota: 'Shilstone complementario. Criterio primario: bandas ACI 506.',
  },
  arquitectonico: {
    severidad: 'obligatorio',
    zonaObjetivo: ['II'],
    zonaAceptableTMNBajo: ['II', 'III'],
    fdg: { min: 35, obj_min: 45, obj_max: 55, max: 65 },
    fdt: { min: 33, obj_min: 36, obj_max: 40, max: 44 },
    fda: { min: 24, obj_min: 26, obj_max: 29, max: 32 },
    se:  { min: 20, obj_min: 24, obj_max: 28, max: 32 },
    restricciones: { gap_max_pct: 8, aire_max_pct: 3 },
    nota: 'Graduación continua estricta. Evitar discontinuidades > 8% entre tamices.',
  },
  masivo: {
    severidad: 'advertencia',
    zonaObjetivo: ['II'],
    zonaAceptableTMNBajo: ['II', 'III'],
    fdg: { min: 55, obj_min: 60, obj_max: 75, max: 80 },
    fdt: { min: 25, obj_min: 28, obj_max: 33, max: 37 },
    fda: { min: 16, obj_min: 19, obj_max: 23, max: 26 },
    se:  { min: 12, obj_min: 15, obj_max: 20, max: 25 },
    nota: 'Shilstone moderadamente aplicable. Para TMN > 37.5 mm, usar como indicador complementario.',
  },
  grout: {
    severidad: 'informativo',
    zonaObjetivo: null,  // No aplica
    fdg: null, fdt: null, fda: null,
    se: { min: 30, obj_min: 35, obj_max: 45, max: 55 },
    nota: 'Shilstone no aplicable (sin agregado grueso). Solo SE como referencia.',
  },
  rcc: {
    severidad: 'informativo',
    zonaObjetivo: null,
    fdg: { min: 50, obj_min: 60, obj_max: 70, max: 80 },
    fdt: { min: 20, obj_min: 23, obj_max: 28, max: 32 },
    fda: { min: 12, obj_min: 15, obj_max: 19, max: 22 },
    se:  { min: 12, obj_min: 15, obj_max: 20, max: 25 },
    nota: 'Shilstone informativo. Criterios primarios: Vebe, densidad-humedad, bandas ACI 325.10R.',
  },
  premoldeado: {
    severidad: 'obligatorio',
    zonaObjetivo: ['II'],
    zonaAceptableTMNBajo: ['II', 'III'],
    fdg: { min: 35, obj_min: 45, obj_max: 60, max: 70 },
    fdt: { min: 30, obj_min: 33, obj_max: 38, max: 42 },
    fda: { min: 20, obj_min: 23, obj_max: 27, max: 30 },
    se:  { min: 18, obj_min: 22, obj_max: 27, max: 32 },
  },
  alta_resistencia: {
    severidad: 'advertencia',
    zonaObjetivo: ['II'],
    zonaAceptableTMNBajo: ['II', 'III'],
    fdg: { min: 30, obj_min: 40, obj_max: 55, max: 65 },
    fdt: { min: 35, obj_min: 38, obj_max: 44, max: 48 },
    fda: { min: 26, obj_min: 29, obj_max: 34, max: 38 },
    se:  { min: 20, obj_min: 24, obj_max: 30, max: 35 },
    nota: 'FdA puede no correlacionar con asentamiento real por efecto de superplastificante.',
  },
  liviano: {
    severidad: 'informativo',
    zonaObjetivo: null,
    fdg: null, fdt: null,
    fda: { min: 22, obj_min: 25, obj_max: 30, max: 34 },
    se: null,
    nota: 'Shilstone no aplicable con agregados livianos (densidad variable). Solo FdA como referencia de consistencia.',
  },
  hrdc: {
    severidad: 'informativo',
    zonaObjetivo: null,
    fdg: null, fdt: null, fda: null, se: null,
    nota: 'HRDC (resistencia y densidad controlada). Hormigón celular/espumado, sin agregado grueso típico. Indicadores Shilstone no aplicables.',
  },
  personalizado: {
    severidad: 'advertencia',
    zonaObjetivo: ['II'],
    zonaAceptableTMNBajo: ['II', 'III'],
    fdg: { min: 40, obj_min: 55, obj_max: 65, max: 75 },
    fdt: { min: 30, obj_min: 34, obj_max: 38, max: 42 },
    fda: { min: 22, obj_min: 25, obj_max: 27, max: 30 },
    se:  { min: 16, obj_min: 20, obj_max: 25, max: 30 },
  },
};

// Alias resolution
const SHILSTONE_ALIASES = {
  hac: 'autocompactante',
  pavimento_rigido: 'pavimento',
  estructural: 'convencional',
};

/**
 * Get Shilstone config for a tipología code.
 * Resolves aliases and returns the convencional config for unknown codes.
 *
 * @param {string} codigo
 * @returns {object} config — siempre retorna un objeto (fallback a convencional).
 */
function getShilstoneConfig(codigo) {
  const key = (codigo || 'convencional').toLowerCase().replace(/\s+/g, '_');
  const resolved = SHILSTONE_ALIASES[key] || key;
  return SHILSTONE_POR_TIPOLOGIA[resolved] || SHILSTONE_POR_TIPOLOGIA.convencional;
}

module.exports = {
  SHILSTONE_POR_TIPOLOGIA,
  SHILSTONE_ALIASES,
  getShilstoneConfig,
};
