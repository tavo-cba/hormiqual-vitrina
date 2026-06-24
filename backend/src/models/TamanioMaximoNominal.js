module.exports = (sequelize, DataTypes) => {
    const TamanioMaximoNominal = sequelize.define('TamanioMaximoNominal', {
        idTamanioMaximoNominal: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        tamanio: {
            type: DataTypes.FLOAT,
            allowNull: false,
            unique: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
    }, {
        tableName: 'TamanioMaximoNominal',
        comment: 'Catálogo de tamaños máximos nominales en agregados gruesos.',
    });

    return TamanioMaximoNominal;
};