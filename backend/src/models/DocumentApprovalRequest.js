'use strict';

/**
 * DocumentApprovalRequest — workflow de aprobación de certificados (Fase 2 RBAC).
 *
 * Cuando `CertificateIssuancePolicy.canIssue` devuelve `REQUIRES_APPROVAL`
 * (típicamente ConditionalPass + opt-in por config del tenant para obras de
 * alta resistencia), el operador no puede descargar el PDF directamente:
 * registra un pedido acá y el Director Técnico lo aprueba o rechaza desde su
 * panel. Al aprobar, el PDF se genera con firma + matrícula estampadas.
 *
 * Diferencias vs OverrideRequest (K.3):
 *   - OverrideRequest libera una condición bloqueante de la mezcla
 *   - DocumentApprovalRequest controla la emisión formal del documento, tenga
 *     o no condiciones bloqueantes.
 */

module.exports = (sequelize, DataTypes) => {
  const DocumentApprovalRequest = sequelize.define('DocumentApprovalRequest', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    tipoDocumento: {
      type: DataTypes.ENUM('CERTIFICADO', 'INFORME_EVALUACION', 'CERTIFICADO_DOSIFICACION'),
      allowNull: false,
    },
    // Referencias flexibles a la entidad base (material OR dosificación)
    idMaterial: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    idDosificacionDisenada: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    // Snapshot del contexto al momento del pedido (ensayos, policy decision,
    // metadata para regenerar el PDF al aprobar). Se guarda para auditoría y
    // para que el DT vea exactamente qué va a firmar.
    contextoJson: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'Snapshot de decision + ensayos + metadata al momento del pedido.',
    },
    estado: {
      type: DataTypes.ENUM('PENDIENTE', 'APROBADO', 'RECHAZADO', 'EXPIRADO'),
      allowNull: false,
      defaultValue: 'PENDIENTE',
    },
    motivoSolicitud: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Nota del solicitante al pedir la firma (opcional).',
    },
    // Trazabilidad del pedido
    solicitadoPor: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    rolSolicitante: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    fechaSolicitud: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    // Trazabilidad de la resolución
    resueltoPor: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    rolResolutor: {
      type: DataTypes.STRING(40),
      allowNull: true,
    },
    matriculaResolutor: {
      type: DataTypes.STRING(40),
      allowNull: true,
      comment: 'Matrícula del DT firmante — se estampa en el PDF al emitir.',
    },
    fechaResolucion: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    observacionesResolucion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Auditoría del PDF emitido tras aprobación (MVP textual: se registra que
    // se descargó pero el PDF mismo no se guarda como blob).
    pdfEmitidoAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    pdfEmitidoPor: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'DocumentApprovalRequest',
    comment: 'Workflow de aprobación de certificados (Fase 2 RBAC).',
    indexes: [
      { fields: ['estado'] },
      { fields: ['idMaterial'] },
      { fields: ['idDosificacionDisenada'] },
      { fields: ['activo'] },
    ],
    validate: {
      tieneAlMenosUnaReferencia() {
        if (this.idMaterial == null && this.idDosificacionDisenada == null) {
          throw new Error('DocumentApprovalRequest debe tener idMaterial o idDosificacionDisenada.');
        }
      },
    },
  });

  return DocumentApprovalRequest;
};
