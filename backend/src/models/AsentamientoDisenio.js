module.exports = (sequelize, DataTypes) => {
    const AsentamientoDisenio = sequelize.define('AsentamientoDisenio', {
        idAsentamientoDisenio: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        asentamiento: {
            type: DataTypes.DECIMAL(3, 1),
            allowNull: false,
        },
    }, {
        tableName: 'AsentamientoDisenio',
        comment: 'Valora el asentamiento esperado en la dosificación.',
    });

    return AsentamientoDisenio;
};