module.exports = (sequelize, DataTypes) => {
    const ReporteResistenciaProbeta = sequelize.define('ReporteResistenciaProbeta', {
        idReporteResistenciaProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idReporteResistencia: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'ReporteResistenciaProbeta',
        comment: 'Relaciona reportes de resistencia oficiales con sus probetas.',
    });

    ReporteResistenciaProbeta.associate = (models) => {
        ReporteResistenciaProbeta.belongsTo(models.ReporteResistencia, {
            foreignKey: 'idReporteResistencia',
            as: 'reporte',
        });
        ReporteResistenciaProbeta.belongsTo(models.Probeta, {
            foreignKey: 'idProbeta',
            as: 'probeta',
        });
    };

    return ReporteResistenciaProbeta;
};