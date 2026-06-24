// models/DespachoFibrasExtra.js
module.exports = (sequelize, DataTypes) => {
    const DespachoFibrasExtra = sequelize.define('DespachoFibrasExtra', {
      idDespachoFibrasExtra: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      idDespacho:              { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      idFibra:               { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      cantidad:                { type: DataTypes.DECIMAL(6,2),    allowNull: false },
    }, {
      tableName: 'DespachoFibrasExtra',
      comment:  'Fibras añadidos puntualmente a un despacho',
    });
  
    DespachoFibrasExtra.associate = (models) => {
      DespachoFibrasExtra.belongsTo(models.Despacho, { foreignKey: 'idDespacho', as: 'despacho' });
      DespachoFibrasExtra.belongsTo(models.Fibra,  { foreignKey: 'idFibra',  as: 'fibra'  });
    };
  
    return DespachoFibrasExtra;
  };
  