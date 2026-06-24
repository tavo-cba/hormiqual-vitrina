module.exports = (sequelize, DataTypes) => {
  const MaterialDocumento = sequelize.define('MaterialDocumento', {
    idMaterialDocumento: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    materialTipo: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: 'AGREGADO | CEMENTO | ADITIVO | FIBRA | ADICION',
    },
    materialId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idCalidadArchivo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    categoria: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'Otro',
    },
    fechaDocumento: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    notas: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'MaterialDocumento',
    comment: 'Vincula un archivo con un material (legacy o adición) en Calidad.',
  });

  MaterialDocumento.associate = (models) => {
    MaterialDocumento.belongsTo(models.CalidadArchivo, {
      foreignKey: 'idCalidadArchivo',
      as: 'archivo',
    });
    MaterialDocumento.hasOne(models.ExtraccionDocumento, {
      foreignKey: 'idMaterialDocumento',
      as: 'extraccion',
    });
  };

  return MaterialDocumento;
};
