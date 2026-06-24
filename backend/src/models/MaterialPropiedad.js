module.exports = (sequelize, DataTypes) => {
  const MaterialPropiedad = sequelize.define('MaterialPropiedad', {
    idMaterialPropiedad: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idMaterial: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    clave: {
      type: DataTypes.STRING(80),
      allowNull: false,
    },
    valor: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    unidad: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    orden: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
  }, {
    tableName: 'MaterialPropiedad',
    comment: 'Propiedades key/value de un material.',
  });

  MaterialPropiedad.associate = (models) => {
    MaterialPropiedad.belongsTo(models.Material, { foreignKey: 'idMaterial' });
  };

  return MaterialPropiedad;
};
