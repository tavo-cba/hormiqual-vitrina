'use strict';

module.exports = (sequelize, DataTypes) => {
  const DosificacionDisenadaHistorial = sequelize.define('DosificacionDisenadaHistorial', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    dosificacionDisenadaId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    estadoAnterior: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    estadoNuevo: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    usuario: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    motivo: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  }, {
    tableName: 'DosificacionDisenadaHistorial',
    updatedAt: false,
    comment: 'Registro de cambios de estado para auditoría de dosificaciones diseñadas.',
  });

  DosificacionDisenadaHistorial.associate = (models) => {
    DosificacionDisenadaHistorial.belongsTo(models.DosificacionDisenada, {
      foreignKey: 'dosificacionDisenadaId',
      as: 'dosificacion',
    });
  };

  return DosificacionDisenadaHistorial;
};
