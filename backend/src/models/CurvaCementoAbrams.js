'use strict';

module.exports = (sequelize, DataTypes) => {
  const CurvaCementoAbrams = sequelize.define('CurvaCementoAbrams', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    curvaCementoId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    edadDias: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    // Parámetros Abrams: f'c = A / B^(a/c)
    parametroA: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: false,
      comment: 'Parámetro A de la ley de Abrams: f\'c = A / B^(a/c).',
    },
    parametroB: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: false,
      comment: 'Parámetro B de la ley de Abrams: f\'c = A / B^(a/c).',
    },
    notas: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'CurvaCementoAbrams',
    comment: 'Parámetros A y B de la ley de Abrams por edad, para curvas tipo ABRAMS.',
  });

  CurvaCementoAbrams.associate = (models) => {
    CurvaCementoAbrams.belongsTo(models.CurvaCemento, { foreignKey: 'curvaCementoId', as: 'curva' });
  };

  return CurvaCementoAbrams;
};
