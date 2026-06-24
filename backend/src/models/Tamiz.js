module.exports = (sequelize, DataTypes) => {
    const Tamiz = sequelize.define('Tamiz', {
        idTamiz: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        designacion: {
            type: DataTypes.STRING(30),
            allowNull: false,
            unique: true,
        },
        aberturaMm: {
            type: DataTypes.DECIMAL(8, 4),
            allowNull: false,
        },
        notacion: {
            type: DataTypes.ENUM('METRICA', 'IMPERIAL', 'MESH'),
            allowNull: false,
        },
        orden: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
        },
        aptoHormigon: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        aptoTBS: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        tableName: 'Tamiz',
        comment: 'Catálogo canónico de tamices (IRAM, ASTM, DNV TBS). Espejo en DB de tamicesCatalog.js para consumo relacional.',
    });

    Tamiz.associate = (models) => {
        Tamiz.hasMany(models.CurvaPunto, {
            foreignKey: 'idTamiz',
            as: 'puntos',
        });
    };

    return Tamiz;
};
