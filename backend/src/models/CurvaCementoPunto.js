'use strict';

module.exports = (sequelize, DataTypes) => {
  const CurvaCementoPunto = sequelize.define('CurvaCementoPunto', {
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
    relacionAc: {
      type: DataTypes.DECIMAL(5, 3),
      allowNull: false,
      comment: 'Relación agua/cemento del punto.',
    },
    resistenciaMpa: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
      comment: 'Resistencia en MPa del punto.',
    },
    orden: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0,
    },
  }, {
    tableName: 'CurvaCementoPunto',
    comment: 'Puntos discretos de la curva a/c vs resistencia por edad.',
  });

  CurvaCementoPunto.associate = (models) => {
    CurvaCementoPunto.belongsTo(models.CurvaCemento, { foreignKey: 'curvaCementoId', as: 'curva' });
  };

  return CurvaCementoPunto;
};
