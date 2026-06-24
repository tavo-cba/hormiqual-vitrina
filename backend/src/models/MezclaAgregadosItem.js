'use strict';

module.exports = (sequelize, DataTypes) => {
  const MezclaAgregadosItem = sequelize.define('MezclaAgregadosItem', {
    idMezclaItem: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idMezcla: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idAgregado: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    porcentajeFinal: {
      type: DataTypes.DOUBLE,
      allowNull: false,
    },
    orden: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  }, {
    tableName: 'MezclaAgregadosItem',
  });

  MezclaAgregadosItem.associate = (models) => {
    MezclaAgregadosItem.belongsTo(models.MezclaAgregados, {
      foreignKey: 'idMezcla',
      as: 'mezcla',
    });
    if (models.Agregado) {
      MezclaAgregadosItem.belongsTo(models.Agregado, {
        foreignKey: 'idAgregado',
        as: 'agregado',
      });
    }
  };

  return MezclaAgregadosItem;
};
