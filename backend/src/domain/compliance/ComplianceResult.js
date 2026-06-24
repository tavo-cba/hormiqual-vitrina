'use strict';

/**
 * ComplianceResult — modelo unificado de resultados de evaluación normativa.
 *
 * Razón de existir: la API actual del evaluador devuelve strings sueltos
 * (`cumple: 'CUMPLE' | 'NO_CUMPLE' | 'NO_EVAL'`) que se interpretan distinto
 * en cada call site:
 *   - MaterialDetailPage.jsx:401 trata NO_EVAL como CUMPLE en cumpleGlobal (P0.3)
 *   - El motor de dosificación lee `status` y descarta condiciones (P1.4)
 *   - El default cuando no hay evaluador es NO_EVAL = "asumir que cumple" (P1.7)
 *
 * Este módulo introduce un tipo suma exhaustivo que obliga al caller a
 * manejar TODOS los casos. NotEvaluated NUNCA equivale a Pass.
 *
 * ─── Variantes core (5 históricas) ─────────────────────────────────────
 *   Pass              → cumple sin condiciones
 *   Fail              → no cumple, con razones (severity opcional)
 *   ConditionalPass   → cumple bajo ciertas condiciones (ej: "solo H ≤ 20")
 *   Inconclusive      → ensayo realizado pero resultado no determinante
 *                       (ej: precisión insuficiente, valor en zona ciega)
 *   NotEvaluated      → estado TÉCNICO INTERNO del motor: sin evaluador,
 *                       datos corruptos, error en el cálculo. NUNCA debe
 *                       interpretarse como "cumple por default".
 *
 * ─── Variantes de dominio normativo (5 nuevas) ────────────────────────
 *   PassWithObservations → cumple; nota técnica relevante que NO restringe
 *                          el uso (ej: granulometría individual fuera de
 *                          banda A-B; requiere combinación en mezcla)
 *   Informative          → ensayo sin requisito normativo (densidad, PUC,
 *                          MF) — se reporta el valor sin veredicto
 *   Expired              → ensayo realizado, válido en su momento, fuera
 *                          de vigencia normativa hoy
 *   Pending              → ensayo EXIGIBLE por el contexto y NO se realizó.
 *                          Falta hacer. Distinto de NotEvaluated, que es
 *                          un fallo del motor — Pending es del dominio.
 *   NotApplicable        → ensayo NO exigible por el contexto (ej: lajosidad
 *                          en agregado fino, materia orgánica en grueso).
 *                          No corresponde hacer.
 *
 * Diferencia entre los 4 estados "no positivos sin razones técnicas":
 *   • Inconclusive  — ensayo realizado, dato real pero no determinante
 *   • NotEvaluated  — fallo TÉCNICO del motor (no debería pasar en prod)
 *   • Pending       — exigible y falta (acción del usuario: hacer el ensayo)
 *   • NotApplicable — no exigible (acción: ninguna, registrar que no aplica)
 *
 * Uso:
 *   const r = Compliance.pass();
 *   const r = Compliance.fail({ reasons: ['valor 0,5% supera límite 0,1%'] });
 *   const r = Compliance.conditionalPass({
 *     conditions: [{ key: 'max_resistance_class', value: 'H20',
 *       description: 'Solo aplicable a hormigones de resistencia ≤ H20' }]
 *   });
 *   const r = Compliance.inconclusive({ reason: 'Precisión insuficiente' });
 *   const r = Compliance.notEvaluated({ reason: 'Sin datos' });
 *   const r = Compliance.passWithObservations({ observation: 'Granulometría individual fuera de banda; requiere combinación' });
 *   const r = Compliance.informative({ message: 'Densidad real reportada' });
 *   const r = Compliance.expired({ test_date: '2023-01-15', expiry_date: '2024-01-15' });
 *   const r = Compliance.pending({ reason: 'Cloruros exigible para hormigón con armadura' });
 *   const r = Compliance.notApplicable({ reason: 'Lajosidad no aplica a agregado fino' });
 *
 *   // match() — para los 5 estados core. Lanza si el status no es de los core.
 *   // matchExt() — para los 10 estados completos. Recomendado para código nuevo.
 */

