module.exports = (sequelize, DataTypes) => {
  const Material = sequelize.define('Material', {
    idMaterial: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idMaterialTipo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    proveedor: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    origen: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    fechaAlta: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    tipoAdicion: {
      type: DataTypes.ENUM('FILLER_CALCAREO', 'CENIZA_VOLANTE', 'ESCORIA', 'HUMO_SILICE', 'PUZOLANA', 'OTRO'),
      allowNull: true,
      comment: 'Tipo de adición (solo para idMaterialTipo=4)',
    },
    densidadRelativa: {
      type: DataTypes.DECIMAL(5, 3),
      allowNull: true,
    },
    superficieEspecifica: {
      type: DataTypes.DECIMAL(8, 1),
      allowNull: true,
      comment: 'Superficie específica (cm²/g)',
    },
    metadataTecnicaJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'Material',
    comment: 'Catálogo unificado de materiales (Calidad).',
  });

  Material.associate = (models) => {
    Material.belongsTo(models.MaterialTipo, { foreignKey: 'idMaterialTipo', as: 'tipo' });
    Material.hasMany(models.MaterialPropiedad, { foreignKey: 'idMaterial', as: 'propiedades' });
  };

  return Material;
};
