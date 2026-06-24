/**
 * CertificateIssuancePolicy — decide si un material puede recibir un Certificado
 * de Cumplimiento o si en su lugar debe emitirse un Informe de Evaluación.
 *
 * RAZÓN DE EXISTIR (P0.1):
 * El sistema generaba PDFs titulados "CERTIFICADO DE CUMPLIMIENTO" que
 * concluían "el material NO CUMPLE". Es un oxímoron y un riesgo legal serio.
 *
 * Esta capa separa "generar el contenido" de "decidir si se emite":
 *   1. El componente UI invoca canIssue(material, complianceResults)
 *   2. El policy devuelve Allowed o Denied(reasons)
 *   3. Si Allowed → se emite Certificado de Cumplimiento
 *   4. Si Denied → se emite Informe de Evaluación (mismo contenido técnico,
 *      título y wording distintos, sin claim de cumplimiento)
 *
 * MVP: solo Allowed/Denied. La variante RequiresApproval (emitir condicional
 * con desvíos aprobados) queda pendiente hasta que se definan los roles
 * (operador / responsable de calidad / etc.) y el flujo de firma.
 */

import { isFail, isInconclusive, isNotEvaluated, isConditionalPass, isPass } from '../compliance';
import { getEnsayosFaltantes, getDisplayName as getEnsayoDisplayName } from '../compliance/requisitosEnsayos';

export const DECISION = Object.freeze({
  ALLOWED: 'allowed',
  DENIED:  'denied',
  REQUIRES_APPROVAL: 'requires_approval',
});

/**
 * Crea una decisión Allowed.
 * @param {Object} [options]
 * @param {string} [options.message]
 * @param {string[]} [options.notes] - notas no bloqueantes (ej: condiciones a verificar)
 */
function allowed({ message, notes = [] } = {}) {
  return Object.freeze({
    decision: DECISION.ALLOWED,
    message: message || null,
    notes: Object.freeze([...notes]),
  });
}

/**
 * Crea una decisión Denied. Requiere al menos una razón.
 * @param {Object} options
 * @param {string[]} options.reasons
 * @param {string} [options.suggestedAction] - acción sugerida al usuario
 */
function denied({ reasons, suggestedAction } = {}) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    throw new Error('CertificateIssuancePolicy.denied requiere al menos una razón');
  }
  return Object.freeze({
    decision: DECISION.DENIED,
    reasons: Object.freeze([...reasons]),
    suggestedAction: suggestedAction || 'Se emitirá un Informe de Evaluación en lugar del Certificado.',
  });
}

/**
 * Crea una decisión RequiresApproval — el material cumple pero la emisión
 * del certificado requiere firma del Director Técnico antes de descargar el
 * PDF. Fase 2 RBAC.
 *
 * @param {Object} [options]
 * @param {string} [options.message]
 * @param {string[]} [options.notes]
 * @param {string} [options.reason] — motivo por el que se exige aprobación (alta resistencia, ConditionalPass, etc.)
 */
function requiresApproval({ message, notes = [], reason } = {}) {
  return Object.freeze({
    decision: DECISION.REQUIRES_APPROVAL,
    message: message || 'El certificado requiere firma del Director Técnico antes de emitirse.',
    notes: Object.freeze([...notes]),
    reason: reason || null,
  });
}

/**
 * Evalúa si un material puede recibir un Certificado de Cumplimiento.
 *
 * Reglas (MVP):
 *   - Si HAY al menos un Fail en los ensayos              → Denied
 *   - Si HAY al menos un Inconclusive                     → Denied
 *   - Si HAY al menos un NotEvaluated en ensayos requeridos → Denied
 *   - Si HAY ConditionalPass                              → Allowed con NOTAS (cliente debe verificar)
 *   - Si TODOS son Pass                                   → Allowed limpio
 *   - Lista vacía                                         → Denied
 *
 * NOTA sobre ConditionalPass: el MVP lo permite con notas explícitas. Cuando
 * se definan roles, esto pasará a ser RequiresApproval con firma del
 * responsable técnico que valide que el contexto del cliente cumple las
 * condiciones (ej: "este pavimento es H≤20, OK para usar este agregado").
 *
 * @param {Object} args
 * @param {Object} args.material - { nombre, tipo, ... }
 * @param {ComplianceResult[]} args.complianceResults - uno por ensayo
 * @param {Object} [args.context]
 * @returns {{ decision, ... }}
 */
