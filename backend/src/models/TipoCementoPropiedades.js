module.exports = (sequelize, DataTypes) => {
    const TipoCementoPropiedades = sequelize.define('TipoCementoPropiedades', {
        idTipoCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idPropiedadCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'TipoCementoPropiedades',
        comment: 'Relación many-to-many entre TipoCemento y PropiedadesCemento.',
    });

    TipoCementoPropiedades.associate = (models) => {
        TipoCementoPropiedades.belongsTo(models.TipoCemento, {
            foreignKey: 'idTipoCemento',
            as: 'tipoCemento',
        });
        TipoCementoPropiedades.belongsTo(models.PropiedadesCemento, {
            foreignKey: 'idPropiedadCemento',
            as: 'propiedadCemento',
        });
    };

    return TipoCementoPropiedades;
};