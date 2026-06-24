'use strict';

module.exports = (sequelize, DataTypes) => {
  const PulverulentoMinimo = sequelize.define('PulverulentoMinimo', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    tmnMm: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: false,
      unique: true,
      comment: 'TMN del agregado grueso (mm)',
    },
    minimoKgM3: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'Contenido mínimo de material pasa 300 µm (kg/m³) — CIRSOC 200:2024 Tabla 4.4',
    },
  }, {
    tableName: 'PulverulentoMinimo',
    comment: 'Material pulverulento mínimo pasante 300 µm por TMN (CIRSOC 200:2024 Tabla 4.4, Art. 4.1.3).',
  });

  return PulverulentoMinimo;
};
