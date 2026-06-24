'use strict';

module.exports = (sequelize, DataTypes) => {
  const AireEsperado = sequelize.define('AireEsperado', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    tmnMm: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
    },
    aireBasePct: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
    },
    // conIncorporadorPct removed — air entrainment requirements are in AireDurabilidad (Tabla 4.3)
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
    tableName: 'AireEsperado',
    comment: 'Aire atrapado esperado por TMN.',
  });

  return AireEsperado;
};
