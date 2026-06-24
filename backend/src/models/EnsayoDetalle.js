module.exports = (sequelize, DataTypes) => {
    const EnsayoDetalle = sequelize.define('EnsayoDetalle', {
        idEnsayoDetalle: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        edadEnsayo: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'EnsayoDetalle',
        comment: 'Detalle de edades de ensayo asociadas a un diagrama de ensayos.',
    });

    return EnsayoDetalle;
};