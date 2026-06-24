'use strict';

module.exports = (sequelize, DataTypes) => {
  const EquipoPlanta = sequelize.define('EquipoPlanta', {
    idEquipoPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idEquipo: {
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
  }, {
    tableName: 'EquipoPlanta',
    comment: 'Disponibilidad de un equipo de laboratorio en una o varias plantas. Mirror del patrón CementoPlanta.',
    indexes: [
      { unique: true, fields: ['idEquipo', 'idPlanta'] },
      { fields: ['idPlanta'] },
    ],
  });

  EquipoPlanta.associate = (models) => {
    EquipoPlanta.belongsTo(models.EquipoLaboratorio, { foreignKey: 'idEquipo', as: 'equipo' });
    EquipoPlanta.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
  };

  return EquipoPlanta;
};
