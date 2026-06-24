module.exports = (sequelize, DataTypes) => {
    const ReporteResistencia = sequelize.define('ReporteResistencia', {
        idReporteResistencia: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        link: {
            type: DataTypes.STRING(500),
            allowNull: false,
        },
        fechaDesde: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        fechaHasta: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        oficial: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        idEmpleado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'ReporteResistencia',
        comment: 'Reporte de resistencias almacenado con link y metadatos.',
    });

    ReporteResistencia.associate = (models) => {
        ReporteResistencia.belongsTo(models.Empleado, {
            foreignKey: 'idEmpleado',
            as: 'empleado',
        });
        ReporteResistencia.belongsToMany(models.Probeta, {
            through: models.ReporteResistenciaProbeta,
            foreignKey: 'idReporteResistencia',
            otherKey: 'idProbeta',
            as: 'probetas',
        });
    };

    return ReporteResistencia;
};