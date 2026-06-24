module.exports = (sequelize, DataTypes) => {
    const PiletaRegistroTemperatura = sequelize.define('PiletaRegistroTemperatura', {
        idRegistro: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idPileta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        temperatura: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: false,
        },
        temperaturaAmbiente: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
            comment: 'Lectura del sensor de temperatura ambiente al momento del registro.',
        },
        rangoTemp: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
            comment: 'Diferencia (max-min) entre los sensores de la pileta al momento del registro.',
        },
        timestamp: {
            type: DataTypes.DATE,
            allowNull: false,
        },
    }, {
        tableName: 'PiletaRegistroTemperatura',
        comment: 'Registro historico de temperaturas por pileta.',
    });

    PiletaRegistroTemperatura.associate = (models) => {
        PiletaRegistroTemperatura.belongsTo(models.Pileta, {
            foreignKey: 'idPileta',
            as: 'pileta',
        });
    };

    return PiletaRegistroTemperatura;
};
