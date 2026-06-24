module.exports = (sequelize, DataTypes) => {
    const Contacto = sequelize.define('Contacto', {
        idContacto: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        rol: {
            type: DataTypes.ENUM('Jefe de obra', 'Capataz', 'Control de calidad', 'Inspección', 'Control documental', 'Otro'),
            allowNull: false,
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'Contacto',
        comment: 'Persona de contacto dentro de una Entidad (ej. obra, cliente).',
    });

    Contacto.associate = (models) => {
        Contacto.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
        });
    };

    return Contacto;
};