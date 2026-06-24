'use strict';

/**
 * mezclaCompliance — wrapper que convierte los resultados del evaluador de
 * mezclas (mezclaService.evalAgainstSpec / evaluarBandaIRAM) al modelo
 * ComplianceResult con condiciones estructuradas.
 *
 * RAZÓN (P1.4):
 * El evaluador legacy devuelve `{ cumple: bool, estado: 'CUMPLE' | 'CUMPLE_AC' | 'NO_CUMPLE' }`.
 * `'CUMPLE_AC'` significa "cumple banda A-C pero no A-B" lo cual normativamente
 * implica "solo apto para hormigones H ≤ 20". Es una condición de aplicabilidad
 * crítica enterrada en un string, invisible para el motor de dosificación que
 * solo lee `cumple: true` y aprueba el material para cualquier resistencia.
 *
 * Este módulo:
 *   1. Convierte los resultados legacy a ComplianceResult con conditions[]
 *   2. Expone validateConditions() que el motor de dosificación llama para
 *      verificar que el contexto de uso satisface las condiciones declaradas
 */

const { Compliance } = require('./ComplianceResult');
const { NORM_REFS } = require('../normRef');

/**
 * Mapea un resultado de evaluación de mezcla (legacy) a ComplianceResult.
 *
 * @param {Object} legacy - resultado de evalAgainstSpec/evaluarBandaIRAM:
 *   { tipo, cumple, estado, fueraDeBanda, stats, series, mensaje, bandaEvaluada, ... }
 * @returns {ComplianceResult}
 */
function fromLegacyMezclaEval(legacy) {
  if (!legacy) {
    return Compliance.notEvaluated({ reason: 'Sin resultado del evaluador de mezcla' });
  }

  const { estado, cumple, mensaje, fueraDeBanda = [], bandaEvaluada } = legacy;

  // CUMPLE limpio (cumple A-B o cumple objetivo sin restricciones)
  if (estado === 'CUMPLE') {
    return Compliance.pass({
      message: mensaje || `Cumple ${bandaEvaluada || 'el objetivo'} sin observaciones`,
    });
  }

  // CUMPLE_AC — caso clave: cumple banda A-C pero no A-B.
  //
  // CITA NORMATIVA CORRECTA (v4 audit): el límite "H ≤ 20" NO viene de
  // IRAM 1627 §3.2.5 (que solo habla de "obras de tipo corriente con
  // control en obra" sin límite de resistencia). Viene de
  // CIRSOC 200:2024 §3.2.3.2 f), que es la regla VINCULANTE para uso
  // estructural en Argentina y exige DOS condiciones:
  //   1. Resistencia ≤ H-20
  //   2. Estudios de laboratorio O antecedentes de obras similares con
  //      comportamiento satisfactorio
  //
  // El sistema viejo solo registraba la condición 1. La condición 2 se
  // verifica vía repositorio de evidencias técnicas (TechnicalEvidence,
  // bloque K) y se libera mediante override del responsable técnico
  // cuando no hay evidencia cargada (también K).
  if (estado === 'CUMPLE_AC') {
    return Compliance.conditionalPass({
      conditions: [
        {
          key: 'max_resistance_class',
          value: 'H20',
          numericValueMpa: 20,
          description: 'Resistencia característica del hormigón ≤ H-20 MPa.',
          source: 'CIRSOC 200:2024 §3.2.3.2 f)',
        },
        {
          key: 'requires_technical_evidence',
          value: ['lab_study', 'prior_project'],
          description: 'Requiere estudios de laboratorio que demuestren cumplimiento del proyecto, o antecedentes de obras similares con comportamiento en servicio satisfactorio.',
          source: 'CIRSOC 200:2024 §3.2.3.2 f)',
        },
      ],
      rulesApplied: [
        NORM_REFS.CIRSOC_3_2_3_2_F,                        // vinculante
        NORM_REFS.IRAM_1627_3_2_5,                         // referencia complementaria
      ],
      message: mensaje || 'Cumple banda A-C pero no A-B. Liberación condicionada a CIRSOC §3.2.3.2 f).',
      details: fueraDeBanda.map((f) => `Tamiz ${f.tamiz || f.aberturaMm}: ${f.desvio?.toFixed(1) || '?'} pp fuera de banda A-B`),
    });
  }

  // NO_CUMPLE
  if (estado === 'NO_CUMPLE' || cumple === false) {
    const reasons = [];
    if (mensaje) reasons.push(mensaje);
    if (fueraDeBanda.length > 0) {
      reasons.push(`${fueraDeBanda.length} tamiz(es) fuera de banda ${bandaEvaluada || ''}`);
    }
    return Compliance.fail({
      reasons: reasons.length > 0 ? reasons : ['No cumple con la banda granulométrica'],
      rulesApplied: [NORM_REFS.IRAM_1627_3_2_1, NORM_REFS.CIRSOC_3_2_3_3_TABLA_3_4],
      details: fueraDeBanda.map((f) => `Tamiz ${f.tamiz || f.aberturaMm}: ${f.desvio?.toFixed(1) || '?'} pp`),
    });
  }

  // Default: NotEvaluated (NO Pass)
  return Compliance.notEvaluated({
    reason: mensaje || `Estado de evaluación no reconocido: "${estado}"`,
  });
}