const STATUS = Object.freeze({
  // Core (históricos)
  PASS:              'pass',
  FAIL:              'fail',
  CONDITIONAL_PASS:  'conditionalPass',
  INCONCLUSIVE:      'inconclusive',
  NOT_EVALUATED:     'notEvaluated',
  // Dominio normativo (nuevos)
  PASS_WITH_OBSERVATIONS: 'passWithObservations',
  INFORMATIVE:            'informative',
  EXPIRED:                'expired',
  PENDING:                'pending',
  NOT_APPLICABLE:         'notApplicable',
});

/** Subconjunto de status core (los que `match()` acepta). */
const CORE_STATUSES = Object.freeze([
  STATUS.PASS,
  STATUS.FAIL,
  STATUS.CONDITIONAL_PASS,
  STATUS.INCONCLUSIVE,
  STATUS.NOT_EVALUATED,
]);

/** Todos los status conocidos (los 10). */
const ALL_STATUSES = Object.freeze(Object.values(STATUS));

/* ───────── Validación de metadata estructurada ─────────
 *
 * Decisión arquitectónica (Commit 2): los builders validan TIPO y PRESENCIA
 * de metadata, NO la relación entre measured y limit.
 *
 * Razón: la consistencia semántica (¿measured cumple el límite?) depende del
 * sentido del comparador (≤ para sulfatos, ≥ para resistencia, banda para
 * granulometría). Esa lógica es del motor de evaluación, no del tipo de dato.
 * El builder solo asegura que la metadata sea estructuralmente válida; el
 * motor decide qué cuenta como pass/fail.
 *
 * Tipos aceptados:
 *   - measured:  number | string | null  (escalar; cualitativo o cuantitativo)
 *   - limit:     number | string | object plain | null
 *                  (number=límite simple, string=simbólico "≤ 5%",
 *                   object={min,max} para bandas estructuradas)
 *
 *                  ⚠ CONVENCIÓN ÚNICA PARA BANDAS:
 *                  La forma esperada para una banda es LITERALMENTE
 *                  `{ min: number, max: number }`. NO uses sinónimos como
 *                  `{ minimum, maximum }`, `{ low, high }`, `{ from, to }`,
 *                  ni rangos por componente. La canónica acepta cualquier
 *                  objeto plain (validación es estructural), pero los
 *                  consumidores aguas abajo (motor, PDFs, UI) asumen
 *                  `{ min, max }`. Romper la convención produce bugs
 *                  silenciosos donde la banda parece válida pero nadie
 *                  la lee correctamente.
 *
 *   - norm:      string | null  (referencia normativa: "IRAM 1512 §5.2.2")
 *   - severity:  'bloqueante' | 'no_bloqueante' | null  (solo en fail)
 *   - detection_limit: number | string | null  (solo en inconclusive)
 *
 * Cuando los campos están AUSENTES (undefined), el builder los normaliza a
 * null y nada falla — todos los call sites históricos siguen funcionando.
 */

const SEVERITY_VALUES = Object.freeze(['bloqueante', 'no_bloqueante']);

function _isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function _validateMeasured(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  throw new Error(
    `metadata.measured debe ser number, string o null. Recibido: ${typeof v}` +
    (Array.isArray(v) ? ' (array)' : '')
  );
}

function _validateLimit(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  if (_isPlainObject(v)) return Object.freeze({ ...v });
  throw new Error(
    `metadata.limit debe ser number, string, object plain (ej: {min,max}) o null. Recibido: ${typeof v}` +
    (Array.isArray(v) ? ' (array)' : '')
  );
}

function _validateNorm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  throw new Error(`metadata.norm debe ser string o null. Recibido: ${typeof v}`);
}

function _validateSeverity(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && SEVERITY_VALUES.includes(v)) return v;
  throw new Error(
    `metadata.severity debe ser uno de: ${SEVERITY_VALUES.join(', ')} o null. Recibido: ${JSON.stringify(v)}`
  );
}

