module.exports = (sequelize, DataTypes) => {
  const DespachoEstadoHistory = sequelize.define('DespachoEstadoHistory', {
    idHistory: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idDespacho: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idEstadoAnterior: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idEstadoNuevo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    fechaHora: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  }, {
    tableName: 'DespachoEstadoHistory',
    comment: 'Historial de cambios de estado en despachos.',
    timestamps: false,
  });

  DespachoEstadoHistory.associate = (models) => {
    DespachoEstadoHistory.belongsTo(models.Despacho, {
      foreignKey: 'idDespacho',
      as: 'despacho',
    });
    DespachoEstadoHistory.belongsTo(models.DespachoEstado, {
      foreignKey: 'idEstadoAnterior',
      as: 'estadoAnterior',
    });
    DespachoEstadoHistory.belongsTo(models.DespachoEstado, {
      foreignKey: 'idEstadoNuevo',
      as: 'estadoNuevo',
    });
  };

  return DespachoEstadoHistory;
};