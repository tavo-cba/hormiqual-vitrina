// models/DespachoAguaExtra.js
module.exports = (sequelize, DataTypes) => {
    const DespachoAguaExtra = sequelize.define('DespachoAguaExtra', {
      idDespachoAguaExtra: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
      idDespacho:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      cantidad:           { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false }, // litros añadidos
    }, {
      tableName: 'DespachoAguaExtra',
      comment:  'Litros de agua añadidos a un despacho',
    });
  
    DespachoAguaExtra.associate = (models) => {
      DespachoAguaExtra.belongsTo(models.Despacho, { foreignKey: 'idDespacho', as: 'despacho' });
    };
  
    return DespachoAguaExtra;
  };
  