function _validateDetectionLimit(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  throw new Error(`metadata.detection_limit debe ser number, string o null. Recibido: ${typeof v}`);
}

/**
 * Builders.
 */
const Compliance = {
  pass({ message, details = [], rulesApplied = [], measured, limit, norm } = {}) {
    return Object.freeze({
      status: STATUS.PASS,
      message: message || null,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      measured: _validateMeasured(measured),
      limit:    _validateLimit(limit),
      norm:     _validateNorm(norm),
    });
  },

  fail({ reasons = [], expected, actual, details = [], rulesApplied = [],
        measured, limit, norm, severity } = {}) {
    if (!Array.isArray(reasons) || reasons.length === 0) {
      throw new Error('Compliance.fail requiere al menos una razón en `reasons`');
    }
    return Object.freeze({
      status: STATUS.FAIL,
      reasons: Object.freeze([...reasons]),
      expected: expected ?? null,
      actual: actual ?? null,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      measured: _validateMeasured(measured),
      limit:    _validateLimit(limit),
      norm:     _validateNorm(norm),
      severity: _validateSeverity(severity),
    });
  },

  conditionalPass({ conditions = [], message, details = [], rulesApplied = [],
                    measured, limit, norm } = {}) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      throw new Error('Compliance.conditionalPass requiere al menos una condición');
    }
    // Cada condition debe tener: { key, value?, description }
    for (const c of conditions) {
      if (!c.key || !c.description) {
        throw new Error('Cada condition debe tener `key` y `description`');
      }
    }
    return Object.freeze({
      status: STATUS.CONDITIONAL_PASS,
      conditions: Object.freeze(conditions.map((c) => Object.freeze({ ...c }))),
      message: message || null,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      measured: _validateMeasured(measured),
      limit:    _validateLimit(limit),
      norm:     _validateNorm(norm),
    });
  },

  /**
   * Resultado no determinante. Distinguir cuidadosamente del Pass/Fail con
   * `measured: 0` o `measured: null`:
   *
   *   ✓ USAR Inconclusive cuando el laboratorio reportó "< X" indicando que
   *     el valor real está por debajo del límite de detección X y NO se
   *     puede afirmar cumplimiento contra el límite normativo.
   *     Ej: cloruros con detección "< 0,01%" cuando el límite es 0,04% pero
   *     la precisión requerida es ≤ 0,003%.
   *     → Compliance.inconclusive({ reason: '...', detection_limit: 0.01 })
   *
   *   ✗ NO usar Pass con measured: 0 si el laboratorio reportó "< X". Eso
   *     pierde información crítica: el valor real podría ser cualquiera entre
   *     0 y X, y "0" implica una medición que no se hizo.
   *
   *   ✓ USAR Pass con measured: 0 SOLO si el laboratorio efectivamente midió
   *     y obtuvo cero exacto (raro, pero posible en cloruros bajo agua de
   *     amasado de origen controlado).
   */
  inconclusive({ reason, details = [], rulesApplied = [],
                 measured, limit, norm, detection_limit } = {}) {
    if (!reason) throw new Error('Compliance.inconclusive requiere `reason`');
    return Object.freeze({
      status: STATUS.INCONCLUSIVE,
      reason,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      measured:        _validateMeasured(measured),
      limit:           _validateLimit(limit),
      norm:            _validateNorm(norm),
      detection_limit: _validateDetectionLimit(detection_limit),
    });
  },

  notEvaluated({ reason = 'Sin datos de evaluación', details = [], rulesApplied = [],
                 norm } = {}) {
    return Object.freeze({
      status: STATUS.NOT_EVALUATED,
      reason,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      norm: _validateNorm(norm),
    });
  },

  /* ─── Variantes de dominio normativo (10-state extension) ─── */

  /**
   * Cumple sin restricciones de uso, pero con una observación técnica relevante
   * que se debe registrar (ej: granulometría individual fuera de banda A-B
   * que se compensa con la combinación en mezcla; suma de sustancias nocivas
   * cerca del límite).
   */
  passWithObservations({ observation, message, details = [], rulesApplied = [],
                         measured, limit, norm } = {}) {
    if (!observation || typeof observation !== 'string' || observation.trim() === '') {
      throw new Error('Compliance.passWithObservations requiere `observation` no vacía');
    }
    return Object.freeze({
      status: STATUS.PASS_WITH_OBSERVATIONS,
      observation,
      message: message || null,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      measured: _validateMeasured(measured),
      limit:    _validateLimit(limit),
      norm:     _validateNorm(norm),
    });
  },

  /**
   * Ensayo informativo: no aplica criterio normativo de cumplimiento (densidad
   * real, peso unitario, módulo de finura como dato puro). Se reporta el valor
   * sin emitir un veredicto Pass/Fail. Distinto de Pass — no afirma cumplimiento,
   * informa.
   */
  informative({ message, details = [], rulesApplied = [],
                measured, norm } = {}) {
    return Object.freeze({
      status: STATUS.INFORMATIVE,
      message: message || null,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      measured: _validateMeasured(measured),
      norm:     _validateNorm(norm),
      // No incluye `limit`: por definición el ensayo informativo no tiene
      // criterio de cumplimiento. Si un caller pasa limit, lo ignoramos
      // silenciosamente — es semánticamente incoherente y no queremos
      // permitir que se cuele a propagarse.
    });
  },

  /**
   * Ensayo realizado y válido en su momento, fuera de vigencia hoy. Requiere
   * fechas para que el caller pueda mostrar el período y calcular cuánto hace
   * que venció.
   */
  expired({ test_date, expiry_date, reason, details = [], rulesApplied = [],
            measured, limit, norm } = {}) {
    if (!test_date) {
      throw new Error('Compliance.expired requiere `test_date`');
    }
    if (!expiry_date) {
      throw new Error('Compliance.expired requiere `expiry_date`');
    }
    return Object.freeze({
      status: STATUS.EXPIRED,
      test_date,
      expiry_date,
      reason: reason || null,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      measured: _validateMeasured(measured),
      limit:    _validateLimit(limit),
      norm:     _validateNorm(norm),
    });
  },

  /**
   * Ensayo EXIGIBLE en el contexto y NO se realizó. Acción del usuario: hacer
   * el ensayo. Distinto de NotEvaluated, que es un fallo TÉCNICO del motor
   * (sin evaluador, datos corruptos). Pending es del dominio normativo.
   */
  pending({ reason, details = [], rulesApplied = [], norm } = {}) {
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('Compliance.pending requiere `reason` no vacía');
    }
    return Object.freeze({
      status: STATUS.PENDING,
      reason,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      norm: _validateNorm(norm),
    });
  },

  /**
   * Ensayo NO exigible en el contexto (ej: lajosidad en agregado fino, materia
   * orgánica en grueso). No corresponde hacer. Distinto de NotEvaluated y
   * Pending: acá sí sabemos que no hay nada que evaluar.
   */
  notApplicable({ reason, details = [], rulesApplied = [], norm } = {}) {
    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      throw new Error('Compliance.notApplicable requiere `reason` no vacía');
    }
    return Object.freeze({
      status: STATUS.NOT_APPLICABLE,
      reason,
      details: Object.freeze(details),
      rulesApplied: Object.freeze([...rulesApplied]),
      norm: _validateNorm(norm),
    });
  },
};