/**
 * Valida las conditions de un ConditionalPass contra un contexto de uso.
 *
 * Si todas las condiciones se cumplen → devuelve Pass (el material puede usarse).
 * Si alguna no se cumple → devuelve Fail con la razón específica.
 *
 * Si el ComplianceResult no es ConditionalPass, lo devuelve sin tocar.
 *
 * Esto es lo que el motor de dosificación llama antes de aceptar una mezcla
 * en un diseño: "el material cumple condicionalmente, ¿el diseño cumple las
 * condiciones?".
 *
 * @param {ComplianceResult} compliance
 * @param {Object} context - { fce, claseExposicion, tipoArmadura, ... }
 * @returns {ComplianceResult}
 */
function validateConditionsAgainstContext(compliance, context = {}) {
  if (!compliance || compliance.status !== 'conditionalPass') {
    return compliance;
  }

  const violadas = [];
  const cumplidas = [];
  // K.2 — distinguir entre violaciones "duras" (fce excede H20, expuestoDesgaste
  // contradice exclude_destination) y violaciones "blandas" recuperables vía
  // override (falta de evidencia técnica). Si la única violación es de
  // evidencia, devolvemos Inconclusive para que el frontend ofrezca el flujo
  // de override en lugar de bloquear duro.
  const violadasNoOverridables = [];
  const violadasOverridables = [];

  for (const cond of compliance.conditions || []) {
    const resultado = checkCondition(cond, context);
    if (resultado.cumple) {
      cumplidas.push(`${cond.description} (verificado: ${resultado.detail})`);
    } else {
      const entry = `${cond.description} — ${resultado.detail}`;
      violadas.push(entry);
      if (cond.key === 'requires_technical_evidence') {
        violadasOverridables.push({ entry, condition: cond });
      } else {
        violadasNoOverridables.push({ entry, condition: cond });
      }
    }
  }

  if (violadasNoOverridables.length > 0) {
    // Hay al menos una violación dura (fce o destino) — bloqueo duro,
    // no se puede liberar ni con override.
    return Compliance.fail({
      reasons: [
        'El material requiere condiciones de aplicabilidad que el contexto de uso no cumple:',
        ...violadas,
      ],
    });
  }

  if (violadasOverridables.length > 0) {
    // Solo faltan evidencias — Inconclusive abre la puerta al override
    // del responsable técnico (K.3). El frontend distingue por status.
    return Compliance.inconclusive({
      reason: 'Requiere evidencia técnica o liberación bajo override del responsable técnico:',
      details: violadasOverridables.map((v) => v.entry),
    });
  }

  return Compliance.pass({
    message: 'Condiciones de aplicabilidad verificadas contra el contexto de uso.',
    details: cumplidas,
  });
}

/**
 * Verifica una condición individual contra el contexto.
 * Soporta keys conocidas. Si no la reconoce, devuelve `cumple: true` con un
 * detalle indicando que no se pudo verificar (no bloquea por defecto, pero
 * deja huella).
 *
 * @returns {{ cumple: boolean, detail: string }}
 */
