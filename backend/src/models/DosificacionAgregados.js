module.exports = (sequelize, DataTypes) => {
    const DosificacionAgregados = sequelize.define('DosificacionAgregados', {
        idDosificacionAgregados: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idAgregado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        cantidadAgregado: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'DosificacionAgregados',
        comment: 'Asocia agregados (fino o grueso) a la receta de dosificación.',
    });

    DosificacionAgregados.associate = (models) => {
        DosificacionAgregados.belongsTo(models.Dosificacion, {
            foreignKey: 'idDosificacion',
            as: 'dosificacion',
        });
        DosificacionAgregados.belongsTo(models.Agregado, {
            foreignKey: 'idAgregado',
            as: 'agregado',
        });
    };

    return DosificacionAgregados;
};