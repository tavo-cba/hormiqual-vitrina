module.exports = (sequelize, DataTypes) => {
    const Domicilio = sequelize.define('Domicilio', {
        idDomicilio: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        calle: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        numero: {
            type: DataTypes.STRING(20),
        },
        piso: {
            type: DataTypes.STRING(10),
        },
        departamento: {
            type: DataTypes.STRING(10),
        },
        localidad: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        codigoPostal: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'Domicilio',
        comment: 'Datos de ubicación para Entidades (obras, clientes, etc.).',
    });

    Domicilio.associate = (models) => {
        Domicilio.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
            onDelete: 'CASCADE',
        });
    };

    return Domicilio;
};