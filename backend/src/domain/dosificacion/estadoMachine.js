'use strict';

/**
 * Unified state machine for DosificacionDisenada and MezclaAgregados.
 *
 * Lifecycle v3:
 *   BORRADOR → PENDIENTE_REVISION (assign reviewer)
 *            → A_PRUEBA (direct, with permission)
 *            → EN_PRODUCCION (direct, SIN pastón — requiere override firmado:
 *              rol autorizado + justificación ≥50 chars + traza con hash.
 *              Caso de uso: dosificación ya en uso previo al sistema, no se
 *              repite el pastón. Ver `requiresPastonAprobado` + override.)
 *
 *   PENDIENTE_REVISION → A_PRUEBA (reviewer approves for testing)
 *                      → EN_PRODUCCION (reviewer approves directly, mismo gate
 *                        que BORRADOR → EN_PRODUCCION: requiere pastón aprobado
 *                        u override firmado + aptitud + cálculo)
 *                      → BORRADOR (reviewer rejects)
 *
 *   A_PRUEBA → EN_PRODUCCION (test passed → final approval)
 *            → BORRADOR (needs correction → new version)
 *            → DESCARTADO (test failed → discard)
 *
 *   EN_PRODUCCION → SUSPENDIDO → EN_PRODUCCION
 *                → ARCHIVADO
 *
 *   SUSPENDIDO → EN_PRODUCCION (reactivate)
 *             → ARCHIVADO
 */

const ESTADOS = {
  BORRADOR: 'BORRADOR',
  A_PRUEBA: 'A_PRUEBA',
  PENDIENTE_REVISION: 'PENDIENTE_REVISION',
  EN_PRODUCCION: 'EN_PRODUCCION',
  SUSPENDIDO: 'SUSPENDIDO',
  ARCHIVADO: 'ARCHIVADO',
  DESCARTADO: 'DESCARTADO',
  // Legacy aliases (kept for backward compatibility with existing data)
  APROBADO: 'APROBADO',       // treated as EN_PRODUCCION
  VALIDADO: 'EN_PRODUCCION',
  OBSOLETO: 'ARCHIVADO',
};

// ── Allowed transitions ──────────────────────────────────────────────────────

const TRANSITIONS = {
  // EN_PRODUCCION directo desde BORRADOR: salta toda la fase de prueba. El
  // gate duro sigue siendo `requiresPastonAprobado` (override firmado) +
  // `requiresAptitudMateriales` + `requiresCalculo`, así que no es un atajo
  // libre: exige firma de rol autorizado y justificación trazada.
  BORRADOR:            ['PENDIENTE_REVISION', 'A_PRUEBA', 'EN_PRODUCCION', 'ARCHIVADO'],
  PENDIENTE_REVISION:  ['A_PRUEBA', 'EN_PRODUCCION', 'BORRADOR'],
  A_PRUEBA:            ['EN_PRODUCCION', 'BORRADOR', 'DESCARTADO'],
  EN_PRODUCCION:       ['SUSPENDIDO', 'ARCHIVADO'],
  SUSPENDIDO:          ['EN_PRODUCCION', 'ARCHIVADO'],
  ARCHIVADO:           [], // terminal
  DESCARTADO:          [], // terminal
  // Legacy: treat APROBADO same as EN_PRODUCCION
  APROBADO:            ['SUSPENDIDO', 'ARCHIVADO'],
};

// ── State properties ─────────────────────────────────────────────────────────

/** States where the entity content can be edited */
const EDITABLE_STATES = new Set(['BORRADOR', 'A_PRUEBA']);

/** States where the entity can be deleted */
const DELETABLE_STATES = new Set(['BORRADOR']);

/** States where the entity can be used in production */
const PRODUCCION_STATES = new Set(['EN_PRODUCCION', 'A_PRUEBA', 'APROBADO']);

/** States where muestras (test samples) can be linked */
const CAN_LINK_MUESTRAS = new Set(['EN_PRODUCCION', 'A_PRUEBA', 'APROBADO']);

/** States where the content is immutable (hash-protected) */
const IMMUTABLE_STATES = new Set(['EN_PRODUCCION', 'APROBADO', 'SUSPENDIDO', 'ARCHIVADO', 'DESCARTADO']);

