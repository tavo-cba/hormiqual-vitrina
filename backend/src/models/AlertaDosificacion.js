'use strict';
module.exports = (sequelize, DataTypes) => {
  const AlertaDosificacion = sequelize.define('AlertaDosificacion', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    idDosificacion: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    idMaterial: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, comment: 'ID del agregado que cambio' },
    nombreMaterial: { type: DataTypes.STRING(200), allowNull: true },
    tipoEnsayo: { type: DataTypes.STRING(100), allowNull: true, comment: 'Codigo del tipo de ensayo que se cargo/modifico' },
    nombreEnsayo: { type: DataTypes.STRING(200), allowNull: true },
    nivel: { type: DataTypes.ENUM('critico', 'alto', 'medio', 'bajo'), allowNull: false, defaultValue: 'medio' },
    mensaje: { type: DataTypes.TEXT, allowNull: false },
    requiereRecalculo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    estado: { type: DataTypes.ENUM('PENDIENTE', 'REVISADA', 'RESUELTA', 'IGNORADA'), allowNull: false, defaultValue: 'PENDIENTE' },
    resueltaPor: { type: DataTypes.STRING(100), allowNull: true },
    fechaResolucion: { type: DataTypes.DATE, allowNull: true },
    notasResolucion: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'AlertaDosificacion',
    timestamps: true,
  });
  return AlertaDosificacion;
};
