module.exports = (sequelize, DataTypes) => {
  const MaterialPrecio = sequelize.define('MaterialPrecio', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    materialSource: {
      type: DataTypes.ENUM('agregado', 'cemento', 'aditivo', 'adicion', 'fibra'),
      allowNull: false,
    },
    materialSourceId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'Planta a la que aplica el precio. El mismo material puede tener distintos precios por planta (transporte, etc.).',
    },
    precioUnitario: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    unidad: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'kg',
    },
    moneda: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'ARS',
    },
    fechaVigencia: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    fechaVencimiento: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    proveedor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    incluyeFlete: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    costoFlete: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    tableName: 'MaterialPrecio',
    comment: 'Precios históricos de materiales para análisis de costos de dosificación.',
  });

  return MaterialPrecio;
};
