// models/DespachoAditivosExtra.js
module.exports = (sequelize, DataTypes) => {
    const DespachoAditivosExtra = sequelize.define('DespachoAditivosExtra', {
      idDespachoAditivosExtra: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      idDespacho:              { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      idAditivo:               { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      cantidad:                { type: DataTypes.DECIMAL(6,2),    allowNull: false },
    }, {
      tableName: 'DespachoAditivosExtra',
      comment:  'Aditivos añadidos puntualmente a un despacho',
    });
  
    DespachoAditivosExtra.associate = (models) => {
      DespachoAditivosExtra.belongsTo(models.Despacho, { foreignKey: 'idDespacho', as: 'despacho' });
      DespachoAditivosExtra.belongsTo(models.Aditivo,  { foreignKey: 'idAditivo',  as: 'aditivo'  });
    };
  
    return DespachoAditivosExtra;
  };
  