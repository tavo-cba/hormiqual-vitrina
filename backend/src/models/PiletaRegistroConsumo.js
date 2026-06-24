module.exports = (sequelize, DataTypes) => {
    const PiletaRegistroConsumo = sequelize.define('PiletaRegistroConsumo', {
        idRegistro: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idPileta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        tipo: {
            type: DataTypes.ENUM('bombas', 'resistencias'),
            allowNull: false,
        },
        inicio: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        fin: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    }, {
        tableName: 'PiletaRegistroConsumo',
        comment: 'Registro de tiempo encendido de bombas y resistencias de cada pileta.',
    });

    PiletaRegistroConsumo.associate = (models) => {
        PiletaRegistroConsumo.belongsTo(models.Pileta, {
            foreignKey: 'idPileta',
            as: 'pileta',
        });
    };

    return PiletaRegistroConsumo;
};
