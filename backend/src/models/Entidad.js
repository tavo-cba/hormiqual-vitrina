module.exports = (sequelize, DataTypes) => {
    const Entidad = sequelize.define('Entidad', {
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        tipoEntidad: {
            type: DataTypes.ENUM('Empleado', 'Cliente', 'Obra', 'Planta', 'Prensa', 'Candidato', 'Proveedor'),
            allowNull: false,
        },
    }, {
        tableName: 'Entidad',
        comment: 'Identifica un ente del sistema (Empleado, Cliente, Obra o Planta).',
    });

    Entidad.associate = function (models) {
        Entidad.hasOne(models.Domicilio, {
            foreignKey: 'idEntidad',
            as: 'domicilio',
        });
        Entidad.hasMany(models.Telefono, {
            foreignKey: 'idEntidad',
            as: 'telefono',
        });
        Entidad.hasMany(models.Email, {
            foreignKey: 'idEntidad',
            as: 'email',
        });
        // [VITRINA] Podada: Banco.
    };

    return Entidad;
};