/**
 * Constantes públicas: valores válidos para metadata.severity (en fail).
 */
const SEVERITY = Object.freeze({
  BLOQUEANTE:    'bloqueante',
  NO_BLOQUEANTE: 'no_bloqueante',
});

/* ───────── Predicados ───────── */

const isPass            = (r) => r?.status === STATUS.PASS;
const isFail            = (r) => r?.status === STATUS.FAIL;
const isConditionalPass = (r) => r?.status === STATUS.CONDITIONAL_PASS;
const isInconclusive    = (r) => r?.status === STATUS.INCONCLUSIVE;
const isNotEvaluated    = (r) => r?.status === STATUS.NOT_EVALUATED;

const isPassWithObservations = (r) => r?.status === STATUS.PASS_WITH_OBSERVATIONS;
const isInformative          = (r) => r?.status === STATUS.INFORMATIVE;
const isExpired              = (r) => r?.status === STATUS.EXPIRED;
const isPending              = (r) => r?.status === STATUS.PENDING;
const isNotApplicable        = (r) => r?.status === STATUS.NOT_APPLICABLE;

/**
 * Indica si el resultado es "aceptable" para fines de emisión de un certificado
 * SIN restricciones. ConditionalPass NO cuenta porque requiere validar contexto.
 *
 * Mantiene la semántica histórica estricta: solo Pass clásico. Los nuevos
 * estados (PassWithObservations, Informative, NotApplicable) se evalúan
 * con predicados específicos para que cada caller decida explícitamente
 * qué considera "aceptable" en su contexto.
 *
 * Crítico: NotEvaluated siempre es false. Esto resuelve el bug raíz de P0.3.
 */
