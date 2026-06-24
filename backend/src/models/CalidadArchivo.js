module.exports = (sequelize, DataTypes) => {
  const CalidadArchivo = sequelize.define('CalidadArchivo', {
    idCalidadArchivo: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    originalName: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    storedName: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    mimeType: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    sizeBytes: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    sha256: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    storagePath: {
      type: DataTypes.STRING(512),
      allowNull: false,
    },
  }, {
    tableName: 'CalidadArchivo',
    comment: 'Archivos físicos subidos para documentos de materiales (Calidad).',
  });

  CalidadArchivo.associate = (models) => {
    CalidadArchivo.hasMany(models.MaterialDocumento, {
      foreignKey: 'idCalidadArchivo',
      as: 'documentos',
    });
  };

  return CalidadArchivo;
};
