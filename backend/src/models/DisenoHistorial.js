'use strict';

module.exports = (sequelize, DataTypes) => {
  const DisenoHistorial = sequelize.define('DisenoHistorial', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    entidadTipo: {
      type: DataTypes.ENUM('mezcla', 'dosificacion'),
      allowNull: false,
    },
    entidadId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    tipoEvento: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'cambio_estado',
      comment: 'creacion, modificacion, calculo, cambio_estado, nueva_version, aprobacion, rechazo, suspension, reactivacion, archivado',
    },
    estadoAnterior: {
      type: DataTypes.STRING(25),
      allowNull: true,
    },
    estadoNuevo: {
      type: DataTypes.STRING(25),
      allowNull: true,
    },
    usuario: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    motivo: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    hashAlMomento: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Content hash at the time of this event',
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'cambios[], version info, or other structured data',
    },
    hashCadena: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'SHA-256 acumulativo: sha256(hashCadenaAnterior + payload). Permite detectar manipulación retroactiva (Fase 4.4).',
    },
  }, {
    tableName: 'DisenoHistorial',
    updatedAt: false,
    comment: 'Unified audit trail for mezcla and dosificacion lifecycle events.',
  });

  return DisenoHistorial;
};
