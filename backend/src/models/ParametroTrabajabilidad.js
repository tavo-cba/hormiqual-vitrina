'use strict';
module.exports = (sequelize, DataTypes) => {
  const ParametroTrabajabilidad = sequelize.define('ParametroTrabajabilidad', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    tipo: {
      type: DataTypes.ENUM('FACTOR_SE', 'RANGO_FDA', 'OFFSET_TMN'),
      allowNull: false,
      comment: 'Tipo de parametro: FACTOR_SE (superficie especifica por tamiz), RANGO_FDA (rangos de interpretacion), OFFSET_TMN (correccion por TMN)',
    },
    clave: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: false,
      comment: 'Clave numerica: tamiz (mm) para SE, min del rango para FDA, TMN (mm) para OFFSET',
    },
    valor: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: false,
      comment: 'Valor: factor SE, offset TMN, etc.',
    },
    valorMax: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: true,
      comment: 'Para RANGO_FDA: max del rango. Para otros: null.',
    },
    etiqueta: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Etiqueta descriptiva (ej: "Estructural convencional" para FDA)',
    },
    conoMin: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Para RANGO_FDA: asentamiento minimo estimado (mm)',
    },
    conoMax: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Para RANGO_FDA: asentamiento maximo estimado (mm)',
    },
    nivel: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Para RANGO_FDA: nivel (critico, advertencia, ok, optimo)',
    },
    orden: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'ParametroTrabajabilidad',
    timestamps: true,
  });
  return ParametroTrabajabilidad;
};
