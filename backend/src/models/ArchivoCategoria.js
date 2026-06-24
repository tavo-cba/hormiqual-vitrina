module.exports = (sequelize, DataTypes) => {
  const ArchivoCategoria = sequelize.define('ArchivoCategoria', {
    idArchivoCategoria: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idCategoriaArchivo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idArchivo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  }, {
    tableName: 'ArchivoCategoria',
    timestamps: false,
    comment: 'Relación entre archivos y sus categorías',
  });

  ArchivoCategoria.associate = (models) => {
    ArchivoCategoria.belongsTo(models.CategoriaArchivo, {
      foreignKey: 'idCategoriaArchivo',
      as: 'categoria',
      onDelete: 'CASCADE',
    });
    ArchivoCategoria.belongsTo(models.Archivo, {
      foreignKey: 'idArchivo',
      as: 'archivo',
      onDelete: 'CASCADE',
    });
  };

  return ArchivoCategoria;
};