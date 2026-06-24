module.exports = (sequelize, DataTypes) => {
  const ExtraccionPlantilla = sequelize.define('ExtraccionPlantilla', {
    idExtraccionPlantilla: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    materialTipo: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    categoria: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    normaReferencia: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    version: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'v1',
    },
    schema: {
      type: DataTypes.TEXT('long'),
      allowNull: false,
      get() {
        const raw = this.getDataValue('schema');
        if (!raw) return [];
        try { return JSON.parse(raw); } catch { return raw; }
      },
      set(val) {
        this.setDataValue('schema', val ? JSON.stringify(val) : '[]');
      },
    },
  }, {
    tableName: 'ExtraccionPlantilla',
    comment: 'Plantillas de campos esperados por tipo de material + categoría de documento.',
  });

  ExtraccionPlantilla.associate = (models) => {
    ExtraccionPlantilla.hasMany(models.ExtraccionDocumento, {
      foreignKey: 'idExtraccionPlantilla',
      as: 'extracciones',
    });
  };

  return ExtraccionPlantilla;
};
