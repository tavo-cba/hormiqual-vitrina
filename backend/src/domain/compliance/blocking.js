'use strict';

/**
 * blocking.js — Tabla declarativa de bloqueo + isBlockingInContext.
 *
 * Responde: dado un código de ensayo + UsageContext + MaterialContext,
 * ¿un fail en este ensayo bloquea la emisión del veredicto del agregado?
 *
 * Diseño:
 *   - Misma forma declarativa que required.js (pura datos + función que
 *     consume la tabla).
 *   - Sirve dos propósitos en el sistema:
 *     1. Decidir el `severity` de un Compliance.fail (bloqueante vs
 *        no_bloqueante). Lo usa el motor en C4 al construir el
 *        ComplianceResult.
 *     2. Calcular el árbol de veredictos globales (NO APTO vs APTO CON
 *        OBSERVACIONES vs APTITUD CONDICIONADA). Lo usa el calculador de
 *        veredicto en C10.
 *
 * Hermanos:
 *   - `isBlocking` legacy en ComplianceResult.js: context-free, mira solo
 *     `result.status`. Lo usa el dispatcher de alertas (Prompt 1 Commit 6).
 *     SE MANTIENE INTACTO. La unificación, si fuese deseable, va a un
 *     Prompt futuro. Esto cierra D2 sin romper el dispatcher.
 *   - `isBlockingInContext` (este módulo): context-aware, consume tabla
 *     declarativa + UsageContext + MaterialContext. Esta es la función
 *     que el motor de aptitud y el calculador de veredictos deben usar.
 *
 * Regla conservadora distinta a `isRequired`:
 *   - En `isRequired`, "no sé" se mapea a "required" (conservador para
 *     alertas: emitir alertas falsas es preferible a perder reales).
 *   - En `isBlockingInContext`, "no sé" se mapea a `false` (conservador
 *     para veredictos: marcar bloqueante falso degrada la confianza del
 *     usuario en los veredictos del sistema).
 *   La asimetría es intencional.
 *
 * Diseño de la firma — IMPORTANTE:
 *   La función NO recibe un complianceResult construido. La razón: el
 *   evaluador del motor (C4) la llama JUSTAMENTE para construir el fail
 *   con su severity correcto. Si la firma exigiera complianceResult, el
 *   ciclo sería: "necesito severity para construir fail, necesito fail
 *   para llamar isBlockingInContext, necesito isBlockingInContext para
 *   tener severity". La firma actual permite que el evaluador la llame
 *   antes de tener un fail completo:
 *
 *     // En el evaluador refactoreado de C4:
 *     if (isFail) {
 *       const blocking = isBlockingInContext(codigo, usageCtx, matCtx);
 *       return Compliance.fail({
 *         severity: blocking ? 'bloqueante' : 'no_bloqueante',
 *         ...
 *       });
 *     }
 */

const {
  REQUIRED, NOT_APPLICABLE, UNKNOWN,
  CODE_ALIASES,
  evalPredicate,
  isRequired,
} = require('./required');

/* ───────── Tabla declarativa ───────── */

