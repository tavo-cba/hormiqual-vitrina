'use strict';

/**
 * documentApprovalRequestService — Fase 2 RBAC.
 *
 * Gestiona el ciclo PENDIENTE → APROBADO | RECHAZADO de los pedidos de firma
 * de certificados / informes. Cuando `CertificateIssuancePolicy.canIssue`
 * emite REQUIRES_APPROVAL, el operador llama `crear()` en vez de descargar
 * el PDF. El Director Técnico lo aprueba y solo entonces se habilita la
 * descarga (con firma + matrícula estampada).
 *
 * Reglas:
 *  - Aprobación: solo DIRECTOR_TECNICO o ADMIN.
 *  - Rechazo: DIRECTOR_TECNICO, ADMIN, o RESPONSABLE_CALIDAD.
 *  - Los chequeos de rol viven en el controller; el service asume caller validado.
 */

const TIPOS_DOCUMENTO = ['CERTIFICADO', 'INFORME_EVALUACION', 'CERTIFICADO_DOSIFICACION'];
const ESTADOS = ['PENDIENTE', 'APROBADO', 'RECHAZADO', 'EXPIRADO'];

function validateCreatePayload(data) {
  const errors = [];
  if (!TIPOS_DOCUMENTO.includes(data.tipoDocumento)) {
    errors.push(`tipoDocumento debe ser uno de: ${TIPOS_DOCUMENTO.join(', ')}`);
  }
  const hasMat = data.idMaterial != null && Number(data.idMaterial) > 0;
  const hasDos = data.idDosificacionDisenada != null && Number(data.idDosificacionDisenada) > 0;
  if (!hasMat && !hasDos) {
    errors.push('Debe especificar idMaterial o idDosificacionDisenada.');
  }
  if (!data.contextoJson || typeof data.contextoJson !== 'object') {
    errors.push('contextoJson requerido (objeto con snapshot de ensayos + decision).');
  }
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 422 });
  }
}

async function crear(db, data, { usuario, rol } = {}) {
  validateCreatePayload(data);
  const row = await db.DocumentApprovalRequest.create({
    tipoDocumento: data.tipoDocumento,
    idMaterial: data.idMaterial != null ? Number(data.idMaterial) : null,
    idDosificacionDisenada: data.idDosificacionDisenada != null ? Number(data.idDosificacionDisenada) : null,
    contextoJson: data.contextoJson,
    estado: 'PENDIENTE',
    motivoSolicitud: data.motivoSolicitud ? String(data.motivoSolicitud).trim() : null,
    solicitadoPor: usuario || data.solicitadoPor || 'sistema',
    rolSolicitante: rol || data.rolSolicitante || null,
    fechaSolicitud: new Date(),
    activo: true,
  });
  return row.get({ plain: true });
}

async function listar(db, { estado, tipoDocumento, idMaterial, idDosificacionDisenada, includeInactive = false } = {}) {
  const where = {};
  if (!includeInactive) where.activo = true;
  if (estado) where.estado = estado;
  if (tipoDocumento) where.tipoDocumento = tipoDocumento;
  if (idMaterial != null) where.idMaterial = Number(idMaterial);
  if (idDosificacionDisenada != null) where.idDosificacionDisenada = Number(idDosificacionDisenada);
  const rows = await db.DocumentApprovalRequest.findAll({
    where,
    order: [['fechaSolicitud', 'DESC'], ['id', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function obtener(db, id) {
  const row = await db.DocumentApprovalRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('Pedido de aprobación no encontrado'), { statusCode: 404 });
  return row.get({ plain: true });
}

/**
 * Aprueba un pedido PENDIENTE. El caller debe validar el rol (Director
 * Técnico o Admin). Para tipoDocumento=CERTIFICADO y para documentos firmados
 * oficialmente en obra, la matrícula es obligatoria.
 */
async function aprobar(db, id, { usuario, rol, matricula, observaciones } = {}) {
  const row = await db.DocumentApprovalRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('Pedido de aprobación no encontrado'), { statusCode: 404 });
  if (row.estado !== 'PENDIENTE') {
    throw Object.assign(
      new Error(`Solo se pueden aprobar pedidos en estado PENDIENTE (estado actual: ${row.estado}).`),
      { statusCode: 409 }
    );
  }
  if (!matricula) {
    throw Object.assign(
      new Error('La firma de certificados exige matrícula profesional del Director Técnico.'),
      { statusCode: 422 }
    );
  }
  await row.update({
    estado: 'APROBADO',
    resueltoPor: usuario || 'sistema',
    rolResolutor: rol || null,
    matriculaResolutor: matricula,
    fechaResolucion: new Date(),
    observacionesResolucion: observaciones ? String(observaciones).trim() : null,
  });
  return row.get({ plain: true });
}

async function rechazar(db, id, { usuario, rol, observaciones } = {}) {
  const row = await db.DocumentApprovalRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('Pedido de aprobación no encontrado'), { statusCode: 404 });
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
 * Registra que el PDF fue descargado tras aprobación. MVP textual: no guarda
 * el blob del PDF, solo trazabilidad. Permite auditar cuántas veces se emitió
 * el documento aprobado.
 */
async function registrarEmisionPdf(db, id, { usuario } = {}) {
  const row = await db.DocumentApprovalRequest.findByPk(id);
  if (!row) throw Object.assign(new Error('Pedido de aprobación no encontrado'), { statusCode: 404 });
  if (row.estado !== 'APROBADO') {
    throw Object.assign(
      new Error('Solo se puede registrar emisión de PDF sobre pedidos APROBADOS.'),
      { statusCode: 409 }
    );
  }
  await row.update({
    pdfEmitidoAt: new Date(),
    pdfEmitidoPor: usuario || 'sistema',
  });
  return row.get({ plain: true });
}

module.exports = {
  TIPOS_DOCUMENTO,
  ESTADOS,
  crear,
  listar,
  obtener,
  aprobar,
  rechazar,
  registrarEmisionPdf,
};
