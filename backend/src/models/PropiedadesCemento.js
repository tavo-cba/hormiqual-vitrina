module.exports = (sequelize, DataTypes) => {
    const PropiedadesCemento = sequelize.define('PropiedadesCemento', {
        idPropiedadCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        codigo: {
            type: DataTypes.STRING(4),
            allowNull: false,
            unique: true,
        },
        descripcion: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
    }, {
        tableName: 'PropiedadesCemento',
        comment: 'Catálogo de propiedades opcionales del cemento.',
    });

    return PropiedadesCemento;
};