const isAcceptable = (r) => isPass(r);

/**
 * Indica si bloquea la emisión de un certificado, evaluado de forma
 * CONTEXT-FREE (sin saber para qué se está usando el material/ensayo).
 *
 * Bloquean: Fail, Inconclusive, NotEvaluated, Pending, Expired.
 *   - Fail/Inconclusive/NotEvaluated: contrato histórico (no podemos certificar
 *     lo que no medimos o lo que falló).
 *   - Pending: ensayo exigible y falta — no se puede certificar sin él.
 *   - Expired: dato fuera de vigencia — equivale a faltante a fines de certificación.
 *
 * NO bloquean: Pass, PassWithObservations, ConditionalPass, Informative,
 * NotApplicable.
 *   - ConditionalPass: requiere validación de contexto, no bloqueo automático.
 *   - PassWithObservations: cumple, solo se anota.
 *   - Informative/NotApplicable: no hay criterio que evaluar.
 *
 * ⚠ LIMITACIÓN IMPORTANTE — context-free heuristic
 * "Bloqueante" en nuestro modelo es context-dependent:
 *   - Un Pending bloquea SOLO si el ensayo es exigible para el contexto de uso.
 *     Ej: lajosidad pendiente NO bloquea hormigón doméstico H-17, pero SÍ
 *     bloquea pavimento H-30. Acá no sabemos el contexto.
 *   - Un Expired igual: un ensayo de PUC vencido puede ser irrelevante para
 *     ciertos usos.
 *   - Un Fail con severity=no_bloqueante (Commit 2) es informativo, no bloquea.
 *
 * Esta función trata el resultado de forma aislada y aplica la heurística más
 * estricta posible — útil para la generación de alertas (donde queremos
 * notificar siempre que hay un faltante) pero INSUFICIENTE para el árbol de
 * veredictos globales.
 *
 * Para el árbol de veredictos globales, en Prompt 2 se introducirá
 * `isBlockingInContext(result, usageContext)` que sí considerará exigibilidad,
 * severity, y otras dimensiones del contexto de uso.
 *
 * Mientras tanto, los call sites que necesiten precisión deben:
 *   - Para alertas: usar `isBlocking` (este) — fail-loud está OK.
 *   - Para veredicto de aptitud / certificación: NO confiar solo en `isBlocking`.
 *     Usar el `status` directo y combinarlo con el contexto explícitamente.
 */
const isBlocking = (r) =>
  isFail(r) || isInconclusive(r) || isNotEvaluated(r) || isPending(r) || isExpired(r);

/* ───────── Match exhaustivo ─────────
 *
 * Prompt 4 C5: el helper `match()` legacy (5 estados core) fue ELIMINADO.
 * `matchExt` (10 estados, exhaustivo) es el único helper de pattern-matching
 * del módulo. Audit del cierre de Prompt 3 confirmó 0 consumidores
 * productivos de `match()` — solo se usaba en tests del propio helper.
 *
 * Cualquier código nuevo o existente debe usar `matchExt(r, handlers)` con
 * los 10 handlers obligatorios: pass, fail, conditionalPass, inconclusive,
 * notEvaluated, passWithObservations, informative, expired, pending,
 * notApplicable. Esto fuerza el análisis de exhaustividad — no hay caso
 * default que se pase por alto.
 */

