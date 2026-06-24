module.exports = (sequelize, DataTypes) => {
  const ExtraccionDocumento = sequelize.define('ExtraccionDocumento', {
    idExtraccionDocumento: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idMaterialDocumento: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idExtraccionPlantilla: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    estado: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'PENDIENTE',
    },
    jsonExtraido: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
      get() {
        const raw = this.getDataValue('jsonExtraido');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      },
      set(val) {
        this.setDataValue('jsonExtraido', val ? JSON.stringify(val) : null);
      },
    },
    faltantes: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const raw = this.getDataValue('faltantes');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      },
      set(val) {
        this.setDataValue('faltantes', val ? JSON.stringify(val) : null);
      },
    },
    confianza: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
    },
    errores: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'ExtraccionDocumento',
    comment: 'Resultado de extracción automática sobre un documento de material.',
  });

  ExtraccionDocumento.associate = (models) => {
    ExtraccionDocumento.belongsTo(models.MaterialDocumento, {
      foreignKey: 'idMaterialDocumento',
      as: 'materialDocumento',
    });
    ExtraccionDocumento.belongsTo(models.ExtraccionPlantilla, {
      foreignKey: 'idExtraccionPlantilla',
      as: 'plantilla',
    });
  };

  return ExtraccionDocumento;
};
