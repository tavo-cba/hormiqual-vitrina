'use strict';

module.exports = (sequelize, DataTypes) => {
  const CurvaACResistencia = sequelize.define('CurvaACResistencia', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nombre: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    familiaCemento: {
      type: DataTypes.STRING(30),
      allowNull: true,
      comment: 'Tipo/familia de cemento (null = genérica)',
    },
    edadDias: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    resistenciaMpa: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: false,
    },
    acEstimado: {
      type: DataTypes.DECIMAL(4, 3),
      allowNull: false,
    },
    factorAjuste: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      defaultValue: 1.00,
      comment: 'Factor de corrección sobre la resistencia de la curva ICPA para esta familia. >1 = cemento rinde más que la curva estándar, <1 = rinde menos. Se aplica a todos los puntos de la familia.',
    },
    notas: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'CurvaACResistencia',
    comment: 'Tabla configurable a/c vs resistencia para el motor de dosificación.',
  });

  return CurvaACResistencia;
};