/**
 * Match exhaustivo sobre los 10 estados completos. Recomendado para código
 * nuevo y para todo lugar que pueda ver resultados de dominio normativo.
 *
 * Forza al caller a manejar TODAS las variantes — equivalente a un match en
 * lenguajes con sum types con análisis de exhaustividad.
 *
 * @param {ComplianceResult} r
 * @param {Object} handlers - los 10 handlers:
 *   { pass, fail, conditionalPass, inconclusive, notEvaluated,
 *     passWithObservations, informative, expired, pending, notApplicable }
 * @returns {*} lo que retorne el handler invocado
 */
function matchExt(r, handlers) {
  if (!r || !r.status) {
    throw new Error('matchExt: el resultado no tiene status');
  }
  const required = [
    'pass', 'fail', 'conditionalPass', 'inconclusive', 'notEvaluated',
    'passWithObservations', 'informative', 'expired', 'pending', 'notApplicable',
  ];
  const missing = required.filter((k) => typeof handlers[k] !== 'function');
  if (missing.length > 0) {
    throw new Error(`matchExt: faltan handlers para: ${missing.join(', ')}`);
  }
  switch (r.status) {
    case STATUS.PASS:                   return handlers.pass(r);
    case STATUS.FAIL:                   return handlers.fail(r);
    case STATUS.CONDITIONAL_PASS:       return handlers.conditionalPass(r);
    case STATUS.INCONCLUSIVE:           return handlers.inconclusive(r);
    case STATUS.NOT_EVALUATED:          return handlers.notEvaluated(r);
    case STATUS.PASS_WITH_OBSERVATIONS: return handlers.passWithObservations(r);
    case STATUS.INFORMATIVE:            return handlers.informative(r);
    case STATUS.EXPIRED:                return handlers.expired(r);
    case STATUS.PENDING:                return handlers.pending(r);
    case STATUS.NOT_APPLICABLE:         return handlers.notApplicable(r);
    default: throw new Error(`matchExt: status desconocido "${r.status}"`);
  }
}

/* ───────── Adaptador desde el evaluador legacy ───────── */

/**
 * Normaliza un string legacy de estado a uno de los grupos canónicos.
 * Bloque C — adapter approach para P1.11: en lugar de reescribir 200+
 * call sites, centralizamos la traducción acá y la aplicamos en los
 * 4 puntos de salida (PDFs, UI, JSON API, decisiones de negocio).
 */
function normalizeLegacyStatus(s) {
  if (s == null) return null;
  const u = String(s).trim().toUpperCase();
  // Tabla de equivalencias: cubre los strings detectados en la auditoría v2
  const map = {
    'CUMPLE': 'PASS',
    'NO_CUMPLE': 'FAIL',
    'CUMPLE_CON_TOLERANCIA': 'PASS_WITH_OBSERVATIONS', // §3.2.4 IRAM 1627
    'CUMPLE_CON_ATENCION': 'PASS_WITH_OBSERVATIONS',
    'CUMPLE_CONDICIONAL': 'CONDITIONAL_PASS',
    'CUMPLE_AC': 'CONDITIONAL_PASS',                   // CIRSOC §3.2.3.2 f)
    'CONDITIONAL_PASS': 'CONDITIONAL_PASS',
    'NO_CONCLUYENTE': 'INCONCLUSIVE',
    'INCONCLUSIVE': 'INCONCLUSIVE',
    'SIN_PARAMETROS': 'NOT_EVALUATED',
    'SIN_DATO': 'NOT_EVALUATED',
    'SIN_DATOS': 'NOT_EVALUATED',
    'NO_EVAL': 'NOT_EVALUATED',
    'NO_EVALUADO': 'NOT_EVALUATED',
    'NOT_EVALUATED': 'NOT_EVALUATED',
    'INFORMATIVO': 'PASS',                             // mismo trato que el código existente
    'INCOMPLETO': 'NOT_EVALUATED',
    'ATENCION': 'PASS_WITH_OBSERVATIONS',
  };
  return map[u] || null;
}

