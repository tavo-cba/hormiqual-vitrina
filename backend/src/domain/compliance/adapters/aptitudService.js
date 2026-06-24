'use strict';

/**
 * Adapter: shape de `aptitudMaterialesService.verificarAptitudAF/AG()` ↔ ComplianceResult.
 *
 * El servicio devuelve por verificación:
 *   {
 *     material:       'AF'|'AG',
 *     items:          [{ key, parametro, valor, estado, detalle, conditions?, ... }],
 *     resultadoGlobal: 'cumple'|'cumple_con_atencion'|'cumple_condicional'|'no_cumple'|'incompleto',
 *     conditions:     [{ key, value?, description, source? }],   (agregadas de items)
 *     compliance:     ComplianceResult,                          (producción ad-hoc, no la tocamos)
 *     notas:          string[],
 *     normaRef:       string,
 *   }
 *
 * Cada item tiene un `estado` con un vocabulario propio:
 *   'cumple' | 'cumple_condicional' | 'cumple_con_atencion' | 'atencion'
 *   | 'no_cumple' | 'sin_dato' | 'pendiente' | 'no_concluyente'
 *   | 'informativo' | 'excepcion'
 *
 * Mapeo de items al canónico (10 estados):
 *   'cumple'              → pass
 *   'cumple_condicional'  → conditionalPass (con conditions del item)
 *   'cumple_con_atencion' → passWithObservations (observation desde detalle)
 *   'atencion'            → passWithObservations (observation desde detalle)
 *   'no_cumple'           → fail (severity null hasta Prompt 2)
 *   'sin_dato'            → notEvaluated (datos faltantes, problema técnico)
 *   'pendiente'           → inconclusive (registro existe, dato no interpretable)
 *   'no_concluyente'      → inconclusive (con detection_limit cuando esté)
 *   'informativo'         → informative
 *   'excepcion'           → passWithObservations (excepción normativa documentada,
 *                          ej: IRAM 1647 §3.2.3.4 b)
 *
 * Mapeo de resultadoGlobal al canónico (5 valores → 10 estados):
 *   'cumple'              → pass
 *   'cumple_condicional'  → conditionalPass (con conditions agregadas)
 *   'cumple_con_atencion' → passWithObservations
 *   'no_cumple'           → fail
 *   'incompleto'          → pending  (correcto: faltan ensayos exigibles, no es
 *                          falla técnica; dispara MATERIAL_SIN_ENSAYO en Prompt 4)
 *
 * NOTA: `aptitudMaterialesService.js` ya construye un campo `compliance`
 * internamente (líneas ~344-353) usando `Compliance.conditionalPass()` y
 * `fromLegacyEval()` (antes `fromAnyLegacy`, alias eliminado en Prompt 4
 * C6). Ese código se DEJA INTACTO. Este adapter es una API externa para
 * call sites que reciben el output completo del servicio y necesitan
 * derivar un ComplianceResult canónico, sin tocar la producción interna
 * del servicio (refactor de Prompt 2).
 */

const cr = require('../ComplianceResult');
const {
  Compliance,
  isPass,
  isFail,
  isConditionalPass,
  isPassWithObservations,
  isInformative,
  isInconclusive,
  isPending,
  STATUS,
} = cr;

/* ───────── Tablas de mapeo ───────── */

/**
 * Mapeo de estado de item (vocabulario aptitud) → factory de ComplianceResult.
 * Cada factory recibe el item completo y devuelve el resultado canónico.
 */
