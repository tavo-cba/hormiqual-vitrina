module.exports = (sequelize, DataTypes) => {
    const Pileta = sequelize.define('Pileta', {
        idPileta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        hashId: {
            type: DataTypes.STRING(64),
            allowNull: false,
            unique: true,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idLaboratorio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Laboratorio al que pertenece la pileta. NULL = sin laboratorio asignado.',
        },
        umbralAlerta: {
            type: DataTypes.DECIMAL(4, 1),
            allowNull: false,
            defaultValue: 3.0,
        },
        wattsResistencias: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
        },
        wattsBombas: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
        },
        precioKwh: {
            type: DataTypes.DECIMAL(12, 4),
            allowNull: true,
        },
        deleted_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    }, {
        tableName: 'Pileta',
        comment: 'Pileta de curado del laboratorio, identificada por un hashId unico.',
    });

    Pileta.associate = (models) => {
        Pileta.belongsTo(models.Planta, {
            foreignKey: 'idPlanta',
            as: 'planta',
        });
        if (models.Laboratorio) {
            Pileta.belongsTo(models.Laboratorio, {
                foreignKey: 'idLaboratorio',
                as: 'laboratorio',
            });
        }
        Pileta.hasOne(models.PiletaEstado, {
            foreignKey: 'idPileta',
            as: 'estado',
        });
        Pileta.hasMany(models.PiletaRegistroTemperatura, {
            foreignKey: 'idPileta',
            as: 'registrosTemperatura',
        });
        Pileta.hasMany(models.PiletaRegistroConsumo, {
            foreignKey: 'idPileta',
            as: 'registrosConsumo',
        });
        Pileta.hasMany(models.PiletaComando, {
            foreignKey: 'idPileta',
            as: 'comandos',
        });
        Pileta.hasMany(models.Probeta, {
            foreignKey: 'idPileta',
            as: 'probetas',
        });
    };

    return Pileta;
};