/**
 * Convierte el resultado del ensayoEvalEngine (o cualquier evaluador legacy)
 * a un ComplianceResult.
 *
 * Mapeo (ver `normalizeLegacyStatus` para tabla completa):
 *   CUMPLE, informativo                   → Pass
 *   NO_CUMPLE                              → Fail
 *   CUMPLE_CON_TOLERANCIA, ATENCION, etc → PassWithObservations (Pass con detalle)
 *   CUMPLE_CONDICIONAL, CUMPLE_AC          → ConditionalPass
 *   NO_CONCLUYENTE                         → Inconclusive
 *   SIN_PARAMETROS, SIN_DATO, etc          → NotEvaluated
 *   `result.condicional === true`          → ConditionalPass (override)
 *
 * @param {Object|string} legacy
 * @returns {ComplianceResult}
 */
function fromLegacyEval(legacy) {
  if (!legacy) {
    return Compliance.notEvaluated({ reason: 'Sin resultado del evaluador' });
  }

  // Si el caller pasó solo un string, normalizar y emitir el más cercano.
  // Nota: `CONDITIONAL_PASS` y `PASS_WITH_OBSERVATIONS` desde un string puro
  // (sin conditions[] ni mensaje) caen a Pass — el adapter no puede inventar
  // las conditions; el caller debe pasar un objeto con la información completa
  // si quiere el shape estructurado.
  if (typeof legacy === 'string') {
    const norm = normalizeLegacyStatus(legacy);
    if (norm === 'PASS')                    return Compliance.pass();
    if (norm === 'PASS_WITH_OBSERVATIONS')  return Compliance.pass({ message: legacy, details: [legacy] });
    if (norm === 'CONDITIONAL_PASS')        return Compliance.pass({ message: `${legacy} (condicional sin datos para detalle)`, details: [legacy] });
    if (norm === 'FAIL')                    return Compliance.fail({ reasons: [`No cumple (${legacy})`] });
    if (norm === 'INCONCLUSIVE')            return Compliance.inconclusive({ reason: `Inconcluyente (${legacy})` });
    if (norm === 'NOT_EVALUATED')           return Compliance.notEvaluated({ reason: `Sin datos (${legacy})` });
    return Compliance.notEvaluated({ reason: `Estado "${legacy}" no reconocido` });
  }

  if (typeof legacy !== 'object') {
    return Compliance.notEvaluated({ reason: 'Tipo de input no soportado' });
  }

  // Si ya es un ComplianceResult válido, passthrough
  if (legacy.status && ['pass', 'fail', 'conditionalPass', 'inconclusive', 'notEvaluated'].includes(legacy.status)) {
    return legacy;
  }

  const { cumple, estado, mensaje, detalle = [], observaciones = [], condicional, condiciones } = legacy;

  // Aditivos / informativos: tratar como Pass (no aplica criterio de cumplimiento)
  if (legacy.informativo === true) {
    return Compliance.pass({
      message: mensaje || 'Ensayo informativo — sin criterio de cumplimiento',
      details: [...detalle, ...observaciones],
    });
  }

  // Pass condicional explícito (legacy explicit flag)
  if (Array.isArray(condiciones) && condiciones.length > 0 && (condicional === true || normalizeLegacyStatus(estado || cumple) === 'CONDITIONAL_PASS')) {
    return Compliance.conditionalPass({
      conditions: condiciones,
      message: mensaje,
      details: [...detalle, ...observaciones],
    });
  }

  // Normalizar cualquier string que venga en cumple/estado a través de la tabla
  const norm = normalizeLegacyStatus(estado) || normalizeLegacyStatus(cumple);

  if (norm === 'CONDITIONAL_PASS' && Array.isArray(legacy.conditions) && legacy.conditions.length > 0) {
    return Compliance.conditionalPass({
      conditions: legacy.conditions,
      message: mensaje,
      details: [...detalle, ...observaciones],
    });
  }

  if (norm === 'PASS') {
    return Compliance.pass({ message: mensaje, details: [...detalle, ...observaciones] });
  }
  if (norm === 'PASS_WITH_OBSERVATIONS') {
    // Pass con observaciones se modela como Pass con detalle (no es status separado).
    const obs = mensaje || 'Cumple con observaciones';
    return Compliance.pass({
      message: obs,
      details: [obs, ...detalle, ...observaciones],
    });
  }
  if (norm === 'FAIL') {
    return Compliance.fail({
      reasons: [mensaje || 'No cumple con el criterio normativo'],
      details: [...detalle, ...observaciones],
    });
  }
  if (norm === 'INCONCLUSIVE') {
    return Compliance.inconclusive({
      reason: mensaje || 'Resultado no concluyente',
      details: [...detalle, ...observaciones],
    });
  }
  if (norm === 'NOT_EVALUATED') {
    return Compliance.notEvaluated({
      reason: mensaje || 'Sin parámetros de evaluación configurados',
      details: [...detalle, ...observaciones],
    });
  }

  // Default seguro: NotEvaluated. NUNCA Pass por default.
  return Compliance.notEvaluated({
    reason: mensaje || `Estado "${estado || cumple || 'desconocido'}" no reconocido`,
    details: [...detalle, ...observaciones],
  });
}