const BLOCKING_TABLE = Object.freeze({
  /* ─── Caracterización física básica — NO bloqueante a nivel agregado ─── */

  'IRAM1520_DENSIDAD_ABSORCION_FINO': Object.freeze({
    defaultBlocking: false,
    norm: 'IRAM 1520',
    notes: 'Densidad/absorción son informativos para diseño de mezcla. No tienen criterio de cumplimiento bloqueante a nivel del agregado individual.',
  }),

  'IRAM1533_DENSIDAD_GRUESO': Object.freeze({
    defaultBlocking: false,
    norm: 'IRAM 1533 / IRAM 1531 Tabla 4',
    notes: 'Absorción >10% en AG sería extrema, pero el motor produce passWithObservations en lugar de fail para casos cerca del límite.',
  }),

  'IRAM1531_PESO_UNITARIO': Object.freeze({
    defaultBlocking: false,
    norm: 'IRAM 1548 / IRAM 1531 Tabla 4',
    notes: 'PUS bajo se reporta pero no bloquea. Es dato para diseño.',
  }),

  /* ─── Granulometría — NO bloqueante a nivel agregado individual ─── */

  // Esto es CRÍTICO. Es el cierre del Concepto 1 del Prompt 2: la
  // granulometría individual del agregado deja de ser bloqueante. Las
  // verificaciones de banda IRAM 1627 viven en Nivel 2 (verificación
  // granulométrica de la mezcla), no en el INF del agregado.
  //
  // El INF de Arideros 6 sale APTO CON OBSERVACIONES por esta entrada:
  // su granulometría no cumple banda A-B individualmente, pero en el
  // diseño combina con otras arenas y la mezcla sí cumple. Eso se
  // resuelve en Nivel 2; el agregado individual no se penaliza.
  'IRAM1505_GRANULOMETRIA': Object.freeze({
    defaultBlocking: false,
    norm: 'IRAM 1505 (caracterización) / CIRSOC 200 §3.2.3.2 (AF) y §3.4 vía IRAM 1627 (mezcla)',
    notes: 'Granulometría individual NO bloquea. Las reglas de CIRSOC §3.2.3.2 (banda A-B/A-C, MF rango 2,3-3,1 y variación ±0,20 vs diseño, tolerancia 10pp, fracción 45%) aplican al AF individual y se evalúan en `services/granulometriaEvalService.autoEvaluarGranulometriaFinoIRAM1627`. La banda A-B/A-C del agregado total combinado se evalúa a Nivel 2 (`compliance/granulometriaMezcla`). Auditoría 01-calidad R1 (sesión 2026-05-07) clarificó que las reglas no aplican al AF combinado sino al individual.',
  }),

  /* ─── Sustancias nocivas — bloqueantes absolutos ─── */

  'IRAM1674_MATERIAL_FINO_200': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1540 / CIRSOC 200 §3.2.3.3 Tabla 3.4',
    notes: 'Pasante #200 sobre el límite estándar (5% AF / 1.5% AG) bloquea sin importar contexto. El caso entre estricto y estándar (3-5% con o sin desgaste) NO llega acá: el evaluador lo emite como conditionalPass, no como fail.',
  }),

  'IRAM1647_TERRONES_ARCILLA': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1647 / CIRSOC 200 §3.2.3.3 Tabla 3.4',
    notes: 'Terrones sobre el límite (3% AF / 2% AG) bloquea siempre.',
  }),

  'IRAM1647_SULFATOS_SO3': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1647 / IRAM 1512 §5.2.2',
    notes: 'Sulfatos como SO3 sobre 1.2% bloquea siempre.',
  }),

  'IRAM1647_SALES_SOLUBLES': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1647',
    notes: 'Sales solubles totales sobre límite bloquean siempre.',
  }),

  'IRAM1882_CLORUROS_SOLUBLES': Object.freeze({
    // Cloruros bloquean SIEMPRE cuando hay fail. La distinción
    // pretensado/armado afecta el LÍMITE que se aplica (responsabilidad
    // del evaluador en C4), no si bloquea cuando se supera.
    //
    // El caso "valor cumple armado pero no pretensado" se modela como
    // conditionalPass + exclude_destination: ['pretensed'], no como fail
    // — entonces tampoco llega a esta función con ese estado.
    defaultBlocking: true,
    norm: 'IRAM 1882 / CIRSOC 200 art. 2.2.8',
    notes: 'Cloruros sobre límite bloquean siempre. Pretensado tiene límite más estricto (0.003%) que armado (0.04%); esa diferencia se aplica al construir el fail, no acá.',
  }),

  'IRAM1647_MATERIA_ORGANICA': Object.freeze({
    // La excepción §3.2.3.4 b) (ensayo comparativo de morteros >= 95%)
    // se maneja a nivel del estado: si excepcionValida=true, el evaluador
    // emite passWithObservations en vez de fail. Entonces no llega a
    // esta función. Si llega un fail de MO, es porque la excepción NO
    // aplica → bloquea.
    defaultBlocking: true,
    norm: 'IRAM 1647 / CIRSOC 200 §3.2.3.4',
    notes: 'MO positiva intensa sin excepción válida bloquea. La excepción §3.2.3.4 b) se maneja como passWithObservations (no llega como fail).',
  }),

  'IRAM1647_MATERIAS_CARBONOSAS': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1647 / CIRSOC 200 §3.2.3.3 Tabla 3.4',
    notes: 'Materias carbonosas sobre límite (1% general / 0.5% si aspecto importante) bloquean. El caso "cumple sin aspecto pero no con aspecto" se modela como conditionalPass.',
  }),

  /* ─── Forma del AG — bloqueantes para AG ─── */

  'IRAM1687_1_LAJOSIDAD': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1687-1 / IRAM 1531',
    notes: 'Lajosidad alta hace al agregado no apto para hormigón estructural. Bloquea.',
  }),

  'IRAM1687_2_ELONGACION': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1687-2 / IRAM 1531',
    notes: 'Elongación alta bloquea por la misma razón que lajosidad.',
  }),

  'IRAM1532_DESGASTE_LA': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1532 / IRAM 1531',
    notes: 'Desgaste Los Ángeles sobre límite indica baja resistencia mecánica del agregado. Bloquea.',
  }),

  'IRAM1644_PARTICULAS_BLANDAS': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1644 / IRAM 1531',
    notes: 'Partículas blandas sobre límite bloquean.',
  }),

  'IRAM1883_POLVO_ADHERIDO': Object.freeze({
    defaultBlocking: true,
    norm: 'IRAM 1883',
    notes: 'Polvo adherido sobre límite bloquea (afecta adherencia pasta-agregado).',
  }),

  /* ─── Equivalente de arena — informativo (NO bloquea) ─── */
  // Auditoría 01-calidad C21 (sesión 2026-05-07): se declara `defaultBlocking:
  // false` explícito porque el ensayo NO tiene respaldo normativo argentino
  // para hormigón (IRAM 1682 es para mezclas bituminosas). Ver nota en
  // `compliance/required.js`.
  'IRAM1882_VALOR_EQUIVALENTE_ARENA': Object.freeze({
    defaultBlocking: false,
    norm: 'IRAM 1682',
    notes: 'Equivalente de arena no bloquea (auditoría 01-calidad C21). Es ensayo informativo.',
  }),

  /* ─── Bloqueantes condicionales por exigibilidad ─── */

  // Patrón: el ensayo solo bloquea cuando isRequired === 'required'.
  // Si es not_applicable (ej: durabilidad sin exposición C1/C2), el
  // ensayo ni siquiera debería tener fail (no se exige). Si por defensa
  // llega un fail con isRequired=not_applicable, no bloqueamos.
  // Si isRequired=unknown, el predicado evalPredicateBlocking retorna
  // unknown → cae al default (false).

  'IRAM1525_DURABILIDAD_SULFATO': Object.freeze({
    defaultBlocking: false,
    blockingWhen: [
      { isRequired: true },
    ],
    norm: 'IRAM 1525 / IRAM 1512 §5.6 / CIRSOC 200 Tabla 2.5',
    notes: 'Bloquea solo cuando exposureClass es C1/C2 (ensayo exigible). En otras exposiciones, el ensayo es informativo → no bloquea.',
  }),

  'IRAM1519_ESTABILIDAD_BASALTICAS': Object.freeze({
    defaultBlocking: false,
    blockingWhen: [
      { isRequired: true },
    ],
    norm: 'IRAM 1519 / IRAM 1874-2',
    notes: 'Bloquea solo si el agregado es basáltico (ensayo exigible). En otras litologías, no aplica.',
  }),

  /* ─── RAS — bloqueante por exposición o por reactividad confirmada ─── */

  'IRAM1674_RAS_ACELERADO': Object.freeze({
    defaultBlocking: false,
    blockingWhen: [
      { isRequired: true },  // delega: required si Q3/Q4 o RAS=POTENCIALMENTE_REACTIVO
    ],
    norm: 'IRAM 1674 / IRAM 1512 §5.6.5',
    notes: 'Bloquea cuando es exigible (Q3/Q4 o RAS potencial). Un fail acá indica reactividad confirmada que requeriría medidas preventivas (modeladas como conditionalPass — solo llega como fail cuando la mitigación no es suficiente).',
  }),

  /* ─── RAS — IRAM 1700 prismas hormigón (PR8.6) — TIENE PRELACIÓN sobre IRAM 1674 ─── */

  'IRAM1874_1_RAP_PRISMA': Object.freeze({
    defaultBlocking: false,
    blockingWhen: [
      { isRequired: true },  // delega: required si Q3/Q4 o RAS=POTENCIALMENTE_REACTIVO
    ],
    norm: 'IRAM 1700 / CIRSOC 200:2024 §2.2.16.9',
    notes: 'PR8.6 — Prismas de hormigón (método IRAM 1700:2013, código de catálogo IRAM1874_1_RAP_PRISMA por compat). Tiene PRELACIÓN sobre IRAM 1674 cuando ambos están disponibles (CIRSOC §2.2.16.9.b / IRAM 1512 §5.6.3.3). Mismo patrón que 1674: un fail llega solo si la mitigación no es suficiente; el caso típico de reactividad se modela como conditionalPass + requires_mitigation.',
  }),

  /* ─── Examen petrográfico — NO bloquea por sí solo ─── */

  'IRAM1649_EXAMEN_PETROGRAFICO': Object.freeze({
    defaultBlocking: false,
    norm: 'IRAM 1649',
    notes: 'Examen petrográfico vencido o con observación NO bloquea por sí solo. La conclusión "potencialmente reactivo" se modela como conditionalPass + requires_ras_mitigation. Un fail aislado del petrográfico (ej: roca no apta) bloquearía, pero ese caso es tan raro que se maneja como excepción manual.',
  }),
});

