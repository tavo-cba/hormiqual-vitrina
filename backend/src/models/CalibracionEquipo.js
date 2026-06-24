module.exports = (sequelize, DataTypes) => {
    const CalibracionEquipo = sequelize.define('CalibracionEquipo', {
        idCalibracion: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idEquipo: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'FK a EquipoLaboratorio.',
        },
        fechaCalibracion: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        fechaVencimiento: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'Cuándo deja de ser válida la calibración. ISO 17025 §6.4.7 exige trazabilidad.',
        },
        enteCalibrador: {
            type: DataTypes.STRING(200),
            allowNull: true,
            comment: 'Organismo o ente que realizó la calibración (INTI, laboratorio acreditado, etc.).',
        },
        numeroCertificado: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Identificador del certificado emitido por el ente calibrador.',
        },
        idArchivoCertificado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'FK opcional a Archivo (PDF/imagen del certificado).',
        },
        // Coeficientes y parámetros específicos de la calibración. JSON
        // libre para soportar prensas (coef1/2/3 + R²), balanzas
        // (linealidad, repetibilidad), hornos (deriva térmica), etc.
        // Para prensas se duplica con coeficienteUno/Dos/Tres en
        // EquipoLaboratorio para back-compat con código que ya los lee
        // (denormalización al aprobar la calibración).
        coeficientes: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'JSON con coeficientes y parámetros de calibración (shape libre por tipo).',
        },
        incertidumbre: {
            type: DataTypes.FLOAT,
            allowNull: true,
            comment: 'Incertidumbre expandida (k=2 típicamente) declarada en el certificado.',
        },
        unidadIncertidumbre: {
            type: DataTypes.STRING(20),
            allowNull: true,
            comment: 'Unidad de la incertidumbre (kN, %, g, ºC, mm, etc.).',
        },
        observaciones: { type: DataTypes.TEXT, allowNull: true },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'false = anulada / dada de baja (no se borra físicamente para trazabilidad).',
        },
        deleted_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Borrado lógico (uso interno; preferir activo=false).',
        },
    }, {
        tableName: 'CalibracionEquipo',
        comment: 'Histórico de calibraciones por equipo (ISO 17025 §6.4.7, IRAM 1546 §6.4).',
        indexes: [
            { fields: ['idEquipo'] },
            { fields: ['fechaVencimiento'] },
            { fields: ['activo'] },
        ],
    });

    CalibracionEquipo.associate = (models) => {
        CalibracionEquipo.belongsTo(models.EquipoLaboratorio, {
            foreignKey: 'idEquipo',
            as: 'equipo',
        });
        CalibracionEquipo.belongsTo(models.Archivo, {
            foreignKey: 'idArchivoCertificado',
            as: 'certificadoArchivo',
        });
    };

    return CalibracionEquipo;
};
