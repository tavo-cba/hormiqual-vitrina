module.exports = (sequelize, DataTypes) => {
    const TipoCemento = sequelize.define('TipoCemento', {
        idTipoCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idComposicionCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idResistenciaCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'TipoCemento',
        comment: 'Tipos de cemento construidos según la norma IRAM.',
    });

    TipoCemento.associate = (models) => {
        TipoCemento.belongsTo(models.ComposicionCemento, {
            foreignKey: 'idComposicionCemento',
            as: 'composicionCemento',
        });
        TipoCemento.belongsTo(models.ResistenciaCemento, {
            foreignKey: 'idResistenciaCemento',
            as: 'resistenciaCemento',
        });
        TipoCemento.belongsToMany(models.PropiedadesCemento, {
            through: models.TipoCementoPropiedades,
            foreignKey: 'idTipoCemento',
            as: 'propiedades',
        });
    };

    return TipoCemento;
};