module.exports = (sequelize, DataTypes) => {
    const UnidadMedidaPrensa = sequelize.define('UnidadMedidaPrensa', {
        idUnidadMedidaPrensa: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        unidad: {
            type: DataTypes.STRING(10),
            allowNull: false,
            unique: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
    }, {
        tableName: 'UnidadMedidaPrensa',
        comment: 'Catálogo de unidades de medida para prensas y probetas.',
    });

    return UnidadMedidaPrensa;
};