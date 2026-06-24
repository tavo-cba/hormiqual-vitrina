module.exports = (sequelize, DataTypes) => {
    const Norma = sequelize.define('Norma', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        codigo: {
            type: DataTypes.STRING(40),
            allowNull: false,
            unique: true,
            comment: 'Código corto, e.g. IRAM_1505, CIRSOC_201',
        },
        titulo: {
            type: DataTypes.STRING(300),
            allowNull: false,
            comment: 'Título completo de la norma',
        },
        organismo: {
            type: DataTypes.STRING(80),
            allowNull: true,
            comment: 'IRAM, CIRSOC, ASTM, etc.',
        },
        version: {
            type: DataTypes.STRING(30),
            allowNull: true,
        },
        anio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        aplicaA: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Deprecated — use aplicaAId FK instead',
        },
        aplicaAId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'FK a NormaAplicaA',
        },
    }, {
        tableName: 'Norma',
        timestamps: true,
    });

    Norma.associate = (models) => {
        Norma.hasMany(models.NormaArchivo, {
            foreignKey: 'normaId',
            as: 'archivos',
        });
        Norma.hasMany(models.AgregadoEnsayoTipo, {
            foreignKey: 'normaId',
            as: 'tiposEnsayo',
        });
        Norma.belongsTo(models.NormaAplicaA, {
            foreignKey: 'aplicaAId',
            as: 'aplicaAOpcion',
        });
    };

    return Norma;
};
