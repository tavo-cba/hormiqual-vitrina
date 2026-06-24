module.exports = (sequelize, DataTypes) => {
    const AgregadoFino = sequelize.define('AgregadoFino', {
        idAgregado: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
        },
        pasaTamiz200: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: true,
        },
    }, {
        tableName: 'AgregadoFino',
        comment: 'Características específicas de un agregado fino.',
    });

    AgregadoFino.associate = (models) => {
        AgregadoFino.belongsTo(models.Agregado, {
            foreignKey: 'idAgregado',
            as: 'agregado',
        });
    };

    return AgregadoFino;
};