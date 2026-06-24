module.exports = (sequelize, DataTypes) => {
    const Email = sequelize.define('Email', {
        idEmail: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        paraRemito: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
    }, {
        tableName: 'Email',
        comment: 'Emails de contacto para cualquier Entidad del sistema.',
    });

    Email.associate = (models) => {
        Email.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
        });
    };

    return Email;
};