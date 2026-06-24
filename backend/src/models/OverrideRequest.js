'use strict';

/**
 * OverrideRequest — log auditable de liberaciones bajo CIRSOC §3.2.3.2 f) (Bloque K.3).
 *
 * Cuando una mezcla declara condición `requires_technical_evidence` pero no
 * hay `TechnicalEvidence` cargada para el material, el motor de dosificación
 * emite Inconclusive (K.2). El responsable técnico puede liberar igualmente
 * el uso registrando un OverrideRequest con estado APROBADO; queda en el
 * log auditable y se estampa en los PDFs (K.4).
 *
 * Ámbitos:
 *   - OBRA: override firmado por Director Técnico matriculado para un uso
 *     puntual en obra (con su matrícula en el PDF).
 *   - AUTOCONTROL_PLANTA: override firmado por Responsable de Calidad para
 *     ensayos internos / autocontrol de planta (sin impacto en documentos
 *     externos regulados).
 *
 * La validez es por diseño + mezcla (no transitiva): cambiar la mezcla o
 * el diseño invalida el override y exige uno nuevo.
 */

module.exports = (sequelize, DataTypes) => {
  const OverrideRequest = sequelize.define('OverrideRequest', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idDosificacionDisenada: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'Diseño para el que se solicita la liberación.',
    },
    idMezcla: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'Mezcla con condición requires_technical_evidence que gatilla el override.',
    },
    idMaterial: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Material puntual de la mezcla (nullable = aplica a todos los materiales de la mezcla).',
    },
    ambito: {
      type: DataTypes.ENUM('OBRA', 'AUTOCONTROL_PLANTA'),
      allowNull: false,
      comment: 'OBRA = Director Técnico matriculado; AUTOCONTROL_PLANTA = Responsable de Calidad.',
    },
    estado: {
      type: DataTypes.ENUM('PENDIENTE', 'APROBADO', 'RECHAZADO'),
      allowNull: false,
      defaultValue: 'PENDIENTE',
    },
    motivo: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Justificación técnica del pedido (quién lo redacta al solicitarlo).',
    },
    evidenciaAlternativaDescripcion: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Evidencia parcial o informal que no llega a registrarse como TechnicalEvidence (ej: obra similar sin informe formal).',
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
      comment: 'Matrícula del Director Técnico cuando ámbito = OBRA (para estampar en PDF K.4).',
    },
    fechaResolucion: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    observacionesResolucion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Soft-delete: false = revocado / invalidado por cambio en el diseño.',
    },
  }, {
    tableName: 'OverrideRequest',
    comment: 'Log auditable de overrides CIRSOC §3.2.3.2 f) (Bloque K.3).',
    indexes: [
      { fields: ['idDosificacionDisenada'] },
      { fields: ['idMezcla'] },
      { fields: ['estado'] },
      { fields: ['activo'] },
    ],
  });

  return OverrideRequest;
};