/* ───────── Evaluación de predicados con isRequired ───────── */

/**
 * Evalúa un predicado de bloqueo. Acepta los mismos campos que evalPredicate
 * (usage/agregado/cemento) más un campo especial `isRequired` que delega
 * a la tabla de exigibilidad.
 *
 * @returns {true | false | 'unknown'}
 */
function evalBlockingPredicate(pred, codigo, usageCtx, materialCtx) {
  let hasUnknown = false;

  // Sección especial: isRequired
  if (pred.isRequired !== undefined) {
    const required = isRequired(codigo, usageCtx, materialCtx);
    const expected = pred.isRequired;

    if (required === UNKNOWN) {
      hasUnknown = true;
    } else if (expected === true && required !== REQUIRED) {
      return false;
    } else if (expected === false && required !== NOT_APPLICABLE) {
      return false;
    }
  }

  // Otras secciones: delegar a evalPredicate
  const otherFields = { ...pred };
  delete otherFields.isRequired;
  if (Object.keys(otherFields).length > 0) {
    const r = evalPredicate(otherFields, usageCtx, materialCtx);
    if (r === false) return false;
    if (r === UNKNOWN) hasUnknown = true;
  }

  if (hasUnknown) return UNKNOWN;
  return true;
}

/* ───────── API pública ───────── */

