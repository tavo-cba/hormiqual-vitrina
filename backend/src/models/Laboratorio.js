'use strict';

module.exports = (sequelize, DataTypes) => {
    const Laboratorio = sequelize.define('Laboratorio', {
        idLaboratorio: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(150),
            allowNull: false,
        },
        direccion: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        observaciones: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        idPrensaPorDefecto: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'EquipoLaboratorio.idEquipo. Debe ser tipo=PRENSA y pertenecer a este lab — validación en service.',
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        tableName: 'Laboratorio',
        comment: 'Recinto físico que contiene equipos de laboratorio (prensas, balanzas, hornos, piletas, etc.). Puede atender a varias plantas vía LaboratorioPlanta.',
        indexes: [
            { fields: ['activo'] },
        ],
    });

    Laboratorio.associate = (models) => {
        if (models.LaboratorioPlanta) {
            Laboratorio.hasMany(models.LaboratorioPlanta, {
                foreignKey: 'idLaboratorio',
                as: 'plantasAsignadas',
            });
        }
        if (models.EquipoLaboratorio) {
            Laboratorio.hasMany(models.EquipoLaboratorio, {
                foreignKey: 'idLaboratorio',
                as: 'equipos',
            });
            Laboratorio.belongsTo(models.EquipoLaboratorio, {
                foreignKey: 'idPrensaPorDefecto',
                as: 'prensaPorDefecto',
            });
        }
        if (models.Pileta) {
            Laboratorio.hasMany(models.Pileta, {
                foreignKey: 'idLaboratorio',
                as: 'piletas',
            });
        }
    };

    return Laboratorio;
};