const ITEM_STATE_TO_BUILDER = Object.freeze({
  cumple: (item) => Compliance.pass({
    measured: _coerceMeasured(item.valor),
    limit: _coerceLimit(item),
    norm: _buildNormRef(item),
  }),

  cumple_condicional: (item) => {
    const conditions = Array.isArray(item.conditions) && item.conditions.length > 0
      ? item.conditions
      : [{
          key: 'unspecified',
          description: item.detalle || 'Cumple bajo condiciones no especificadas',
        }];
    return Compliance.conditionalPass({
      conditions,
      message: item.detalle || null,
      measured: _coerceMeasured(item.valor),
      limit: _coerceLimit(item),
      norm: _buildNormRef(item),
    });
  },

  cumple_con_atencion: (item) => Compliance.passWithObservations({
    observation: item.detalle || 'Cumple con observación técnica',
    measured: _coerceMeasured(item.valor),
    limit: _coerceLimit(item),
    norm: _buildNormRef(item),
  }),

  atencion: (item) => Compliance.passWithObservations({
    observation: item.detalle || 'Cumple con observación de atención',
    measured: _coerceMeasured(item.valor),
    limit: _coerceLimit(item),
    norm: _buildNormRef(item),
  }),

  no_cumple: (item) => Compliance.fail({
    reasons: [item.detalle || `No cumple ${item.parametro || item.key || ''}`.trim()],
    measured: _coerceMeasured(item.valor),
    limit: _coerceLimit(item),
    norm: _buildNormRef(item),
    // severity queda en null — el motor de aptitud no calcula bloqueante/no_bloqueante
    // todavía. Cuando lo calcule (Prompt 2), pasarlo por aquí.
  }),

  sin_dato: (item) => Compliance.notEvaluated({
    reason: `Sin datos para evaluar ${item.parametro || item.key || 'parámetro'}`,
    norm: _buildNormRef(item),
  }),

  pendiente: (item) => Compliance.inconclusive({
    reason: `Resultado del ensayo cualitativo no completado o no interpretable (no por ausencia del ensayo): ${item.parametro || item.key || ''}`.trim(),
    measured: _coerceMeasured(item.valor),
    limit: _coerceLimit(item),
    norm: _buildNormRef(item),
  }),

  no_concluyente: (item) => Compliance.inconclusive({
    reason: item.detalle || 'Resultado no concluyente',
    measured: _coerceMeasured(item.valor),
    limit: _coerceLimit(item),
    norm: _buildNormRef(item),
    // detection_limit no expuesto por el shape actual; se completará en
    // Prompt 2 cuando aptitudService incluya ese campo.
  }),

  informativo: (item) => Compliance.informative({
    message: item.detalle || null,
    measured: _coerceMeasured(item.valor),
    norm: _buildNormRef(item),
  }),

  excepcion: (item) => Compliance.passWithObservations({
    observation: item.detalle ||
      'Aprobado por excepción normativa documentada (sin detalle disponible)',
    measured: _coerceMeasured(item.valor),
    limit: _coerceLimit(item),
    norm: _buildNormRef(item),
  }),
});

/**
 * Mapeo de resultadoGlobal → factory de ComplianceResult.
 */
const GLOBAL_STATE_TO_BUILDER = Object.freeze({
  cumple: (verif) => Compliance.pass({
    norm: verif.normaRef || null,
  }),

  cumple_condicional: (verif) => {
    const conditions = Array.isArray(verif.conditions) && verif.conditions.length > 0
      ? verif.conditions
      : [{ key: 'unspecified', description: 'Cumple bajo condiciones no especificadas' }];
    return Compliance.conditionalPass({
      conditions,
      norm: verif.normaRef || null,
    });
  },

  cumple_con_atencion: (verif) => Compliance.passWithObservations({
    observation: _firstObservation(verif) ||
      'Cumple con observaciones técnicas en uno o más parámetros',
    norm: verif.normaRef || null,
  }),

  no_cumple: (verif) => Compliance.fail({
    reasons: _collectFailReasons(verif),
    norm: verif.normaRef || null,
  }),

  incompleto: (verif) => Compliance.pending({
    reason: 'Faltan ensayos requeridos para concluir el veredicto del material. ' +
      'Cargar los ensayos pendientes para completar la evaluación.',
    norm: verif.normaRef || null,
  }),
});

/* ───────── API pública ───────── */

/**
 * Convierte el output de `verificarAptitudAF/AG()` a un ComplianceResult
 * canónico que representa el veredicto GLOBAL del material.
 *
 * Si el caller necesita el detalle por item, usar `mapItemsToCompliance()`.
 *
 * @param {object} verif - Output del servicio (al menos { resultadoGlobal })
 * @returns {ComplianceResult}
 */
function fromAptitudServiceShape(verif) {
  if (!verif || typeof verif !== 'object') {
    return Compliance.notEvaluated({
      reason: 'Sin output de aptitudService para mapear',
    });
  }

  const global = verif.resultadoGlobal;
  if (!global) {
    return Compliance.notEvaluated({
      reason: 'aptitudService.resultadoGlobal ausente',
    });
  }

  const builder = GLOBAL_STATE_TO_BUILDER[global];
  if (!builder) {
    return Compliance.notEvaluated({
      reason: `aptitudService.resultadoGlobal "${global}" no reconocido`,
    });
  }

  return builder(verif);
}

/**
 * Convierte cada item del array `verif.items` a su ComplianceResult individual.
 * Devuelve un array paralelo (mismo orden y longitud).
 *
 * @param {object[]} items
 * @returns {ComplianceResult[]}
 */
function mapItemsToCompliance(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const builder = ITEM_STATE_TO_BUILDER[item.estado];
    if (!builder) {
      return Compliance.notEvaluated({
        reason: `Item.estado "${item.estado}" no reconocido (item: ${item.key || item.parametro || 'sin nombre'})`,
      });
    }
    return builder(item);
  });
}

