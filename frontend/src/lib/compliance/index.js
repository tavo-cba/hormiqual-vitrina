/**
 * Módulo compliance (frontend) — espejo del backend canónico.
 *
 * El backend (hormiqual-backend/src/domain/compliance/ComplianceResult.js)
 * es la fuente de verdad. Acá replicamos la API porque el frontend hace
 * decisiones de presentación (qué color usar, qué label, qué categoría
 * visual). El frontend NO calcula veredictos agregados — eso lo hace el
 * backend (calcularVeredictoGlobal) y lo expone en el campo
 * `veredictoGlobal` del response de getResumen.
 *
 * 10 estados canónicos (sincronizados con backend):
 *   pass | fail | conditionalPass | inconclusive | notEvaluated
 *   passWithObservations | informative | expired | pending | notApplicable
 *
 * 7 categorías visuales (presentación):
 *   APTO | APTO CON OBSERVACIONES | APTITUD CONDICIONADA | NO APTO
 *   EVALUACIÓN INCOMPLETA | INFORMATIVO | NO APLICA
 *
 * Prompt 3 C2: sincronizado con backend, helpers de categoría visual
 * agregados, `aggregate()` eliminada (la agregación es lógica de dominio
 * que vive en backend; el frontend consume `veredictoGlobal` del response).
 */

/* ───────── 10 estados canónicos ───────── */

export const STATUS = Object.freeze({
  PASS:                   'pass',
  FAIL:                   'fail',
  CONDITIONAL_PASS:       'conditionalPass',
  INCONCLUSIVE:           'inconclusive',
  NOT_EVALUATED:          'notEvaluated',
  PASS_WITH_OBSERVATIONS: 'passWithObservations',
  INFORMATIVE:            'informative',
  EXPIRED:                'expired',
  PENDING:                'pending',
  NOT_APPLICABLE:         'notApplicable',
});

export const ALL_STATUSES = Object.freeze(Object.values(STATUS));

/* ───────── Builders (10) ───────── */

export const Compliance = {
  pass({ message, details = [], measured = null, limit = null, norm = null } = {}) {
    return Object.freeze({
      status: STATUS.PASS,
      message: message || null,
      details: Object.freeze([...details]),
      measured, limit, norm,
    });
  },

  fail({ reasons = [], expected, actual, details = [], severity = null, measured = null, limit = null, norm = null } = {}) {
    if (!Array.isArray(reasons) || reasons.length === 0) {
      throw new Error('Compliance.fail requiere al menos una razón en `reasons`');
    }
    return Object.freeze({
      status: STATUS.FAIL,
      reasons: Object.freeze([...reasons]),
      expected: expected ?? null,
      actual: actual ?? null,
      severity,
      details: Object.freeze([...details]),
      measured, limit, norm,
    });
  },

  conditionalPass({ conditions = [], message, details = [], measured = null, limit = null, norm = null } = {}) {
    if (!Array.isArray(conditions) || conditions.length === 0) {
      throw new Error('Compliance.conditionalPass requiere al menos una condición');
    }
    for (const c of conditions) {
      if (!c.key || !c.description) {
        throw new Error('Cada condition debe tener `key` y `description`');
      }
    }
    return Object.freeze({
      status: STATUS.CONDITIONAL_PASS,
      conditions: Object.freeze(conditions.map((c) => Object.freeze({ ...c }))),
      message: message || null,
      details: Object.freeze([...details]),
      measured, limit, norm,
    });
  },

  inconclusive({ reason, detection_limit = null, details = [], measured = null, limit = null, norm = null } = {}) {
    if (!reason) throw new Error('Compliance.inconclusive requiere `reason`');
    return Object.freeze({
      status: STATUS.INCONCLUSIVE,
      reason,
      detection_limit,
      details: Object.freeze([...details]),
      measured, limit, norm,
    });
  },

  notEvaluated({ reason = 'Sin datos de evaluación', details = [], norm = null } = {}) {
    return Object.freeze({
      status: STATUS.NOT_EVALUATED,
      reason,
      details: Object.freeze([...details]),
      norm,
    });
  },

  passWithObservations({ observation, message, details = [], measured = null, limit = null, norm = null } = {}) {
    if (!observation) throw new Error('Compliance.passWithObservations requiere `observation`');
    return Object.freeze({
      status: STATUS.PASS_WITH_OBSERVATIONS,
      observation,
      message: message || null,
      details: Object.freeze([...details]),
      measured, limit, norm,
    });
  },

  informative({ message, details = [], measured = null, norm = null } = {}) {
    return Object.freeze({
      status: STATUS.INFORMATIVE,
      message: message || null,
      details: Object.freeze([...details]),
      measured, norm,
    });
  },

  expired({ test_date = null, expiry_date = null, reason = null, details = [], norm = null } = {}) {
    return Object.freeze({
      status: STATUS.EXPIRED,
      test_date, expiry_date,
      reason: reason || (test_date && expiry_date
        ? `Ensayo del ${test_date} venció el ${expiry_date}`
        : 'Ensayo vencido'),
      details: Object.freeze([...details]),
      norm,
    });
  },

  pending({ reason = 'Ensayo exigible pendiente de carga', details = [], norm = null } = {}) {
    return Object.freeze({
      status: STATUS.PENDING,
      reason,
      details: Object.freeze([...details]),
      norm,
    });
  },

  notApplicable({ reason, details = [], norm = null } = {}) {
    if (!reason) throw new Error('Compliance.notApplicable requiere `reason`');
    return Object.freeze({
      status: STATUS.NOT_APPLICABLE,
      reason,
      details: Object.freeze([...details]),
      norm,
    });
  },
};