// ── A_PRUEBA: diseño completamente bloqueado ─────────────────────────────────
// En A_PRUEBA el diseño es read-only. Para modificar cualquier campo hay que
// usar "Requiere corrección" → volver a BORRADOR → editar → recalcular →
// enviar a prueba de nuevo. Esto garantiza trazabilidad completa.
// Las constantes se mantienen por si en el futuro se necesita edición parcial.
const DOSIF_FIELDS_A_PRUEBA = new Set([]);

const MEZCLA_FIELDS_A_PRUEBA = new Set([]);

// Campos estructurales: NO se pueden cambiar en A_PRUEBA (identidad del
// diseño). Para modificarlos hay que crear una nueva versión.
const DOSIF_STRUCTURAL_FIELDS = new Set([
  'metodo',
  'idPlanta', 'idCemento', 'idMezcla',
  'idAdicion1', 'idAdicion2',
  'pctReemplazoAdicion1', 'pctReemplazoAdicion2',
  'tipologiaCodigo',
  'expuestoDesgaste', 'aspectoSuperficialImportante',
  'tipoArmadura', 'exposicion',
]);

const MEZCLA_STRUCTURAL_FIELDS = new Set([
  'tipoMezcla', 'idPlanta', 'objetivoModo',
  'idBanda', 'idCurvaTeorica',
]);

// ── Transition requirements ──────────────────────────────────────────────────

const TRANSITION_REQUIREMENTS = {
  // BORRADOR → PENDIENTE_REVISION: needs calculation + reviewer assignment.
  //
  // Antes pedía `requiresMezclaAprobada: true` pero era burocrático y redundante:
  //   - Al salir de BORRADOR el sistema hace snapshot de la mezcla
  //     (`mezclaSnapshotJson`), así que el "drift" de datos está cubierto.
  //   - La revisión es justo el lugar donde se evalúa si una mezcla con
  //     observaciones (incluso NO_APTO en algún ensayo) es aceptable para
  //     el destino del diseño — bloquearla aquí impide la conversación.
  //   - El gate duro queda en `EN_PRODUCCION` con `requiresPastonAprobado`,
  //     que es donde realmente importa.
  PENDIENTE_REVISION: {
    requiresCalculo: true,
    requiresCamposCompletos: true,
    requiresRevisor: true,
  },
  // BORRADOR → A_PRUEBA (direct): needs calculation
  A_PRUEBA: {
    requiresCalculo: true,
    requiresCamposCompletos: true,
  },
  // → EN_PRODUCCION: aprobación final con hash + pastón aprobado.
  // `requiresCalculo` se agrega acá (además de A_PRUEBA) porque la transición
  // directa BORRADOR → EN_PRODUCCION no pasa por A_PRUEBA: sin este gate se
  // podría empujar un borrador sin cálculo a producción. Idempotente para el
  // camino A_PRUEBA → EN_PRODUCCION (ya estaba calculado para llegar ahí).
  EN_PRODUCCION: {
    requiresCalculo: true,
    requiresCamposCompletos: true,
    requiresAprobador: true,
    generaHash: true,
    requiresAptitudMateriales: true,
    requiresPastonAprobado: true,
  },
  // Suspender requires reason
  SUSPENDIDO: {
    requiresMotivo: true,
  },
  // Archivar requires reason
  ARCHIVADO: {
    requiresMotivo: true,
  },
  // Descartar requires reason
  DESCARTADO: {
    requiresMotivo: true,
  },
};

// ── Functions ────────────────────────────────────────────────────────────────

function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

function validateTransition(from, to) {
  if (!canTransition(from, to)) {
    throw Object.assign(
      new Error(`Transición no permitida: ${from} → ${to}`),
      { status: 422 }
    );
  }
}

function isEditable(estado) {
  return EDITABLE_STATES.has(estado);
}

function isDeletable(estado) {
  return DELETABLE_STATES.has(estado);
}

function isImmutable(estado) {
  return IMMUTABLE_STATES.has(estado);
}

function canLinkMuestras(estado) {
  return CAN_LINK_MUESTRAS.has(estado);
}

function canUseInProduction(estado) {
  return PRODUCCION_STATES.has(estado);
}

function availableTransitions(estado) {
  return TRANSITIONS[estado] || [];
}

/**
 * Get available UI actions for a given state.
 */
