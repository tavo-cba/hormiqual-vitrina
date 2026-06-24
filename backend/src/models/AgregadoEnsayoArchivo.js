module.exports = (sequelize, DataTypes) => {
    const AgregadoEnsayoArchivo = sequelize.define('AgregadoEnsayoArchivo', {
        idAgregadoEnsayoArchivo: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idAgregadoEnsayo: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        nombreArchivo: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        url: {
            type: DataTypes.STRING(500),
            allowNull: false,
        },
        mime: {
            type: DataTypes.STRING(100),
            allowNull: true,
        },
    }, {
        tableName: 'AgregadoEnsayoArchivo',
        updatedAt: false,
        comment: 'Archivos adjuntos de ensayos de agregados.',
    });

    AgregadoEnsayoArchivo.associate = (models) => {
        AgregadoEnsayoArchivo.belongsTo(models.AgregadoEnsayo, {
            foreignKey: 'idAgregadoEnsayo',
            as: 'ensayo',
        });
    };

    return AgregadoEnsayoArchivo;
};
