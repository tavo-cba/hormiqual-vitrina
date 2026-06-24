'use strict';

module.exports = (sequelize, DataTypes) => {
  const AireDurabilidad = sequelize.define('AireDurabilidad', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    tmnMm: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: false,
      comment: 'TMN del agregado grueso (mm)',
    },
    claseExposicion: {
      type: DataTypes.STRING(5),
      allowNull: false,
      comment: 'Clase de exposición — sólo C1 o C2 (CIRSOC 200:2024 Tabla 4.3 sólo cubre estas dos columnas; M2/M3 NO requieren aire intencional en Tabla 4.3).',
    },
    aireTotalPct: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      comment: 'Aire total requerido (%) — CIRSOC 200:2024 Tabla 4.3',
    },
    toleranciaPct: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      defaultValue: 1.5,
      comment: 'Tolerancia ± (%) — por defecto ±1,5%',
    },
  }, {
    tableName: 'AireDurabilidad',
    comment: 'Aire total requerido para clases C1 y C2 por TMN (CIRSOC 200:2024 Tabla 4.3).',
    indexes: [
      { unique: true, fields: ['tmnMm', 'claseExposicion'] },
    ],
  });

  return AireDurabilidad;
};