/**
 * Determina si un fail en este ensayo bloquea la emisión del veredicto
 * del agregado, considerando UsageContext y MaterialContext.
 *
 * Regla conservadora: en caso de ambigüedad ('unknown'), retorna `false`
 * (no bloquea). Esto es DISTINTO a isRequired, donde unknown se mapea a
 * required. Justificación: bloqueantes falsos degradan la confianza en
 * los veredictos del sistema; faltantes falsos solo escalan alertas.
 *
 * @param {string} codigo - Código del ensayo (acepta aliases).
 * @param {Object} usageCtx - UsageContext canónico.
 * @param {Object} materialCtx - MaterialContext canónico.
 * @param {Object} [options] - Reservado para futuras extensiones.
 * @returns {boolean}
 */
function isBlockingInContext(codigo, usageCtx, materialCtx, options = {}) {
  if (!codigo) return false;

  const canonical = CODE_ALIASES[codigo] || codigo;
  const entry = BLOCKING_TABLE[canonical];

  if (!entry) {
    // Código desconocido → conservador para veredictos: no bloquea.
    return false;
  }

  // 1. Match positivo en blockingWhen
  for (const pred of entry.blockingWhen || []) {
    const r = evalBlockingPredicate(pred, canonical, usageCtx, materialCtx);
    if (r === true) return true;
  }

  // 2. Match positivo en nonBlockingWhen
  for (const pred of entry.nonBlockingWhen || []) {
    const r = evalBlockingPredicate(pred, canonical, usageCtx, materialCtx);
    if (r === true) return false;
  }

  // 3. Default
  return entry.defaultBlocking;
}

/**
 * Devuelve la entrada cruda de la tabla para inspección/tests.
 */
function getBlockingEntry(codigo) {
  if (!codigo) return undefined;
  const canonical = CODE_ALIASES[codigo] || codigo;
  return BLOCKING_TABLE[canonical];
}

module.exports = {
  BLOCKING_TABLE,
  isBlockingInContext,
  evalBlockingPredicate,
  getBlockingEntry,
};