/* ───────── Type guards (10) ───────── */

export const isPass                 = (r) => r?.status === STATUS.PASS;
export const isFail                 = (r) => r?.status === STATUS.FAIL;
export const isConditionalPass      = (r) => r?.status === STATUS.CONDITIONAL_PASS;
export const isInconclusive         = (r) => r?.status === STATUS.INCONCLUSIVE;
export const isNotEvaluated         = (r) => r?.status === STATUS.NOT_EVALUATED;
export const isPassWithObservations = (r) => r?.status === STATUS.PASS_WITH_OBSERVATIONS;
export const isInformative          = (r) => r?.status === STATUS.INFORMATIVE;
export const isExpired              = (r) => r?.status === STATUS.EXPIRED;
export const isPending              = (r) => r?.status === STATUS.PENDING;
export const isNotApplicable        = (r) => r?.status === STATUS.NOT_APPLICABLE;

/** isAcceptable: pass + passWithObservations + conditionalPass cuentan como aptos. */
export const isAcceptable = (r) => isPass(r) || isPassWithObservations(r) || isConditionalPass(r);

/** isBlocking: bloquea emisión de certificado (semántica heurística context-free). */
export const isBlocking = (r) =>
  isFail(r) || isInconclusive(r) || isNotEvaluated(r) || isExpired(r) || isPending(r);

/* ───────── match() — 5 estados (legacy, deprecated) ───────── */

/**
 * @deprecated Para código nuevo, usar matchExt() con los 10 handlers.
 * match() colapsa los 5 estados nuevos a un default unificado para back-compat
 * con call sites del Prompt 1.
 */
export function match(r, handlers) {
  if (!r || !r.status) throw new Error('match: el resultado no tiene status');
  const required = ['pass', 'fail', 'conditionalPass', 'inconclusive', 'notEvaluated'];
  const missing = required.filter((k) => typeof handlers[k] !== 'function');
  if (missing.length > 0) throw new Error(`match: faltan handlers para: ${missing.join(', ')}`);
  switch (r.status) {
    case STATUS.PASS:                   return handlers.pass(r);
    case STATUS.FAIL:                   return handlers.fail(r);
    case STATUS.CONDITIONAL_PASS:       return handlers.conditionalPass(r);
    case STATUS.INCONCLUSIVE:           return handlers.inconclusive(r);
    case STATUS.NOT_EVALUATED:          return handlers.notEvaluated(r);
    // Estados nuevos: rutean al handler más cercano semánticamente.
    case STATUS.PASS_WITH_OBSERVATIONS: return handlers.pass(r);            // pass + obs
    case STATUS.INFORMATIVE:            return handlers.pass(r);            // info como pass
    case STATUS.EXPIRED:                return handlers.notEvaluated(r);    // sin dato vigente
    case STATUS.PENDING:                return handlers.notEvaluated(r);    // sin dato cargado
    case STATUS.NOT_APPLICABLE:         return handlers.notEvaluated(r);    // no exigible
    default: throw new Error(`match: status desconocido "${r.status}"`);
  }
}

