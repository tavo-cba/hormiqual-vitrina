'use strict';

module.exports = (sequelize, DataTypes) => {
  const Consistencia = sequelize.define('Consistencia', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    codigo: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: true,
      comment: 'Código interno: muy_seca, seca, plastica, muy_plastica, fluida, muy_fluida',
    },
    nombre: {
      type: DataTypes.STRING(30),
      allowNull: false,
      comment: 'Nombre legible: Muy seca, Seca, Plástica, etc.',
    },
    orden: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
    },

    // Métodos disponibles
    permiteRemoldeo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    permiteAsentamiento: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    permiteExtendido: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    metodoDefecto: {
      type: DataTypes.STRING(15),
      allowNull: false,
      comment: 'remoldeo | asentamiento | extendido',
    },

    // Rangos Remoldeo (segundos)
    remoldeoMin: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
    remoldeoMax: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
    remoldeoTolerancia: { type: DataTypes.DECIMAL(3, 1), allowNull: true },

    // Rangos Asentamiento (cm)
    asentamientoMin: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
    asentamientoMax: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
    asentamientoTolerancia: { type: DataTypes.DECIMAL(3, 1), allowNull: true },

    // Rangos Extendido (cm)
    extendidoMin: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
    extendidoMax: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
    extendidoTolerancia: { type: DataTypes.DECIMAL(3, 1), allowNull: true },

    // Reglas
    requiereSuperplastificante: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Art. 4.1.1.2: fluida y muy fluida requieren superplastificante',
    },
    recomiendaFluidificante: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'C 4.1.1.1: muy plástica recomienda fluidificante/superfluidificante',
    },
  }, {
    tableName: 'Consistencia',
    comment: 'Clases de consistencia CIRSOC 200:2024 Tablas 4.1 y 4.2.',
  });

  return Consistencia;
};
