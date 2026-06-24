module.exports = (sequelize, DataTypes) => {
    const Agua = sequelize.define('Agua', {
        idAgua: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(200),
            allowNull: false,
        },
        fuenteOrigen: {
            type: DataTypes.ENUM(
                'RED_PUBLICA',
                'POZO',
                'RECUPERADA_HORMIGON',
                'RESIDUAL_INDUSTRIAL',
                'SUBTERRANEA',
                'LLUVIA',
                'SUPERFICIAL',
                'MAR_SALOBRE',
                'RESIDUAL_CLOACAL_TRATADA'
            ),
            allowNull: true,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        laboratorio: {
            type: DataTypes.STRING(200),
            allowNull: true,
        },
        observaciones: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        tableName: 'Agua',
        timestamps: true,
    });

    Agua.associate = (models) => {
        Agua.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
    };

    return Agua;
};
