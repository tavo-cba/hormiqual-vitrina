module.exports = (sequelize, DataTypes) => {
    const PiletaEstado = sequelize.define('PiletaEstado', {
        idPiletaEstado: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idPileta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true,
        },
        bombasEncendidas: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        resistenciasEncendidas: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        temperaturaActual: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
        },
        temperaturaObjetivo: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
        },
        rangoTemp: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
            comment: 'Diferencia (max-min) entre los sensores de la pileta, en °C.',
        },
        temperaturaAmbiente: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
            comment: 'Lectura del sensor de temperatura ambiente (sala de curado). Informativo.',
        },
        ultimaActualizacion: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        labInfo: {
            type: DataTypes.JSON,
            allowNull: true,
        },
    }, {
        tableName: 'PiletaEstado',
        comment: 'Estado actual de una pileta, actualizado por reporte del laboratorio.',
    });

    PiletaEstado.associate = (models) => {
        PiletaEstado.belongsTo(models.Pileta, {
            foreignKey: 'idPileta',
            as: 'pileta',
        });
    };

    return PiletaEstado;
};