function availableActions(estado) {
  switch (estado) {
    case 'BORRADOR':
      return ['editar', 'duplicar', 'calcular', 'guardar', 'exportarPdf', 'eliminar', 'enviarRevision', 'enviarAPrueba', 'aprobarProduccionDirecto', 'archivar'];
    case 'PENDIENTE_REVISION':
      return ['duplicar', 'exportarPdf', 'aprobarParaPrueba', 'aprobarProduccion', 'rechazar'];
    case 'A_PRUEBA':
      return ['duplicar', 'exportarPdf', 'aprobarProduccion', 'requiereCorreccion', 'nuevaRondaPrueba'];
    case 'EN_PRODUCCION':
      return ['duplicar', 'exportarPdf', 'nuevaVersion', 'suspender', 'archivar', 'verificarIntegridad'];
    case 'APROBADO': // legacy → same as EN_PRODUCCION
      return ['duplicar', 'exportarPdf', 'nuevaVersion', 'suspender', 'archivar', 'verificarIntegridad'];
    case 'SUSPENDIDO':
      return ['duplicar', 'exportarPdf', 'nuevaVersion', 'reactivar', 'archivar', 'verificarIntegridad'];
    case 'ARCHIVADO':
      return ['duplicar', 'exportarPdf', 'verificarIntegridad'];
    case 'DESCARTADO':
      return ['duplicar', 'exportarPdf'];
    default:
      return ['exportarPdf'];
  }
}

/**
 * Get the transition requirements for a target state.
 */
function getTransitionRequirements(targetState) {
  return TRANSITION_REQUIREMENTS[targetState] || {};
}

/**
 * Check if a field can be edited in A_PRUEBA state.
 */
function isFieldEditableInAPrueba(entityType, fieldName) {
  if (entityType === 'dosificacion') {
    return !DOSIF_STRUCTURAL_FIELDS.has(fieldName);
  }
  if (entityType === 'mezcla') {
    return !MEZCLA_STRUCTURAL_FIELDS.has(fieldName);
  }
  return false;
}

/**
 * Get estado display configuration (label, color, watermark).
 */
function getEstadoConfig(estado) {
  const configs = {
    BORRADOR: {
      label: 'Borrador',
      color: 'gray',
      severity: 'secondary',
      watermark: 'BORRADOR \u2014 DOCUMENTO SIN VALIDEZ',
      watermarkColor: [180, 180, 180],
      editable: true,
    },
    A_PRUEBA: {
      label: 'A prueba',
      color: 'yellow',
      severity: 'warning',
      watermark: 'A PRUEBA \u2014 VALIDEZ EXPERIMENTAL',
      watermarkColor: [243, 156, 18],
      editable: true,
    },
    PENDIENTE_REVISION: {
      label: 'Pendiente de revisión',
      color: 'orange',
      severity: 'warning',
      watermark: 'PENDIENTE DE REVISION',
      watermarkColor: [230, 126, 34],
      editable: false,
    },
    EN_PRODUCCION: {
      label: 'En producción',
      color: 'green',
      severity: 'success',
      watermark: null,
      watermarkColor: null,
      editable: false,
    },
    APROBADO: {
      label: 'Aprobado',
      color: 'green',
      severity: 'success',
      watermark: null,
      watermarkColor: null,
      editable: false,
    },
    SUSPENDIDO: {
      label: 'Suspendido',
      color: 'red',
      severity: 'danger',
      watermark: 'SUSPENDIDO \u2014 NO USAR',
      watermarkColor: [231, 76, 60],
      editable: false,
    },
    ARCHIVADO: {
      label: 'Archivado',
      color: 'gray',
      severity: 'secondary',
      watermark: 'ARCHIVADO \u2014 VERSION NO VIGENTE',
      watermarkColor: [120, 120, 120],
      editable: false,
    },
    DESCARTADO: {
      label: 'Descartado',
      color: 'gray',
      severity: 'secondary',
      watermark: 'DESCARTADO',
      watermarkColor: [100, 100, 100],
      editable: false,
    },
  };
  return configs[estado] || configs.BORRADOR;
}

module.exports = {
  ESTADOS,
  TRANSITIONS,
  EDITABLE_STATES,
  DELETABLE_STATES,
  IMMUTABLE_STATES,
  DOSIF_STRUCTURAL_FIELDS,
  MEZCLA_STRUCTURAL_FIELDS,
  canTransition,
  validateTransition,
  isEditable,
  isDeletable,
  isImmutable,
  canLinkMuestras,
  canUseInProduction,
  availableTransitions,
  availableActions,
  getTransitionRequirements,
  isFieldEditableInAPrueba,
  getEstadoConfig,
};
