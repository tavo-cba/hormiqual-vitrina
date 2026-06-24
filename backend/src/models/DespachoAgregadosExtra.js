// models/DespachoAgregadosExtra.js
module.exports = (sequelize, DataTypes) => {
    const DespachoAgregadosExtra = sequelize.define('DespachoAgregadosExtra', {
      idDespachoAgregadosExtra: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      idDespacho:              { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      idAgregado:               { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      cantidad:                { type: DataTypes.DECIMAL(6,2),    allowNull: false },
    }, {
      tableName: 'DespachoAgregadosExtra',
      comment:  'Agregados añadidos puntualmente a un despacho',
    });
  
    DespachoAgregadosExtra.associate = (models) => {
      DespachoAgregadosExtra.belongsTo(models.Despacho, { foreignKey: 'idDespacho', as: 'despacho' });
      DespachoAgregadosExtra.belongsTo(models.Agregado,  { foreignKey: 'idAgregado',  as: 'agregado'  });
    };
  
    return DespachoAgregadosExtra;
  };
  