'use strict';

/**
 * modos.js — Constantes y contrato del modelo de evaluación dual de HormiQual.
 *
 * Decisión arquitectónica (sesión 2026-05-28, supersedes la sesión 2026-05-04):
 *
 *   DESCRIPTIVO — el documento NO emite valoración normativa. Lista los datos
 *   del material/dosificación tal como están, sin "cumple/no cumple", sin
 *   veredicto, sin "apto/no apto". Para la dosificación incluye los valores
 *   normativos como referencia al lado de los calculados pero sin juicio
 *   (el lector compara y decide). Es el modo DEFAULT de los documentos
 *   hacia afuera (ficha técnica, informe de dosificación, comparación,
 *   receta, pastón). El sistema NUNCA bloquea la operación bajo este modo:
 *   el técnico firma bajo su criterio profesional.
 *
 *   NORMATIVO — el documento evalúa contra la matriz normativa estricta
 *   (CIRSOC 200:2024 + serie IRAM) independientemente del catálogo del
 *   tenant. Emite veredictos formales: APTO / NO APTO / INCOMPLETO con
 *   sus motivos. Es el modo para auditorías externas, licitaciones y
 *   contraste técnico. El certificado de cumplimiento normativo es el
 *   ÚNICO documento que va en este modo siempre, sin toggle.
 *
 * Por qué descriptivo sin juicio:
 *
 *   El criterio normativo argentino sobre agregados (banda IRAM 1627,
 *   límites de Tabla 3.4/3.6 CIRSOC) deja afuera ~70% de los materiales
 *   disponibles en la práctica. Un excelente hormigón se puede producir
 *   con agregados que se desvían de algún límite normativo, siempre que
 *   el técnico responsable lo respalde con ensayos funcionales (pastones,
 *   FdA, resistencias de obra). El modelo descriptivo evita que el sistema
 *   emita APTO sobre criterios filtrados por catálogo (riesgo de
 *   malinterpretación externa) y deja la decisión técnica al firmante.
 *
 * Política del catálogo del tenant bajo este modelo:
 *
 *   El catálogo de obligatoriedad (`obligatorioHormigon`, `obligatorioTBS`,
 *   `nivelCaracterizacion*`) NO interviene más en los PDFs hacia afuera.
 *   Sigue siendo la fuente para alertas reactivas internas (PR4 / hooks
 *   Sequelize) y para qué ensayos exige la UI de carga, pero ningún
 *   documento de salida juzga aptitud filtrando por catálogo. Esto cierra
 *   la circularidad anterior ("el tenant configura lo que quiere validar
 *   y luego firma APTO sobre esa configuración").
 *
 * Reglas de uso por consumidor (asignación documento → modo, ver
 * `docs/decisiones_arquitectura.md` §8):
 *
 *   Documento / consumidor                   | Modo default
 *   -----------------------------------------+----------------------
 *   Ficha técnica de agregado                | DESCRIPTIVO (toggle a NORMATIVO)
 *   Informe de dosificación                  | DESCRIPTIVO (toggle a NORMATIVO)
 *   Comparación de dosificaciones             | DESCRIPTIVO
 *   Receta de obra                            | DESCRIPTIVO (hereda)
 *   Pastón de prueba                          | DESCRIPTIVO
 *   Certificado de cumplimiento normativo     | NORMATIVO siempre (sin toggle)
 *   Cards / dashboards / MaterialDetailPage   | DUAL DISPLAY (DualVeredictoBadge)
 *   Sugerencia automática de mezclas          | NORMATIVO (filtro conservador interno)
 *   Alertas reactivas (hooks Sequelize)        | NORMATIVO (todo riesgo dispara)
 *
 * Back-compat: los nombres viejos `MODO_PRESTACIONAL` y `MODO_PRESCRIPTIVO`
 * siguen exportándose como aliases (`@deprecated`) para no romper callers
 * que aún no migraron. `normalizarModo` mapea los strings viejos al
 * canónico nuevo. Una vez migrados todos los callers, los aliases se
 * eliminan en un PR posterior.
 *
 * Shape común del resultado (`EvaluacionResult`):
 *
 *   {
 *     modo: 'NORMATIVO' | 'DESCRIPTIVO',
 *     fuente: string,
 *     itemsVisibles: Array<Item>,
 *     ensayosFaltantes: Array<{
 *       codigo, nombre, normaRef, motivo,
 *       severidad: 'obligatorio' | 'recomendado'
 *     }>,
 *     ensayosNoConcluyentes: Array<{
 *       codigo, nombre, normaRef, valor, limite, motivo
 *     }>,
 *     desviosNormativos: Array<{
 *       codigo, nombre, valor, limite, motivo,
 *       severidad: 'bloqueante' | 'no_bloqueante'
 *     }>,
 *     conteo: { ok, fail, condicional, faltantes, observaciones, noConcluyentes },
 *     veredicto: 'APTO' | 'APTO_CON_OBSERVACIONES' | 'NO_APTO' | 'INCOMPLETO' | null,
 *     notas: string[],
 *   }
 *
 *   El modo DESCRIPTIVO devuelve `veredicto: null` y `desviosNormativos: []`:
 *   el engine descriptivo no juzga.
 *
 * NINGÚN engine tiene side effects: ni DB, ni HTTP, ni Sequelize.
 */