/**
 * Convierte un ComplianceResult al shape esperado por aptitudService a nivel
 * GLOBAL. Devuelve un objeto con `resultadoGlobal` y `conditions` (cuando
 * corresponde).
 *
 * Lossy: 10 estados canónicos → 5 strings legacy. Estados que no tienen
 * equivalente directo (informative, expired, notApplicable, notEvaluated,
 * inconclusive) se colapsan a 'incompleto' por convención. Documentado.
 *
 * @param {ComplianceResult} r
 * @returns {{ resultadoGlobal: string, conditions?: object[], compliance: ComplianceResult }}
 */
function toAptitudServiceShape(r) {
  if (!r || !r.status) {
    throw new Error('toAptitudServiceShape: el resultado no tiene status');
  }

  const out = { compliance: r };

  if (isPass(r)) {
    out.resultadoGlobal = 'cumple';
    return out;
  }
  if (isPassWithObservations(r)) {
    out.resultadoGlobal = 'cumple_con_atencion';
    return out;
  }
  if (isConditionalPass(r)) {
    out.resultadoGlobal = 'cumple_condicional';
    out.conditions = (r.conditions || []).map((c) => ({ ...c }));
    return out;
  }
  if (isFail(r)) {
    out.resultadoGlobal = 'no_cumple';
    return out;
  }
  if (isPending(r)) {
    out.resultadoGlobal = 'incompleto';
    return out;
  }
  // Resto (inconclusive, notEvaluated, informative, expired, notApplicable):
  // colapsan a 'incompleto'. La canónica preserva la información en `compliance`.
  out.resultadoGlobal = 'incompleto';
  return out;
}

/* ───────── Helpers privados ───────── */

/**
 * Convierte el campo `valor` del item a un measured aceptable por la canónica.
 * El item.valor puede venir como number, string ('< 0,01', '>= 500'), o null.
 * Si tiene operador embebido, devolvemos null y dejamos que el caller use
 * detection_limit u observation para esa información — measured queda numérico
 * o nulo, no string-con-operador.
 */
function _coerceMeasured(valor) {
  if (valor == null) return null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string') {
    // Si hay operador embebido (< X, >= X, >X), no devolvemos string
    // con operador como measured. Mejor null — la información del operador
    // pertenece a otro lugar (detection_limit, observation).
    if (/^\s*[<>]=?\s*/.test(valor)) return null;
    // Strings cualitativos puros sí van como measured (ej: "Apto 1500/1000")
    return valor;
  }
  return null;
}

/**
 * Construye el `limit` canónico desde el item de aptitud.
 * El item puede tener `lim.max`, `lim.min`, `lim.maxStrict`, `lim.maxStandard`.
 */
function _coerceLimit(item) {
  if (!item) return null;
  // Limit dual (Tabla 3.4 CIRSOC, criterio strict/standard)
  if (item.maxStrict != null && item.maxStandard != null) {
    return { strict: item.maxStrict, standard: item.maxStandard };
  }
  // Banda con min/max
  if (item.min != null && item.max != null) {
    return { min: item.min, max: item.max };
  }
  // Límite máximo simple
  if (item.max != null) return item.max;
  // Límite mínimo simple
  if (item.min != null) return { min: item.min };
  return null;
}

/**
 * Construye la referencia normativa.
 */
function _buildNormRef(item) {
  if (!item) return null;
  if (item.norma && item.apartado) return `${item.norma} ${item.apartado}`;
  if (item.norma) return item.norma;
  return null;
}

/**
 * Toma la primera observación legible del verif global (notas o detalle de
 * algún item con observación).
 */
function _firstObservation(verif) {
  if (Array.isArray(verif.notas) && verif.notas.length > 0) return verif.notas[0];
  if (Array.isArray(verif.items)) {
    const conObs = verif.items.find((i) =>
      i.estado === 'cumple_con_atencion' || i.estado === 'atencion'
    );
    if (conObs && conObs.detalle) return conObs.detalle;
  }
  return null;
}

/**
 * Recolecta razones de falla desde los items no_cumple del verif.
 */
function _collectFailReasons(verif) {
  if (!Array.isArray(verif.items)) {
    return ['No cumple según verificación de aptitud (sin detalle por item disponible)'];
  }
  const failed = verif.items.filter((i) => i.estado === 'no_cumple');
  if (failed.length === 0) {
    return ['No cumple según resultadoGlobal (sin items con detalle)'];
  }
  return failed.map((i) => i.detalle || `${i.parametro || i.key} no cumple`);
}

module.exports = {
  fromAptitudServiceShape,
  toAptitudServiceShape,
  mapItemsToCompliance,
  // Tablas exportadas para inspección y tests
  ITEM_STATE_TO_BUILDER,
  GLOBAL_STATE_TO_BUILDER,
};
