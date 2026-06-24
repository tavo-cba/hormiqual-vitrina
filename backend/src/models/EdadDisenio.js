module.exports = (sequelize, DataTypes) => {
    const EdadDisenio = sequelize.define('EdadDisenio', {
        idEdadDisenio: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        dias: {
            type: DataTypes.TINYINT.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'EdadDisenio',
        comment: 'Edad de diseño (días) que se espera para la resistencia.',
    });

    return EdadDisenio;
};