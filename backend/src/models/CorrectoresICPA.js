'use strict';

module.exports = (sequelize, DataTypes) => {
  const CorrectoresICPA = sequelize.define('CorrectoresICPA', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    tipo: {
      type: DataTypes.ENUM('TMN', 'FORMA', 'AIRE'),
      allowNull: false,
      comment: 'Tipo de corrector. TMN y FORMA son legacy inactivos. ' +
               'AIRE = delta de agua (L/m³) por punto porcentual de aire incorporado sobre el aire base de referencia.',
    },
    descripcion: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    tmnMm: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: true,
      comment: 'Legacy: TMN en mm al que aplica (solo tipo TMN, inactivo).',
    },
    formaAgregado: {
      type: DataTypes.ENUM('TRITURADO', 'CANTO_RODADO', 'MIXTO'),
      allowNull: true,
      comment: 'Legacy: forma del agregado (solo tipo FORMA, inactivo). La forma está integrada en AbacoCurvaICPA.',
    },
    deltaAguaLtsM3: {
      type: DataTypes.DECIMAL(6, 1),
      allowNull: false,
      comment: 'Delta de agua en L/m³. Positivo = más agua, negativo = menos agua.',
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
    tableName: 'CorrectoresICPA',
    comment: 'Correctores metodológicos para el método ICPA. ' +
             'TMN y FORMA son legacy (inactivos tras migraciones 20260313 y 20260315). ' +
             'Reservado para correcciones de aire incorporado (tipo AIRE) cuando se implementen.',
  });

  return CorrectoresICPA;
};