function checkCondition(cond, context) {
  switch (cond.key) {
    case 'max_resistance_class': {
      // cond.numericValueMpa = 20 → el material es apto para H ≤ 20
      // context.fce = resistencia característica del hormigón a diseñar
      const maxApto = Number(cond.numericValueMpa);
      const fceDiseno = Number(context.fce);
      if (!Number.isFinite(maxApto)) {
        return { cumple: true, detail: `condición sin valor numérico, no se puede validar` };
      }
      if (!Number.isFinite(fceDiseno)) {
        return { cumple: false, detail: `el contexto no especifica f'ce, no se puede confirmar que sea ≤ ${maxApto} MPa` };
      }
      if (fceDiseno <= maxApto) {
        return { cumple: true, detail: `f'ce=${fceDiseno} ≤ ${maxApto} MPa` };
      }
      return { cumple: false, detail: `f'ce=${fceDiseno} MPa > ${maxApto} MPa máximo permitido` };
    }
    case 'max_exposure_class': {
      const niveles = ['A1', 'A2', 'CL', 'C1', 'C2', 'M1', 'M2', 'Q1', 'Q2', 'Q3'];
      const maxIdx = niveles.indexOf(cond.value);
      const ctxIdx = niveles.indexOf(context.claseExposicion);
      if (maxIdx < 0 || ctxIdx < 0) {
        return { cumple: true, detail: 'clase de exposición fuera de tabla, no se puede validar' };
      }
      if (ctxIdx <= maxIdx) {
        return { cumple: true, detail: `${context.claseExposicion} dentro de ${cond.value}` };
      }
      return { cumple: false, detail: `${context.claseExposicion} excede ${cond.value}` };
    }
    // P0.11: condición "exclude_destination=surface_wear" emitida por
    // aptitudMaterialesService cuando pasante #200 cae en zona condicional.
    // Se viola si el diseño declara expuestoDesgaste=true.
    case 'exclude_destination': {
      const destinosExcluidos = Array.isArray(cond.value) ? cond.value : [cond.value];
      if (destinosExcluidos.includes('surface_wear')) {
        if (context.expuestoDesgaste === true) {
          return {
            cumple: false,
            detail: `el diseño declara expuestoDesgaste=true pero el material está restringido a destinos sin desgaste superficial`,
          };
        }
        return {
          cumple: true,
          detail: 'diseño declarado sin desgaste superficial — restricción respetada',
        };
      }
      return { cumple: true, detail: `destino "${cond.value}" sin chequeo automático` };
    }
    // K.2 — condición "requires_technical_evidence" emitida por
    // mezclaCompliance.fromLegacyMezclaEval cuando una mezcla cumple A-C
    // pero no A-B. CIRSOC §3.2.3.2 f) exige estudios de laboratorio O
    // antecedentes de obra.
    //
    // El caller (motor de dosificación) debe inyectar
    //   context.evidenciasDisponibles: [{ tipo, claseResistenciaAplicable, ... }]
    // ya filtradas para el material y la fce relevantes (helper
    // technicalEvidenceService.buscarEvidenciaParaMaterial). Si el array
    // viene vacío → Inconclusive (abre la puerta al override de K.3).
    //
    // Si hay un override registrado, el caller pasa
    //   context.overrideAprobado: true → cumple sin chequeo de evidencia.
    case 'requires_technical_evidence': {
      if (context.overrideAprobado === true) {
        return {
          cumple: true,
          detail: 'liberado bajo override del responsable técnico (registrado en log auditable)',
        };
      }
      const tiposAceptados = Array.isArray(cond.value) ? cond.value : ['lab_study', 'prior_project'];
      const evidencias = Array.isArray(context.evidenciasDisponibles) ? context.evidenciasDisponibles : null;
      if (evidencias === null) {
        // El caller no pasó el array — el motor no puede validar
        return {
          cumple: false,
          detail: 'no se pudo verificar evidencia técnica (caller no proveyó context.evidenciasDisponibles)',
        };
      }
      const matchingType = (ev) => {
        if (!ev?.tipo) return false;
        const t = String(ev.tipo).toUpperCase();
        if (tiposAceptados.includes('lab_study') && t === 'LAB_STUDY') return true;
        if (tiposAceptados.includes('prior_project') && t === 'PRIOR_PROJECT') return true;
        return false;
      };
      const matches = evidencias.filter(matchingType);
      if (matches.length > 0) {
        const ref = matches[0];
        return {
          cumple: true,
          detail: `evidencia técnica respaldatoria registrada: ${ref.tipo === 'LAB_STUDY' ? 'estudio' : 'antecedente'} "${ref.referencia || ref.id || 'sin referencia'}"`,
        };
      }
      return {
        cumple: false,
        detail: 'requiere estudio de laboratorio o antecedente de obras similares — no se encontró evidencia cargada para este material',
      };
    }
    default:
      return { cumple: true, detail: `condición "${cond.key}" no validable automáticamente — verificar manualmente` };
  }
}

module.exports = {
  fromLegacyMezclaEval,
  validateConditionsAgainstContext,
  checkCondition,
};
