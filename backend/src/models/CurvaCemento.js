'use strict';

module.exports = (sequelize, DataTypes) => {
  const CurvaCemento = sequelize.define('CurvaCemento', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    // FK al Cemento existente (nullable = curva de familia genérica)
    cementoId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'FK a Cemento. Null si es curva de familia/genérica.',
    },
    // Familia de cemento (CP30, CP40, CP50) para curvas genéricas sin cemento específico
    familiaCemento: {
      type: DataTypes.STRING(30),
      allowNull: true,
      comment: 'Familia de cemento cuando no hay cemento específico asociado (CP30, CP40, CP50).',
    },
    idPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'NULL = curva global (típicamente del fabricante). Con valor = curva propia/experiencia exclusiva de esa planta.',
    },
    nombre: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    tipoCurva: {
      type: DataTypes.ENUM('ABRAMS', 'TABLA_AC_RESISTENCIA'),
      allowNull: false,
      defaultValue: 'TABLA_AC_RESISTENCIA',
      comment: 'ABRAMS = parámetros A/B por edad; TABLA_AC_RESISTENCIA = puntos discretos.',
    },
    fuenteDocumento: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Informe técnico o documento de referencia.',
    },
    fabricante: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    plantaFabrica: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    anioVigencia: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    edadesDisponiblesJson: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Array de edades disponibles [1,2,3,7,28,56].',
    },
    dMaxRefMm: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: true,
      comment: 'Diámetro máximo de referencia para el que aplica la curva.',
    },
    version: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    origenCurva: {
      type: DataTypes.ENUM('ICPA', 'FABRICANTE', 'PROPIA'),
      allowNull: false,
      defaultValue: 'PROPIA',
      comment: 'ICPA = curva genérica del Ábaco 2 ICPA por familia (CP30/CP40/CP50). FABRICANTE = datos del fabricante del cemento. PROPIA = curva propia basada en experiencia/ensayos del usuario.',
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadataJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'CurvaCemento',
    comment: 'Curvas de cemento tipo Abrams o tablas a/c vs resistencia, asociadas a un cemento específico o familia.',
  });

  CurvaCemento.associate = (models) => {
    CurvaCemento.belongsTo(models.Cemento, { foreignKey: 'cementoId', as: 'cemento' });
    CurvaCemento.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
    CurvaCemento.hasMany(models.CurvaCementoPunto, { foreignKey: 'curvaCementoId', as: 'puntos', onDelete: 'CASCADE' });
    CurvaCemento.hasMany(models.CurvaCementoAbrams, { foreignKey: 'curvaCementoId', as: 'abrams', onDelete: 'CASCADE' });
  };

  return CurvaCemento;
};
