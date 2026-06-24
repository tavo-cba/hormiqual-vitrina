'use strict';

/**
 * CertificateIssuancePolicy (backend) — espejo de la policy del frontend.
 *
 * Existe acá para poder testearla con jest (el frontend usa CRA sin jest
 * configurado para libs sueltas). La lógica DEBE mantenerse idéntica entre
 * frontend (src/lib/document-issuance) y backend.
 *
 * Si el backend en algún momento expone un endpoint de emisión, este es el
 * módulo que aplica.
 */

const { isFail, isInconclusive, isNotEvaluated, isConditionalPass } = require('../compliance');
const { getEnsayosFaltantes, getDisplayName: getEnsayoDisplayName } = require('../requisitosEnsayos');

const DECISION = Object.freeze({
  ALLOWED: 'allowed',
  DENIED:  'denied',
  REQUIRES_APPROVAL: 'requires_approval',
});

function allowed({ message, notes = [] } = {}) {
  return Object.freeze({
    decision: DECISION.ALLOWED,
    message: message || null,
    notes: Object.freeze([...notes]),
  });
}

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

function requiresApproval({ message, notes = [], reason } = {}) {
  return Object.freeze({
    decision: DECISION.REQUIRES_APPROVAL,
    message: message || 'El certificado requiere firma del Director Técnico antes de emitirse.',
    notes: Object.freeze([...notes]),
    reason: reason || null,
  });
}

/**
 * @param {Object} args
 * @param {Object} args.material
 * @param {Array<ComplianceResult>} args.complianceResults
 * @param {Object} [args.context] - empresa, planta, etc. + opcional contexto técnico
 *   para validación de requisitos por destino (P1.9):
 *   { tipoAgregado, expuestoDesgaste, claseExposicion, fceMpa }
 * @param {string[]} [args.presentCodes] - códigos de los ensayos cargados
 *   (necesario para validar requisitos por destino).
 */
function canIssue({ material, complianceResults = [], context = {}, presentCodes = [] } = {}) {
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
    const allReasons = failures.flatMap((r) => r.reasons || ['ensayo no cumple']);
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
  // que no se entiende fuera del sistema.
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

  if (conditionals.length > 0) {
    const conditionDescriptions = conditionals.flatMap((r) =>
      (r.conditions || []).map((c) => c.description)
    );
    // Fase 2 RBAC — escalado a firma cuando el tenant lo exige o cuando el
    // caller declara contexto de alta resistencia (fce ≥ 35 MPa).
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

  return allowed({ message: 'Material apto para certificación sin restricciones.' });
}

const isAllowed = (d) => d?.decision === DECISION.ALLOWED;
const isDenied  = (d) => d?.decision === DECISION.DENIED;
const isRequiresApproval = (d) => d?.decision === DECISION.REQUIRES_APPROVAL;

module.exports = {
  DECISION,
  canIssue,
  isAllowed,
  isDenied,
  isRequiresApproval,
};
