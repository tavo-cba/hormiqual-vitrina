module.exports = (sequelize, DataTypes) => {
  const DespachoEstado = sequelize.define('DespachoEstado', {
    idDespachoEstado: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    estado: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
  }, {
    tableName: 'DespachoEstado',
    comment: 'Estados posibles de un despacho.',
    timestamps: false,
  });

  DespachoEstado.associate = (models) => {
    DespachoEstado.hasMany(models.Despacho, {
      foreignKey: 'idDespachoEstado',
      as: 'despachos',
    });
  };

  return DespachoEstado;
};