// ── Nombres canónicos (2026-05-28) ────────────────────────────────────
const MODO_DESCRIPTIVO = 'DESCRIPTIVO';
const MODO_NORMATIVO   = 'NORMATIVO';

// ── Aliases de back-compat (deprecados, migrar callers progresivamente) ─
/** @deprecated Usar MODO_DESCRIPTIVO. Mantiene el string viejo por compat. */
const MODO_PRESTACIONAL = 'PRESTACIONAL';
/** @deprecated Usar MODO_NORMATIVO. */
const MODO_PRESCRIPTIVO = 'PRESCRIPTIVO';

// MODOS_VALIDOS acepta ambos nombres para que `normalizarModo` los
// reconozca como entrada legítima. La salida de `normalizarModo` siempre
// es uno de los nombres canónicos nuevos.
const MODOS_VALIDOS = new Set([
  MODO_DESCRIPTIVO,
  MODO_NORMATIVO,
  MODO_PRESTACIONAL,  // alias entrada
  MODO_PRESCRIPTIVO,  // alias entrada
]);

const VEREDICTO = {
  APTO:                    'APTO',
  APTO_CON_OBSERVACIONES:  'APTO_CON_OBSERVACIONES',
  NO_APTO:                 'NO_APTO',
  INCOMPLETO:              'INCOMPLETO',
};

const SEVERIDAD_FALTANTE = {
  OBLIGATORIO: 'obligatorio',
  RECOMENDADO: 'recomendado',
};

const SEVERIDAD_DESVIO = {
  BLOQUEANTE:    'bloqueante',
  NO_BLOQUEANTE: 'no_bloqueante',
};

/**
 * Normaliza un modo provisto por el caller a uno de los nombres canónicos
 * nuevos. Mapea aliases viejos. Default DESCRIPTIVO si el valor no es
 * reconocible (modo más permisivo, default público de HormiQual).
 *
 *   'DESCRIPTIVO' | 'descriptivo'    → 'DESCRIPTIVO'
 *   'NORMATIVO'   | 'normativo'      → 'NORMATIVO'
 *   'PRESTACIONAL'                   → 'DESCRIPTIVO' (alias)
 *   'PRESCRIPTIVO'                   → 'NORMATIVO' (alias)
 *   cualquier otro                   → 'DESCRIPTIVO'
 */
function normalizarModo(modo) {
  if (typeof modo !== 'string') return MODO_DESCRIPTIVO;
  const upper = modo.toUpperCase();
  if (upper === MODO_DESCRIPTIVO || upper === MODO_PRESTACIONAL) return MODO_DESCRIPTIVO;
  if (upper === MODO_NORMATIVO   || upper === MODO_PRESCRIPTIVO) return MODO_NORMATIVO;
  return MODO_DESCRIPTIVO;
}

/**
 * Construye un EvaluacionResult vacío para usar como fallback cuando los
 * datos no alcanzan para evaluar.
 *
 * Nota arquitectónica: el engine SIEMPRE produce un veredicto (INCOMPLETO
 * por defecto). El "modo descriptivo no juzga" se hace cumplir en la capa
 * consumidora (PDF, UI): cuando `modo === DESCRIPTIVO`, la capa de
 * presentación omite las secciones de veredicto y compliance,
 * independientemente de lo que el engine haya producido. Esto evita romper
 * contratos del engine que asumen siempre tener `veredicto` no nulo.
 */
function emptyEvaluacionResult(modo, fuente = 'Sin datos') {
  return {
    modo: normalizarModo(modo),
    fuente,
    itemsVisibles: [],
    ensayosFaltantes: [],
    ensayosNoConcluyentes: [],
    desviosNormativos: [],
    conteo: { ok: 0, fail: 0, condicional: 0, faltantes: 0, observaciones: 0, noConcluyentes: 0 },
    veredicto: VEREDICTO.INCOMPLETO,
    notas: ['Sin datos suficientes para evaluar.'],
  };
}

module.exports = {
  // Nombres canónicos nuevos
  MODO_DESCRIPTIVO,
  MODO_NORMATIVO,
  // Aliases de back-compat (deprecados)
  MODO_PRESTACIONAL,
  MODO_PRESCRIPTIVO,
  // Constantes auxiliares
  MODOS_VALIDOS,
  VEREDICTO,
  SEVERIDAD_FALTANTE,
  SEVERIDAD_DESVIO,
  // Helpers
  normalizarModo,
  emptyEvaluacionResult,
};
