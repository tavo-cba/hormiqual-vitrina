module.exports = (sequelize, DataTypes) => {
    const Localidad = sequelize.define('Localidad', {
        idLocalidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        identificador: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
    }, {
        tableName: 'Localidad',
        comment: 'Tabla de localidades, referenciando la provincia.',
    });

    Localidad.associate = (models) => {
        Localidad.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
        });
    };

    return Localidad;
};