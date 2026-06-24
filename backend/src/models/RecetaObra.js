'use strict';

module.exports = (sequelize, DataTypes) => {
  const RecetaObra = sequelize.define('RecetaObra', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    dosificacionDisenadaId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    volumenBachada: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
    },
    humedadesJson: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: '[{idAgregado, nombre, absorcionPct, humedadPct, fuente, ensayoId}]',
    },
    aguaTeorica: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
    },
    aguaCorregida: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
    },
    correccionTotal: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
    },
    cantidadesM3Json: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'Cantidades corregidas por m³',
    },
    cantidadesBachadaJson: {
      type: DataTypes.JSON,
      allowNull: false,
      comment: 'Cantidades por bachada',
    },
    fechaMedicion: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    medidoPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    creadoPor: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
  }, {
    tableName: 'RecetaObra',
    timestamps: true,
    updatedAt: false,
  });

  RecetaObra.associate = (db) => {
    RecetaObra.belongsTo(db.DosificacionDisenada, {
      foreignKey: 'dosificacionDisenadaId',
      as: 'dosificacion',
    });
  };

  return RecetaObra;
};
