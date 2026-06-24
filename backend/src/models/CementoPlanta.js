'use strict';

module.exports = (sequelize, DataTypes) => {
  const CementoPlanta = sequelize.define('CementoPlanta', {
    idCementoPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idCemento: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    modoCurva: {
      type: DataTypes.ENUM('ICPA', 'FABRICANTE', 'PROPIA'),
      allowNull: false,
      defaultValue: 'ICPA',
      comment: 'Cómo resuelve la curva a/c-resistencia para este cemento en esta planta.',
    },
    factorAjuste: {
      type: DataTypes.DECIMAL(5, 3),
      allowNull: false,
      defaultValue: 1.000,
      comment: 'Multiplicador sobre la curva elegida. 1.000 = sin efecto. >1 = el cemento rinde más en esta planta.',
    },
    idCurvaPropia: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'FK CurvaCemento. Solo si modoCurva=PROPIA. La curva referenciada debe pertenecer a la misma planta.',
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    slotBetonmatic: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Slot Betonmatic donde se carga este cemento en esta planta (ej. "CE1").',
    },
  }, {
    tableName: 'CementoPlanta',
    comment: 'Configuración de un cemento específica para una planta: curva a/c, factor de ajuste, disponibilidad.',
    indexes: [
      { unique: true, fields: ['idCemento', 'idPlanta'] },
      { fields: ['idPlanta'] },
    ],
  });

  CementoPlanta.associate = (models) => {
    CementoPlanta.belongsTo(models.Cemento, { foreignKey: 'idCemento', as: 'cemento' });
    CementoPlanta.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
    CementoPlanta.belongsTo(models.CurvaCemento, { foreignKey: 'idCurvaPropia', as: 'curvaPropia' });
  };

  return CementoPlanta;
};
