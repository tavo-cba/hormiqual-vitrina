module.exports = (sequelize, DataTypes) => {
    const NormaAplicaA = sequelize.define('NormaAplicaA', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
        },
        orden: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        tableName: 'NormaAplicaA',
        timestamps: true,
    });

    NormaAplicaA.associate = (models) => {
        NormaAplicaA.hasMany(models.Norma, {
            foreignKey: 'aplicaAId',
            as: 'normas',
        });
    };

    return NormaAplicaA;
};
