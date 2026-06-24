module.exports = (sequelize, DataTypes) => {
    const EnsayoResistenciaHistory = sequelize.define('EnsayoResistenciaHistory', {
        idHistory: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idEnsayoResistencia: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        peso: {
            type: DataTypes.DECIMAL(11, 4),
            allowNull: false,
        },
        altura: {
            type: DataTypes.DECIMAL(7, 2),
            allowNull: false,
        },
        diametro: {
            type: DataTypes.DECIMAL(7, 2),
            allowNull: false,
        },
        fechaEnsayo: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        horaEnsayo: {
            type: DataTypes.TIME,
            allowNull: false,
        },
        edadEnsayo: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: false,
        },
        idOperarioEnsayo: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idPrensa: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        lecturaPrensa: {
            type: DataTypes.FLOAT,
        },
        cargaAplicada: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: false,
        },
        resistencia: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
        },
        observaciones: {
            type: DataTypes.TEXT,
        },
        pendienteRevision: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        // Sprint 4 (sesión 2026-05-10) — campos de trazabilidad de
        // aprobación/desaprobación y técnicos IRAM 1546:2013 que faltaban.
        // ISO 17025 §7.5/§7.8/§8.4 — control de registros técnicos.
        idAprobadoPor: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        fechaAprobacion: { type: DataTypes.DATE, allowNull: true },
        motivoDesaprobacion: { type: DataTypes.TEXT, allowNull: true },
        idDesaprobadoPor: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        fechaDesaprobacion: { type: DataTypes.DATE, allowNull: true },
        factorCorreccionHD: {
            type: DataTypes.DECIMAL(4, 3), allowNull: true,
            comment: 'IRAM 1546:2013 §10.4',
        },
        tipoRotura: {
            type: DataTypes.STRING(20), allowNull: true,
            comment: 'IRAM 1546:2013 §11',
        },
        idCalibracionAplicada: {
            type: DataTypes.INTEGER.UNSIGNED, allowNull: true,
            comment: 'Recursos MVP — ISO 17025 §6.4.7',
        },
        motivoAjuste: {
            type: DataTypes.TEXT, allowNull: true,
            comment: 'C-SEC-04 — motivo del revisor al modificar valores al aprobar.',
        },
        operation_type: {
            type: DataTypes.ENUM('INSERT', 'UPDATE', 'DELETE'),
            allowNull: false,
        },
        operation_date: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        operation_user: {
            type: DataTypes.STRING(50),
            defaultValue: 'desconocido',
        },
    }, {
        tableName: 'EnsayoResistenciaHistory',
        comment: 'Historial de cambios en la tabla EnsayoResistencia.',
    });

    return EnsayoResistenciaHistory;
};