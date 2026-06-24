module.exports = (sequelize, DataTypes) => {
    const ComposicionCemento = sequelize.define('ComposicionCemento', {
        idComposicionCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        codigo: {
            type: DataTypes.STRING(3),
            allowNull: false,
            unique: true,
        },
        descripcion: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
    }, {
        tableName: 'ComposicionCemento',
        comment: 'Composiciones posibles según normativa IRAM.',
    });

    return ComposicionCemento;
};