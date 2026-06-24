module.exports = (sequelize, DataTypes) => {
  const CurvaSet = sequelize.define('CurvaSet', {
    idCurvaSet: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nombre: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: 'Nombre descriptivo del set (ej: "IRAM 1627 Grueso TMN 19")',
    },
    serieTamices: {
      type: DataTypes.ENUM('IRAM', 'ASTM', 'CUSTOM'),
      allowNull: false,
      defaultValue: 'IRAM',
    },
    materialUso: {
      type: DataTypes.ENUM('FINO', 'GRUESO', 'TOTAL'),
      allowNull: true,
      comment: 'Tipo de agregado',
    },
    tmnMm: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Tamaño máximo nominal en mm',
    },
    normaRef: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Norma de referencia (ej: IRAM 1627)',
    },
    descripcion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    estado: {
      type: DataTypes.ENUM('COMPLETO', 'PENDIENTE'),
      allowNull: false,
      defaultValue: 'PENDIENTE',
      comment: 'PENDIENTE = estructura creada pero sin datos cargados',
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'CurvaSet',
    comment: 'Paquetes/sets de curvas granulométricas (ej: bandas IRAM por TMN).',
  });

  CurvaSet.associate = (models) => {
    CurvaSet.hasMany(models.CurvaGranulometrica, {
      foreignKey: 'idCurvaSet',
      as: 'curvas',
    });
  };

  return CurvaSet;
};