/*
 * Prompt 4 C6: `fromAnyLegacy` (alias de `fromLegacyEval`) ELIMINADO. Era un
 * alias semántico introducido en Bloque C v4 para sugerir a call sites nuevos
 * que el adapter manejaba CUALQUIER string legacy. Tras la migración del
 * dispatcher de alertas (C2 — único consumidor productivo backend) y la
 * eliminación previa del consumidor frontend (Prompt 3 C2), el alias queda
 * sin usuarios. La función canónica `fromLegacyEval` cubre todos los inputs
 * (strings, objetos legacy, null/undefined) — usar ese nombre directo.
 */

/* ───────── Helpers de display ─────────
 *
 * Prompt 4 C4: `_UPPERCASE_OVERRIDES`, `getDisplayLabel` y `getDisplayColor`
 * ELIMINADOS. Eran helpers deprecated para back-compat de los call sites
 * pre-Prompt 3 que esperaban strings UPPERCASE legacy. Audit del cierre de
 * Prompt 3 confirmó 0 consumidores productivos en el backend; el frontend
 * los consumía en `lib/document-issuance/index.js:85,121` (sub-deuda D1)
 * que se migró en C3 al canónico.
 *
 * Para presentación de etiquetas usar:
 *   - `getLongLabel(r)`  / `getShortLabel(r)` → labels canónicas en title case (`./labels`)
 *   - `getSeverity(r)`                        → token PrimeReact (`./labels`)
 *   - `getIcon(r)`                            → ícono FontAwesome (`./labels`)
 *   - `getColor(r)`                           → tupla RGB (`./labels`)
 *   - frontend: `getCategoriaVeredicto(r)`    → categoría visual canónica de 7 (`lib/compliance`)
 *   - PDFs:    `getCategoriaPdfLabel(r)`      → label canónico para PDF (`lib/compliance/pdfPresentation`)
 */

module.exports = {
  STATUS,
  CORE_STATUSES,
  ALL_STATUSES,
  SEVERITY,
  Compliance,
  // Predicados core
  isPass,
  isFail,
  isConditionalPass,
  isInconclusive,
  isNotEvaluated,
  // Predicados extendidos
  isPassWithObservations,
  isInformative,
  isExpired,
  isPending,
  isNotApplicable,
  // Helpers semánticos
  isAcceptable,
  isBlocking,
  // Match (`match()` legacy eliminado en Prompt 4 C5; `matchExt` es el único)
  matchExt,
  // Adapters legacy (`fromAnyLegacy` alias eliminado en Prompt 4 C6 — usar `fromLegacyEval`)
  fromLegacyEval,
  normalizeLegacyStatus,
};
