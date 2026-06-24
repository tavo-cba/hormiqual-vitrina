'use strict';

/**
 * Registro de vigencia recomendada por tipo de ensayo de agregado (P1.8).
 *
 * RAZÓN:
 * El sistema usaba 12 meses como vigencia default para TODOS los ensayos. Esto
 * es normativamente incorrecto: la granulometría puede variar mes a mes en una
 * cantera (lavado, fracciones nuevas), mientras que un examen petrográfico
 * caracteriza el yacimiento y vale por años. Aplicar el mismo período a ambos
 * extremos es a la vez excesivo (re-ensayar petrografía cada año) e insuficiente
 * (re-ensayar granulometría cada año cuando puede degradarse en meses).
 *
 * Los valores recomendados aquí provienen de la práctica habitual en
 * laboratorios argentinos y de los criterios de re-evaluación de CIRSOC 200:2024
 * y normas IRAM relacionadas. NO son un mandato normativo único: cada usuario
 * puede personalizar `tipo.periodicidadMeses` desde la UI por organización,
 * planta o procedencia del material.
 *
 * Convención:
 *   meses = período recomendado entre ensayos del mismo tipo
 *
 * Categorías:
 *   - Físicas que cambian con la operación (granulometría, finos #200): 6 meses
 *   - Físicas estables del yacimiento (densidad, absorción): 12 meses
 *   - Químicas/limpieza con potencial drift estacional: 12 meses
 *   - Mecánica (Los Ángeles): 24 meses
 *   - Durabilidad y mineralógico/petrográfico: 24 meses
 */

/**
 * Vigencia recomendada por código de ensayo.
 * Las claves son los códigos canónicos usados en `AgregadoEnsayoTipo.codigo`.
 *
 * Si un código no está acá, el fallback es el default global del seeder.
 */
const VIGENCIA_RECOMENDADA_MESES = Object.freeze({
  // ── Físicos que pueden variar con la operación de la cantera ──
  IRAM1505_GRANULOMETRIA:        6,
  IRAM1674_MATERIAL_FINO_200:    6,

  // ── Físicos estables del yacimiento ──
  IRAM1520_DENSIDAD_ABSORCION_FINO: 12,
  IRAM1533_DENSIDAD_GRUESO:         12,
  IRAM1548_PESO_UNITARIO:           12,
  IRAM1687_1_LAJOSIDAD:             12,
  IRAM1687_2_ELONGACION:            12,

  // ── Limpieza y química — potencial drift estacional ──
  IRAM1647_TERRONES_ARCILLA:    12,
  IRAM1647_SALES_SOLUBLES:      12,
  IRAM1647_SULFATOS_SO3:        12,
  IRAM1647_MATERIA_ORGANICA:    12,
  IRAM1647_MATERIAS_CARBONOSAS: 12,
  IRAM1882_CLORUROS_SOLUBLES:   12,
  IRAM1682_EQUIVALENTE_ARENA:   12,
  IRAM1883_POLVO_ADHERIDO:      12,
  IRAM1644_PARTICULAS_BLANDAS:  12,

  // ── Mecánica (rocas no cambian rápido) ──
  IRAM1532_LOS_ANGELES:         24,

  // ── Durabilidad y mineralógico ──
  IRAM1525_DURABILIDAD_SULFATO:    24,
  IRAM1519_ESTABILIDAD_BASALTICAS: 24,
  IRAM1649_EXAMEN_PETROGRAFICO:    24,

  // ── Agua (IRAM 1601) — ensayo del recurso, anual ──
  IRAM1601_PH:                12,
  IRAM1601_CONDUCTIVIDAD:     12,
  IRAM1601_RES_SECO:          12,
  IRAM1601_ANALISIS_QUIMICO:  12,
});

/**
 * Devuelve la vigencia recomendada en meses para un código de ensayo.
 *
 * @param {string} codigo - código canónico del tipo de ensayo
 * @param {number} [fallback=12] - meses a devolver si el código no está registrado
 * @returns {number}
 */
function getVigenciaRecomendadaMeses(codigo, fallback = 12) {
  if (!codigo) return fallback;
  const v = VIGENCIA_RECOMENDADA_MESES[codigo];
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Devuelve la vigencia efectiva para un tipo: usa la del tipo si está
 * configurada explícitamente; sino la recomendada del registry; sino el
 * fallback global.
 *
 * @param {{ codigo?: string, periodicidadMeses?: number }} tipo
 * @param {number} [fallback=12]
 * @returns {number}
 */
function getVigenciaEfectivaMeses(tipo, fallback = 12) {
  if (tipo && Number.isFinite(tipo.periodicidadMeses) && tipo.periodicidadMeses > 0) {
    return tipo.periodicidadMeses;
  }
  return getVigenciaRecomendadaMeses(tipo?.codigo, fallback);
}

module.exports = {
  VIGENCIA_RECOMENDADA_MESES,
  getVigenciaRecomendadaMeses,
  getVigenciaEfectivaMeses,
};
