'use strict';

module.exports = (sequelize, DataTypes) => {
    const LaboratorioPlanta = sequelize.define('LaboratorioPlanta', {
        idLaboratorioPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idLaboratorio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        observaciones: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        tableName: 'LaboratorioPlanta',
        comment: 'Asignación N:M entre Laboratorio y Planta. Un recinto puede atender varias plantas.',
        indexes: [
            { unique: true, fields: ['idLaboratorio', 'idPlanta'] },
            { fields: ['idPlanta'] },
        ],
    });

    LaboratorioPlanta.associate = (models) => {
        LaboratorioPlanta.belongsTo(models.Laboratorio, { foreignKey: 'idLaboratorio', as: 'laboratorio' });
        LaboratorioPlanta.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
    };

    return LaboratorioPlanta;
};
