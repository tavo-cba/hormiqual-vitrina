'use strict';

module.exports = (sequelize, DataTypes) => {
  const CurvaAguaAsentamiento = sequelize.define('CurvaAguaAsentamiento', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nombre: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    tmnMm: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
    },
    asentamientoMinMm: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: false,
    },
    asentamientoMaxMm: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: false,
    },
    aguaLtsM3: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: false,
    },
    formaAgregado: {
      type: DataTypes.ENUM('CANTO_RODADO', 'TRITURADO', 'MIXTO'),
      allowNull: false,
      defaultValue: 'TRITURADO',
    },
    moduloFinura: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      comment: 'Módulo de finura de la arena (para ICPA)',
    },
    metodo: {
      type: DataTypes.ENUM('ACI_211', 'HORMIQUAL'),
      allowNull: true,
      defaultValue: null,
      comment: 'Origen de la curva. NULL/ACI_211 = tabla legacy ACI. HORMIQUAL = unificado (el legacy Ábaco 1 se colapsó a HORMIQUAL en 20260601a).',
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
    tableName: 'CurvaAguaAsentamiento',
    comment: 'Tabla configurable agua vs asentamiento para el motor de dosificación.',
  });

  return CurvaAguaAsentamiento;
};
