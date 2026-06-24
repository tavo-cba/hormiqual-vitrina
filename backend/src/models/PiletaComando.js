module.exports = (sequelize, DataTypes) => {
    const PiletaComando = sequelize.define('PiletaComando', {
        idComando: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idPileta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        tipo: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        payload: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        estado: {
            type: DataTypes.ENUM('pendiente', 'entregado'),
            allowNull: false,
            defaultValue: 'pendiente',
        },
    }, {
        tableName: 'PiletaComando',
        comment: 'Comandos encolados desde Hormiqual para ser ejecutados por el laboratorio.',
    });

    PiletaComando.associate = (models) => {
        PiletaComando.belongsTo(models.Pileta, {
            foreignKey: 'idPileta',
            as: 'pileta',
        });
    };

    return PiletaComando;
};
