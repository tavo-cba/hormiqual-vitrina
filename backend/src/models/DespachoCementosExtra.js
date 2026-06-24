// models/DespachoCementosExtra.js
module.exports = (sequelize, DataTypes) => {
    const DespachoCementosExtra = sequelize.define('DespachoCementosExtra', {
      idDespachoCementosExtra: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      idDespacho:              { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      idCemento:               { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      cantidad:                { type: DataTypes.DECIMAL(6,2),    allowNull: false },
    }, {
      tableName: 'DespachoCementosExtra',
      comment:  'Cementos añadidos puntualmente a un despacho',
    });
  
    DespachoCementosExtra.associate = (models) => {
      DespachoCementosExtra.belongsTo(models.Despacho, { foreignKey: 'idDespacho', as: 'despacho' });
      DespachoCementosExtra.belongsTo(models.Cemento,  { foreignKey: 'idCemento',  as: 'cemento'  });
    };
  
    return DespachoCementosExtra;
  };
  