export function canIssue({ material, complianceResults = [], context = {}, presentCodes = [] } = {}) {
  if (!material) {
    return denied({ reasons: ['No se especificó el material a certificar.'] });
  }
  if (!Array.isArray(complianceResults) || complianceResults.length === 0) {
    return denied({
      reasons: ['No hay ensayos disponibles para evaluar el cumplimiento del material.'],
      suggestedAction: 'Cargar ensayos antes de intentar emitir el documento.',
    });
  }

  const failures = complianceResults.filter(isFail);
  const inconclusives = complianceResults.filter(isInconclusive);
  const notEvaluated = complianceResults.filter(isNotEvaluated);
  const conditionals = complianceResults.filter(isConditionalPass);

  const reasons = [];

  if (failures.length > 0) {
    // Fix auditor-pdf 2026-05-28 (test92, bug 1): prefijar cada razón con
    // el nombre del ensayo (+ norma si está) cuando viene en metadata
    // `_ensayoNombre`. Antes la salida era "No cumple con el criterio
    // normativo; No cumple con el criterio normativo" (fallback genérico
    // de `fromLegacyEval` cuando el evaluador no devolvió mensaje), lo
    // que dejaba al firmante sin identificar qué ensayo falló.
    const allReasons = failures.flatMap((r) => {
      const baseReasons = (r.reasons && r.reasons.length > 0) ? r.reasons : ['no cumple con el criterio normativo'];
      const nombre = r._ensayoNombre || null;
      const norma = r._ensayoNormaRef || null;
      const label = nombre ? `${nombre}${norma ? ` (${norma})` : ''}` : null;
      return baseReasons.map((reason) => label ? `${label}: ${reason}` : reason);
    });
    reasons.push(`${failures.length} ensayo(s) no cumplen: ${allReasons.slice(0, 3).join('; ')}${allReasons.length > 3 ? '...' : ''}`);
  }

  if (inconclusives.length > 0) {
    reasons.push(`${inconclusives.length} ensayo(s) con resultado inconcluyente. Requieren mayor precisión o repetición del ensayo.`);
  }

  if (notEvaluated.length > 0) {
    reasons.push(`${notEvaluated.length} ensayo(s) sin datos suficientes para evaluar. Sin estos, no se puede certificar el cumplimiento.`);
  }

  // P1.9: Requisitos por destino. Solo se evalúan si el caller pasó contexto
  // técnico suficiente. Si no, este check es no-op (compat con callers viejos).
  //
  // PR9: usar el nombre legible del ensayo en el mensaje cliente-facing.
  // Antes se exponía el código técnico interno (`IRAM1505_GRANULOMETRIA`)
  // que no se entiende fuera del sistema. `getEnsayoDisplayName` devuelve
  // el nombre canónico ("Granulometría") y cae con un fallback razonable
  // si el código no está mapeado.
  if (context.tipoAgregado) {
    const faltantes = getEnsayosFaltantes(context, presentCodes);
    if (faltantes.length > 0) {
      const lista = faltantes.slice(0, 4)
        .map((f) => getEnsayoDisplayName(f.codigo))
        .join(', ');
      reasons.push(
        `Faltan ${faltantes.length} ensayo(s) requerido(s) para el destino del material: ${lista}${faltantes.length > 4 ? '...' : ''}.`,
      );
    }
  }

  if (reasons.length > 0) {
    return denied({ reasons });
  }

  // No hay bloqueantes. Si hay condicionales, devolver Allowed con notas.
  if (conditionals.length > 0) {
    const conditionDescriptions = conditionals.flatMap((r) =>
      (r.conditions || []).map((c) => c.description)
    );
    // Fase 2 RBAC — si el caller opta por exigir aprobación formal para
    // condicionales (por política de tenant o por alta resistencia), la
    // decisión se escala a REQUIRES_APPROVAL en lugar de emitir directamente.
    // El opt-in es explícito: nadie que no lo pida pierde el comportamiento MVP.
    const fceMpa = Number(context?.fceMpa);
    const requiereFirmaPorAltaResistencia = Number.isFinite(fceMpa) && fceMpa >= 35;
    const requiereFirmaPorConfig = context?.requireApprovalForConditional === true;
    if (requiereFirmaPorAltaResistencia || requiereFirmaPorConfig) {
      return requiresApproval({
        message: 'Certificado con condiciones de aplicabilidad — requiere firma del Director Técnico.',
        notes: conditionDescriptions,
        reason: requiereFirmaPorAltaResistencia
          ? `Alta resistencia (H-${fceMpa}) con ConditionalPass exige firma profesional.`
          : 'Política del tenant exige firma del DT para certificados con condicionales.',
      });
    }
    return allowed({
      message: 'Certificado emitido con condiciones de aplicabilidad.',
      notes: conditionDescriptions,
    });
  }

  // Todos Pass
  return allowed({ message: 'Material apto para certificación sin restricciones.' });
}

/**
 * Helpers.
 */
export const isAllowed = (d) => d?.decision === DECISION.ALLOWED;
export const isDenied  = (d) => d?.decision === DECISION.DENIED;
export const isRequiresApproval = (d) => d?.decision === DECISION.REQUIRES_APPROVAL;
