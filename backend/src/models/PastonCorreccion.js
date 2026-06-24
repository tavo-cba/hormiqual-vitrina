module.exports = (sequelize, DataTypes) => {
    const PastonCorreccion = sequelize.define('PastonCorreccion', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        dosificacionId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        pastonId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Pastón que motivó la corrección',
        },
        campo: {
            type: DataTypes.STRING(100),
            allowNull: false,
            comment: 'Field key (e.g., dosisAditivo1, asentamientoMm)',
        },
        campoLabel: {
            type: DataTypes.STRING(200),
            allowNull: false,
            comment: 'Human-readable field name',
        },
        valorAnterior: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        valorNuevo: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        unidad: {
            type: DataTypes.STRING(20),
            allowNull: true,
        },
        motivo: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        usuario: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        recalculoEjecutado: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        resultadoRecalculo: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'KPI snapshot post-correction',
        },
    }, {
        tableName: 'PastonCorreccion',
        comment: 'Correcciones aplicadas a la dosificación tras un pastón de prueba.',
    });

    PastonCorreccion.associate = (models) => {
        PastonCorreccion.belongsTo(models.DosificacionDisenada, {
            foreignKey: 'dosificacionId',
            as: 'dosificacion',
        });
        PastonCorreccion.belongsTo(models.PastonPrueba, {
            foreignKey: 'pastonId',
            as: 'paston',
        });
    };

    return PastonCorreccion;
};
