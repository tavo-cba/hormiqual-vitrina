module.exports = (sequelize, DataTypes) => {
  const CurvaPunto = sequelize.define('CurvaPunto', {
    idCurvaPunto: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idCurva: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idTamiz: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'FK a Tamiz. Fuente de verdad estructural. La columna tamiz (STRING) se mantiene como label denormalizado hasta que se deprecie.',
    },
    tamiz: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    aberturaMm: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },
    pasaPct: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Para TABULADA: % pasa en ese tamiz',
    },
    limInfPct: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Para BANDA: límite inferior % pasa',
    },
    limSupPct: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Para BANDA: límite superior % pasa',
    },
    targetPct: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      comment: 'Para specMode OBJETIVO: % pasa objetivo',
    },
    isNA: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true = punto N/A, se omite de validación y gráfico',
    },
    orden: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  }, {
    tableName: 'CurvaPunto',
    comment: 'Puntos individuales para curvas TABULADA y BANDA.',
  });

  CurvaPunto.associate = (models) => {
    CurvaPunto.belongsTo(models.CurvaGranulometrica, {
      foreignKey: 'idCurva',
      as: 'curva',
    });
    CurvaPunto.belongsTo(models.Tamiz, {
      foreignKey: 'idTamiz',
      as: 'tamizRef',
    });
  };

  return CurvaPunto;
};
