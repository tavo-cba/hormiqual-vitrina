module.exports = (sequelize, DataTypes) => {
    const DosificacionCemento = sequelize.define('DosificacionCemento', {
        idDosificacionCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        cantidadCemento: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'DosificacionCemento',
        comment: 'Asocia varios cementos a la dosificación y sus cantidades.',
    });

    DosificacionCemento.associate = (models) => {
        DosificacionCemento.belongsTo(models.Dosificacion, {
            foreignKey: 'idDosificacion',
            as: 'dosificacion',
        });
        DosificacionCemento.belongsTo(models.Cemento, {
            foreignKey: 'idCemento',
            as: 'cemento',
        });
    };

    return DosificacionCemento;
};