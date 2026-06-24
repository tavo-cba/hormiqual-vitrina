module.exports = (sequelize, DataTypes) => {
  const CategoriaArchivo = sequelize.define('CategoriaArchivo', {
    idCategoriaArchivo: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    categoria: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    tipo: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    orden: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    visibleEnPortal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    tableName: 'CategoriaArchivo',
    timestamps: false,
    comment: 'Tipos de categoría para archivos',
  });

  CategoriaArchivo.associate = (models) => {
    CategoriaArchivo.belongsToMany(models.Archivo, {
      through: models.ArchivoCategoria,
      foreignKey: 'idCategoriaArchivo',
      otherKey: 'idArchivo',
      as: 'archivos',
    });
  };

  return CategoriaArchivo;
};