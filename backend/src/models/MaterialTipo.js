module.exports = (sequelize, DataTypes) => {
  const MaterialTipo = sequelize.define('MaterialTipo', {
    idMaterialTipo: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nombre: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    descripcion: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    icono: {
      type: DataTypes.STRING(60),
      allowNull: true,
    },
    orden: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'MaterialTipo',
    comment: 'Tipos de material: Agregados, Cementos, Aditivos, Adiciones, Fibras.',
  });

  MaterialTipo.associate = (models) => {
    MaterialTipo.hasMany(models.Material, { foreignKey: 'idMaterialTipo' });
  };

  return MaterialTipo;
};
