'use strict';

module.exports = (sequelize, DataTypes) => {
  const MaterialPlanta = sequelize.define('MaterialPlanta', {
    idMaterialPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    materialSource: {
      type: DataTypes.ENUM('aditivo', 'adicion', 'fibra', 'agregado', 'agua'),
      allowNull: false,
      comment: 'Tipo de material. Cemento se maneja en su tabla específica CementoPlanta.',
    },
    materialSourceId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    slotBetonmatic: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Slot Betonmatic donde se carga este material (aditivo/fibra/agua) en esta planta.',
    },
  }, {
    tableName: 'MaterialPlanta',
    comment: 'Disponibilidad de aditivos, adiciones, fibras, agregados y agua por planta (cemento usa CementoPlanta).',
    indexes: [
      { unique: true, fields: ['materialSource', 'materialSourceId', 'idPlanta'] },
      { fields: ['idPlanta'] },
    ],
  });

  MaterialPlanta.associate = (models) => {
    MaterialPlanta.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
  };

  return MaterialPlanta;
};
