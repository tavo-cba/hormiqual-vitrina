module.exports = (sequelize, DataTypes) => {
    const AgregadoGrueso = sequelize.define('AgregadoGrueso', {
        idAgregado: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
        },
        idTamanioMaximoNominal: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
    }, {
        tableName: 'AgregadoGrueso',
        comment: 'Características específicas de un agregado grueso.',
    });

    AgregadoGrueso.associate = (models) => {
        AgregadoGrueso.belongsTo(models.Agregado, {
            foreignKey: 'idAgregado',
            as: 'agregado',
        });
        AgregadoGrueso.belongsTo(models.TamanioMaximoNominal, {
            foreignKey: 'idTamanioMaximoNominal',
            as: 'tamanioMaximoNominal',
        });
    };

    return AgregadoGrueso;
};