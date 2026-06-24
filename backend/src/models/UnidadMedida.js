module.exports = (sequelize, DataTypes) => {
    const UnidadMedida = sequelize.define('UnidadMedida', {
        idUnidadMedida: {
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
        tableName: 'UnidadMedida',
        comment: 'Catálogo de unidades de medida para aditivos y otros materiales.',
    });

    return UnidadMedida;
};