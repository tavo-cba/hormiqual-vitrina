module.exports = (sequelize, DataTypes) => {
    const EmpleadoRol = sequelize.define('EmpleadoRol', {
        idEmpleadoRol: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idEmpleado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idRol: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'EmpleadoRol',
        comment: 'Asigna uno o más roles a un empleado.',
    });

    // 🔹 Definir asociaciones correctamente en EmpleadoRol
    EmpleadoRol.associate = (models) => {
        EmpleadoRol.belongsTo(models.Empleado, {
            foreignKey: 'idEmpleado',
            as: 'empleado',
        });
        EmpleadoRol.belongsTo(models.Rol, {
            foreignKey: 'idRol',
            as: 'rol',
        });
    };

    return EmpleadoRol;
};
