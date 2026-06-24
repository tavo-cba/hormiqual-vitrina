module.exports = (sequelize, DataTypes) => {
    const Rol = sequelize.define('Rol', {
        idRol: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombreRol: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
    }, {
        tableName: 'Rol',
        comment: 'Roles dentro de la empresa (chofer, operario, etc.).',
    });

    return Rol;
};