/* ───────── matchExt() — 10 estados exhaustivos ───────── */

export function matchExt(r, handlers) {
  if (!r || !r.status) throw new Error('matchExt: el resultado no tiene status');
  const required = [
    'pass', 'fail', 'conditionalPass', 'inconclusive', 'notEvaluated',
    'passWithObservations', 'informative', 'expired', 'pending', 'notApplicable',
  ];
  const missing = required.filter((k) => typeof handlers[k] !== 'function');
  if (missing.length > 0) throw new Error(`matchExt: faltan handlers para: ${missing.join(', ')}`);
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

/* ───────── Adapter desde shape legacy ───────── */

/**
 * Convierte el shape del API legacy (`{ cumple, estado, mensaje, ... }`) a un
 * ComplianceResult canónico. Misma lógica que el backend, extendida en C2 para
 * cubrir los 5 estados nuevos cuando el legacy los expone.
 */
export function fromLegacyEval(legacy) {
  if (!legacy || typeof legacy !== 'object') {
    return Compliance.notEvaluated({ reason: 'Sin resultado del evaluador' });
  }
  const { cumple, estado, mensaje, condicional, condiciones } = legacy;
  // Defensa: ensayos reales en BD a veces traen `detalle` o `observaciones`
  // como null/undefined/string. Solo concatenamos si son arrays.
  const detalle = Array.isArray(legacy.detalle) ? legacy.detalle : [];
  const observaciones = Array.isArray(legacy.observaciones) ? legacy.observaciones : [];
  const allDetails = [...detalle, ...observaciones];

  // Si el legacy ya trae un `compliance` canónico anidado (post-C6 backend),
  // confiamos en él directamente.
  if (legacy.compliance && legacy.compliance.status && ALL_STATUSES.includes(legacy.compliance.status)) {
    return legacy.compliance;
  }

  if (legacy.informativo === true) {
    return Compliance.informative({ message: mensaje, details: allDetails });
  }

  if ((cumple === 'CUMPLE' || estado === 'CUMPLE') && condicional === true && Array.isArray(condiciones) && condiciones.length > 0) {
    return Compliance.conditionalPass({ conditions: condiciones, message: mensaje, details: allDetails });
  }

  if (cumple === 'CUMPLE' || estado === 'CUMPLE') {
    return Compliance.pass({ message: mensaje, details: allDetails });
  }
  if (cumple === 'NO_CUMPLE' || estado === 'NO_CUMPLE') {
    return Compliance.fail({
      reasons: [mensaje || 'No cumple con el criterio normativo'],
      details: allDetails,
    });
  }
  if (estado === 'NO_CONCLUYENTE') {
    return Compliance.inconclusive({ reason: mensaje || 'Resultado no concluyente', details: allDetails });
  }
  if (estado === 'SIN_PARAMETROS') {
    return Compliance.notEvaluated({ reason: mensaje || 'Sin parámetros de evaluación configurados', details: allDetails });
  }
  if (estado === 'PENDIENTE') {
    return Compliance.pending({ reason: mensaje || 'Ensayo pendiente de carga', details: allDetails });
  }
  if (estado === 'VENCIDO') {
    return Compliance.expired({ reason: mensaje || 'Ensayo vencido', details: allDetails });
  }
  return Compliance.notEvaluated({
    reason: mensaje || 'Estado no reconocido por el adaptador',
    details: allDetails,
  });
}

/* ───────── Categorías visuales (7) ───────── */

/**
 * Las 5 categorías canónicas del veredicto + 2 auxiliares para casos
 * a nivel item:
 *
 *   APTO                   — material apto sin observaciones (pass)
 *   APTO CON OBSERVACIONES — apto, con nota técnica (passWithObservations)
 *   APTITUD CONDICIONADA   — apto bajo condiciones explícitas (conditionalPass)
 *   NO APTO                — no apto (fail)
 *   EVALUACIÓN INCOMPLETA  — pending / inconclusive / notEvaluated / expired
 *   INFORMATIVO            — sin criterio de cumplimiento (informative)
 *   NO APLICA              — no exigible por contexto (notApplicable)
 */
export const VEREDICTO = Object.freeze({
  APTO:                       'APTO',
  APTO_CON_OBSERVACIONES:     'APTO CON OBSERVACIONES',
  APTITUD_CONDICIONADA:       'APTITUD CONDICIONADA',
  NO_APTO:                    'NO APTO',
  EVALUACION_INCOMPLETA:      'EVALUACIÓN INCOMPLETA',
  // PR2: estado neutro cuando la política del catálogo del tenant no requiere
  // evaluar parámetros para el contexto del agregado. Se distingue de
  // EVALUACIÓN INCOMPLETA (que indica parámetros exigibles pendientes).
  // Backend lo señala con flag `_aptitudNoDeterminada=true` en el compliance.
  APTITUD_NO_DETERMINADA:     'APTITUD NO DETERMINADA',
  INFORMATIVO:                'INFORMATIVO',
  NO_APLICA:                  'NO APLICA',
});

export const VEREDICTO_LABELS = Object.freeze({
  [STATUS.PASS]:                   VEREDICTO.APTO,
  [STATUS.PASS_WITH_OBSERVATIONS]: VEREDICTO.APTO_CON_OBSERVACIONES,
  [STATUS.CONDITIONAL_PASS]:       VEREDICTO.APTITUD_CONDICIONADA,
  [STATUS.FAIL]:                   VEREDICTO.NO_APTO,
  [STATUS.PENDING]:                VEREDICTO.EVALUACION_INCOMPLETA,
  [STATUS.INCONCLUSIVE]:           VEREDICTO.EVALUACION_INCOMPLETA,
  [STATUS.NOT_EVALUATED]:          VEREDICTO.EVALUACION_INCOMPLETA,
  [STATUS.EXPIRED]:                VEREDICTO.EVALUACION_INCOMPLETA,
  [STATUS.INFORMATIVE]:            VEREDICTO.INFORMATIVO,
  [STATUS.NOT_APPLICABLE]:         VEREDICTO.NO_APLICA,
});

/**
 * Mapea un ComplianceResult o un status string a una de las 7 categorías visuales.
 *
 * Acepta dos formas:
 *   - ComplianceResult completo: `{ status: 'pass', ... }`
 *   - Status string suelto: `'pass'`
 *
 * Útil dentro de .map() sobre items donde a veces solo está el status,
 * y en otros lugares donde el caller también necesita acceder a metadata.
 *
 * @param {ComplianceResult|string|null|undefined} input
 * @returns {string} Una de las 7 etiquetas canónicas (ver VEREDICTO).
 */
export function getCategoriaVeredicto(input) {
  if (!input) return VEREDICTO.EVALUACION_INCOMPLETA;
  // PR2: detectar flag custom `_aptitudNoDeterminada` antes del mapeo genérico
  // para distinguir de un notEvaluated regular.
  if (typeof input === 'object' && input._aptitudNoDeterminada === true) {
    return VEREDICTO.APTITUD_NO_DETERMINADA;
  }
  const status = typeof input === 'string' ? input : input.status;
  if (!status) return VEREDICTO.EVALUACION_INCOMPLETA;
  return VEREDICTO_LABELS[status] || VEREDICTO.EVALUACION_INCOMPLETA;
}

/* ───────── Colores por categoría (presentación) ───────── */

/**
 * Mapeo categoría → estilo visual. Cada entry trae:
 *   - severity:  PrimeReact severity ('success' | 'info' | 'warning' | 'danger' | 'secondary')
 *   - bgClass:   background Tailwind
 *   - textClass: text Tailwind
 *   - borderClass: border Tailwind
 *   - icon:      ícono PrimeReact recomendado (opcional, para distinguir
 *                APTO vs APTO CON OBSERVACIONES — D17)
 *   - hex:       hex color para PDFs y elementos sin Tailwind
 *
 * APTO y APTO CON OBSERVACIONES comparten severity 'success' y color verde,
 * pero difieren en `icon`: APTO_CON_OBSERVACIONES trae 'pi pi-info-circle'
 * para que el usuario distinga "cumple sin más" de "cumple con nota técnica"
 * (cierre parcial D17).
 */
export const CATEGORIA_COLORS = Object.freeze({
  [VEREDICTO.APTO]: Object.freeze({
    severity: 'success',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
    borderClass: 'border-green-300',
    icon: 'pi pi-check-circle',
    hex: '#16a34a',
  }),
  [VEREDICTO.APTO_CON_OBSERVACIONES]: Object.freeze({
    severity: 'success',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
    borderClass: 'border-green-300',
    icon: 'pi pi-info-circle',
    hex: '#15803d',
  }),
  [VEREDICTO.APTITUD_CONDICIONADA]: Object.freeze({
    severity: 'warning',
    bgClass: 'bg-orange-50',
    textClass: 'text-orange-700',
    borderClass: 'border-orange-300',
    icon: 'pi pi-exclamation-triangle',
    hex: '#d97706',
  }),
  [VEREDICTO.NO_APTO]: Object.freeze({
    severity: 'danger',
    bgClass: 'bg-red-50',
    textClass: 'text-red-700',
    borderClass: 'border-red-300',
    icon: 'pi pi-times-circle',
    hex: '#dc2626',
  }),
  [VEREDICTO.EVALUACION_INCOMPLETA]: Object.freeze({
    severity: 'info',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-700',
    borderClass: 'border-blue-300',
    icon: 'pi pi-clock',
    hex: '#1d4ed8',
  }),
  // PR2: APTITUD NO DETERMINADA — neutro, ni aprueba ni bloquea. Distinguible
  // de INFORMATIVO (gris claro, ítem individual sin criterio) por la severity
  // 'help' / icono distintivo. Visualmente indica "el sistema no tiene base
  // para emitir veredicto bajo la política actual del catálogo".
  [VEREDICTO.APTITUD_NO_DETERMINADA]: Object.freeze({
    severity: 'secondary',
    bgClass: 'bg-slate-50',
    textClass: 'text-slate-700',
    borderClass: 'border-slate-300',
    icon: 'pi pi-question-circle',
    hex: '#64748b',
  }),
  [VEREDICTO.INFORMATIVO]: Object.freeze({
    severity: 'secondary',
    bgClass: 'bg-gray-50',
    textClass: 'text-gray-700',
    borderClass: 'border-gray-300',
    icon: 'pi pi-info',
    hex: '#6b7280',
  }),
  [VEREDICTO.NO_APLICA]: Object.freeze({
    severity: 'secondary',
    bgClass: 'bg-gray-50',
    textClass: 'text-gray-500',
    borderClass: 'border-gray-200',
    icon: 'pi pi-minus-circle',
    hex: '#9ca3af',
  }),
});

/**
 * Retorna el config de color/estilo para una categoría visual o un compliance/status.
 * Acepta los mismos formatos que getCategoriaVeredicto (compliance, status string,
 * categoría label).
 */
export function getCategoriaColor(input) {
  // Si ya es una categoría label conocida, retornar directo.
  if (typeof input === 'string' && CATEGORIA_COLORS[input]) {
    return CATEGORIA_COLORS[input];
  }
  // Si es un compliance/status, mapearlo primero.
  const categoria = getCategoriaVeredicto(input);
  return CATEGORIA_COLORS[categoria] || CATEGORIA_COLORS[VEREDICTO.EVALUACION_INCOMPLETA];
}

/* ───────── Helpers de display legacy ─────────
 *
 * Prompt 4 C4: `getDisplayLabel`, `getDisplaySeverity` y `getDisplayColor`
 * ELIMINADOS. Eran helpers deprecated para back-compat de call sites que
 * esperaban strings UPPERCASE legacy ('CUMPLE'/'NO CUMPLE'/etc). Audit del
 * cierre de Prompt 3 confirmó 0 consumidores productivos en frontend
 * post-C9.x (toda la presentación migrada a `CumplimientoBadge` + helpers
 * canónicos); el último call site era en `lib/document-issuance/index.js`
 * y se migró en C3 al canónico `getCategoriaVeredicto`.
 *
 * Para presentación canónica usar:
 *   - `getCategoriaVeredicto(r)` → categoría visual canónica de 7 (APTO,
 *     APTO CON OBSERVACIONES, APTITUD CONDICIONADA, NO APTO,
 *     EVALUACIÓN INCOMPLETA, INFORMATIVO, NO APLICA).
 *   - `getCategoriaColor(r)`     → config completo de presentación (severity,
 *     bgClass, textClass, borderClass, icon, hex).
 *   - `getCategoriaPdfLabel/Color/Icon(r)` (en `pdfPresentation.js`) →
 *     equivalentes para PDFs.
 */
