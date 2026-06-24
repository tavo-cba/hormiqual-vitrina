module.exports = (sequelize, DataTypes) => {
  const CurvaGranulometrica = sequelize.define('CurvaGranulometrica', {
    idCurva: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nombre: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    tipo: {
      type: DataTypes.ENUM('TEORICA', 'BANDA', 'TABULADA'),
      allowNull: false,
    },
    familia: {
      type: DataTypes.STRING(30),
      allowNull: true,
      comment: 'Familia de curva teórica: FULLER, TALBOT, MAA, ANDREASEN, ROSIN_RAMMLER',
    },
    specMode: {
      type: DataTypes.ENUM('RANGO', 'MAX_ONLY', 'MIN_ONLY', 'OBJETIVO'),
      allowNull: false,
      defaultValue: 'RANGO',
      comment: 'Modo de especificación: RANGO (min+max), MAX_ONLY, MIN_ONLY, OBJETIVO (targetPct)',
    },
    serieTamices: {
      type: DataTypes.ENUM('IRAM', 'ASTM', 'CUSTOM'),
      allowNull: false,
      defaultValue: 'IRAM',
    },
    uso: {
      type: DataTypes.ENUM('FINO', 'GRUESO', 'TOTAL'),
      allowNull: true,
      comment: 'Tipo de agregado',
    },
    aplicaA: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'JSON array of uso values this curve applies to, e.g. ["FINO","GRUESO"]',
    },
    tmnMm: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Tamaño máximo nominal en mm',
    },
    tmnMinMm: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Minimum TMN in mm for range-based matching',
    },
    tmnMaxMm: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Maximum TMN in mm for range-based matching',
    },
    curveLetter: {
      type: DataTypes.STRING(5),
      allowNull: true,
      comment: 'Letra de curva IRAM 1627 (A, B, C)',
    },
    origenDatos: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Origen de datos: IRAM, Pliego, Cliente, etc.',
    },
    estadoDatos: {
      type: DataTypes.ENUM('PENDIENTE', 'COMPLETO'),
      allowNull: false,
      defaultValue: 'COMPLETO',
      comment: 'PENDIENTE = estructura sin datos, COMPLETO = con datos cargados',
    },
    normaRef: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Norma de referencia (ej: IRAM 1627, ASTM C33)',
    },
    parametros: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Parámetros de fórmula: dmax, dmin, n, q, etc.',
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Uso, notas, tags',
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
    version: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: '1.0',
    },
    idCurvaSet: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'FK al set/paquete al que pertenece (optional)',
    },
  }, {
    tableName: 'CurvaGranulometrica',
    comment: 'Biblioteca de curvas granulométricas (teóricas, bandas, tabuladas).',
  });

  CurvaGranulometrica.associate = (models) => {
    CurvaGranulometrica.hasMany(models.CurvaPunto, {
      foreignKey: 'idCurva',
      as: 'puntos',
    });
    CurvaGranulometrica.belongsTo(models.CurvaSet, {
      foreignKey: 'idCurvaSet',
      as: 'set',
    });
  };



  return CurvaGranulometrica;
};
