module.exports = (sequelize, DataTypes) => {
    const Telefono = sequelize.define('Telefono', {
        idTelefono: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        caracteristica: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        telefono: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        corporativo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        paraRemito: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
    }, {
        tableName: 'Telefono',
        comment: 'Teléfonos de contacto, pueden ser particulares o laborales.',
    });

    Telefono.associate = (models) => {
        Telefono.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
        });
    };

    return Telefono;
};