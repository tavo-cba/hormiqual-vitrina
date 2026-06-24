'use strict';

/**
 * overrideRequestService — Bloque K.3.
 *
 * Gestiona el ciclo PENDIENTE → APROBADO | RECHAZADO de los pedidos de
 * liberación bajo CIRSOC §3.2.3.2 f). Al aprobar, el override queda activo
 * para el par (dosificación + mezcla) y el motor de dosificación lo ve vía
 * assertMezclaConditionsCompatible (K.2).
 *
 * Reglas:
 *   - Solo UN override APROBADO + activo por (idDosificacionDisenada, idMezcla).
 *     Al aprobar uno nuevo, los anteriores se marcan activo=false.
 *   - OBRA → solo Director Técnico puede resolver.
 *   - AUTOCONTROL_PLANTA → Responsable de Calidad o Director Técnico.
 *   - El rol se chequea en el controller (requireRole); este service asume
 *     que el caller ya lo validó.
 */

const AMBITOS = ['OBRA', 'AUTOCONTROL_PLANTA'];
const ESTADOS = ['PENDIENTE', 'APROBADO', 'RECHAZADO'];

function validateCreatePayload(data) {
  const errors = [];
  if (!Number.isFinite(Number(data.idDosificacionDisenada))) {
    errors.push('idDosificacionDisenada requerido (numérico).');
  }
  if (!Number.isFinite(Number(data.idMezcla))) {
    errors.push('idMezcla requerido (numérico).');
  }
  if (!AMBITOS.includes(data.ambito)) {
    errors.push(`ambito debe ser uno de: ${AMBITOS.join(', ')}`);
  }
  if (!data.motivo || String(data.motivo).trim().length < 10) {
    errors.push('motivo requerido (mínimo 10 caracteres).');
  }
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 422 });
  }
}

/**
 * Crea un OverrideRequest en estado PENDIENTE. No libera nada todavía —
 * hasta que un resolver con el rol correcto lo apruebe.
 */
async function crear(db, data, { usuario, rol } = {}) {
  validateCreatePayload(data);
  const row = await db.OverrideRequest.create({
    idDosificacionDisenada: Number(data.idDosificacionDisenada),
    idMezcla: Number(data.idMezcla),
    idMaterial: data.idMaterial != null ? Number(data.idMaterial) : null,
    ambito: data.ambito,
    estado: 'PENDIENTE',
    motivo: String(data.motivo).trim(),
    evidenciaAlternativaDescripcion: data.evidenciaAlternativaDescripcion
      ? String(data.evidenciaAlternativaDescripcion).trim() : null,
    solicitadoPor: usuario || data.solicitadoPor || 'sistema',
    rolSolicitante: rol || data.rolSolicitante || null,
    fechaSolicitud: new Date(),
    activo: true,
  });
  return row.get({ plain: true });
}

async function listar(db, { idDosificacionDisenada, idMezcla, estado, includeInactive = false } = {}) {
  const where = {};
  if (!includeInactive) where.activo = true;
  if (idDosificacionDisenada != null) where.idDosificacionDisenada = Number(idDosificacionDisenada);
  if (idMezcla != null) where.idMezcla = Number(idMezcla);
  if (estado) where.estado = estado;
  const rows = await db.OverrideRequest.findAll({
    where,
    order: [['fechaSolicitud', 'DESC'], ['id', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function obtener(db, id) {
  const row = await db.OverrideRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('OverrideRequest no encontrado'), { statusCode: 404 });
  return row.get({ plain: true });
}

/**
 * Aprueba un pedido PENDIENTE. Requiere que el caller haya chequeado el rol.
 * Invalida cualquier otro override APROBADO activo para el mismo par
 * (dosificación + mezcla) — solo uno vigente a la vez.
 */
async function aprobar(db, id, { usuario, rol, matricula, observaciones } = {}) {
  const row = await db.OverrideRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('OverrideRequest no encontrado'), { statusCode: 404 });
  if (row.estado !== 'PENDIENTE') {
    throw Object.assign(
      new Error(`Solo se pueden aprobar pedidos en estado PENDIENTE (estado actual: ${row.estado}).`),
      { statusCode: 409 }
    );
  }
  if (row.ambito === 'OBRA' && !matricula) {
    throw Object.assign(
      new Error('El ámbito OBRA exige matrícula profesional del Director Técnico para la firma.'),
      { statusCode: 422 }
    );
  }

  // Invalidar overrides previos activos del mismo par diseño+mezcla
  await db.OverrideRequest.update(
    { activo: false },
    {
      where: {
        idDosificacionDisenada: row.idDosificacionDisenada,
        idMezcla: row.idMezcla,
        estado: 'APROBADO',
        activo: true,
        id: { [require('sequelize').Op.ne]: row.id },
      },
    },
  );

  await row.update({
    estado: 'APROBADO',
    resueltoPor: usuario || 'sistema',
    rolResolutor: rol || null,
    matriculaResolutor: matricula || null,
    fechaResolucion: new Date(),
    observacionesResolucion: observaciones ? String(observaciones).trim() : null,
    activo: true,
  });
  return row.get({ plain: true });
}

async function rechazar(db, id, { usuario, rol, observaciones } = {}) {
  const row = await db.OverrideRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('OverrideRequest no encontrado'), { statusCode: 404 });
  if (row.estado !== 'PENDIENTE') {
    throw Object.assign(
      new Error(`Solo se pueden rechazar pedidos en estado PENDIENTE (estado actual: ${row.estado}).`),
      { statusCode: 409 }
    );
  }
  await row.update({
    estado: 'RECHAZADO',
    resueltoPor: usuario || 'sistema',
    rolResolutor: rol || null,
    fechaResolucion: new Date(),
    observacionesResolucion: observaciones ? String(observaciones).trim() : null,
    activo: false,
  });
  return row.get({ plain: true });
}

/**
 * Revoca un override APROBADO previamente (ej: se detectó que la mezcla
 * cambió y el estudio ya no aplica). Soft-delete — el registro queda para
 * auditoría.
 */
async function revocar(db, id, { usuario, observaciones } = {}) {
  const row = await db.OverrideRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('OverrideRequest no encontrado'), { statusCode: 404 });
  await row.update({
    activo: false,
    observacionesResolucion: observaciones
      ? `${row.observacionesResolucion || ''}\n[REVOCADO por ${usuario || 'sistema'}]: ${String(observaciones).trim()}`.trim()
      : row.observacionesResolucion,
  });
  return row.get({ plain: true });
}

/**
 * Helper para el motor de dosificación: devuelve true si existe override
 * APROBADO + activo para el par (dosif, mezcla).
 */
async function hayOverrideVigente(db, { idDosificacionDisenada, idMezcla }) {
  if (!db.OverrideRequest) return false;
  const row = await db.OverrideRequest.findOne({
    where: {
      idDosificacionDisenada: Number(idDosificacionDisenada),
      idMezcla: Number(idMezcla),
      estado: 'APROBADO',
      activo: true,
    },
  });
  return !!row;
}

module.exports = {
  AMBITOS,
  ESTADOS,
  crear,
  listar,
  obtener,
  aprobar,
  rechazar,
  revocar,
  hayOverrideVigente,
};
