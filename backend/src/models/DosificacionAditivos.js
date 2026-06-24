module.exports = (sequelize, DataTypes) => {
    const DosificacionAditivos = sequelize.define('DosificacionAditivos', {
        idDosificacionAditivos: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idAditivo: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        cantidad: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: false,
        },
    }, {
        tableName: 'DosificacionAditivos',
        comment: 'Asocia aditivos y su cantidad a la dosificación.',
    });

    DosificacionAditivos.associate = (models) => {
        DosificacionAditivos.belongsTo(models.Dosificacion, {
            foreignKey: 'idDosificacion',
            as: 'dosificacion',
        });
        DosificacionAditivos.belongsTo(models.Aditivo, {
            foreignKey: 'idAditivo',
            as: 'aditivo',
        });
    };

    return DosificacionAditivos;
};