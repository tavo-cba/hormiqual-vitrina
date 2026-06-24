module.exports = (sequelize, DataTypes) => {
    const Probeta = sequelize.define('Probeta', {
        idProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(10),
            allowNull: false,
        },
        idMuestra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idMuestraTerceros: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        // PR12 — Origen pastón de prueba. Excluyente con idMuestra/
        // idMuestraTerceros: una probeta tiene un solo origen.
        idPastonPrueba: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        // 2026-06-12 — Muestra de pastón (paralelo a idMuestra/idMuestraTerceros).
        // Una probeta moldeada en un pastón se agrupa en una `MuestraPaston`
        // con origen (PLANTA/OBRA) y se nombra `T{lote}-{O|P}-P{n}`.
        idMuestraPaston: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        // 2026-05-18 — Tipo de probeta (catálogo TipoProbeta). Antes solo se
        // usaba al planificar (volumen); ahora se persiste para poder
        // corregirlo al editar un pastón guardado. NULL en probetas legacy.
        idTipoProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idEstadoProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 1,
        },
        idEnsayoResistencia: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        observaciones: {
            type: DataTypes.TEXT,
        },
        codigo: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        diasRotura: {
            type: DataTypes.INTEGER,
        },
        fechaRotura: {
            type: DataTypes.DATE,
        },
        // Bloque 3 auditoría 08 — CIRSOC 200-2024 §4.3
        // Edad nominal de diseño (típico 28 d; 56/90 d con cementos
        // puzolánicos o adiciones). Si NULL, los reportes usan `diasRotura`
        // como fallback para back-compat.
        edadDisenio: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: true,
            comment: 'CIRSOC §4.3 — edad nominal de diseño en días.',
        },
        // Mej-16 auditoría 08 — trazabilidad de anulación.
        motivoAnulacion: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        idAnuladoPor: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        fechaAnulacion: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        idUnidadMedidaPrensa: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idPileta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        // N-01 etiqueta QR (sesión 2026-05-09): trazabilidad de impresión.
        // null = aún no se imprimió etiqueta para esta probeta. La vista
        // "Etiquetas pendientes" filtra por este campo.
        etiquetaImpresaAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        idEtiquetaImpresaPor: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
    }, {
        tableName: 'Probeta',
        comment: 'Probeta de hormigón asociada a una muestra, con el valor "Curando" asignado por defecto.',
    });

    Probeta.associate = (models) => {
        Probeta.belongsTo(models.Muestra, {
            foreignKey: "idMuestra",
            as: "muestra",
            onDelete: "CASCADE",
        });
        Probeta.belongsTo(models.MuestraTerceros, {
            foreignKey: 'idMuestraTerceros',
            as: 'muestraTerceros',
        });
        // PR12 — Asociación con PastonPrueba.
        if (models.PastonPrueba) {
            Probeta.belongsTo(models.PastonPrueba, {
                foreignKey: 'idPastonPrueba',
                as: 'pastonPrueba',
            });
        }
        // 2026-06-12 — Asociación con MuestraPaston (agrupa probetas de pastón
        // con origen PLANTA/OBRA y nombre `T{lote}-{O|P}-P{n}`).
        if (models.MuestraPaston) {
            Probeta.belongsTo(models.MuestraPaston, {
                foreignKey: 'idMuestraPaston',
                as: 'muestraPaston',
            });
        }
        Probeta.belongsTo(models.EstadoProbeta, {
            foreignKey: "idEstadoProbeta",
            as: "estadoProbeta",
        });
        // 2026-05-18 — tipo de probeta persistido (catálogo TipoProbeta).
        if (models.TipoProbeta) {
            Probeta.belongsTo(models.TipoProbeta, {
                foreignKey: "idTipoProbeta",
                as: "tipoProbeta",
            });
        }
        Probeta.hasOne(models.EnsayoResistencia, {
            foreignKey: "idProbeta",
            as: "ensayo",
            onDelete: "CASCADE",
        });
        Probeta.hasMany(models.Archivo, {
            foreignKey: 'idProbeta',
            as: 'archivos',
            onDelete: 'CASCADE',
        });
        Probeta.belongsTo(models.UnidadMedidaPrensa, {
            foreignKey: 'idUnidadMedidaPrensa',
            as: 'unidadMedida',
        });
        Probeta.belongsTo(models.Pileta, {
            foreignKey: 'idPileta',
            as: 'pileta',
        });
        Probeta.belongsTo(models.Empleado, {
            foreignKey: 'idEtiquetaImpresaPor',
            as: 'etiquetaImpresaPor',
        });
        Probeta.belongsToMany(models.ReporteResistencia, {
            through: models.ReporteResistenciaProbeta,
            foreignKey: 'idProbeta',
            otherKey: 'idReporteResistencia',
            as: 'reportesResistencia',
        });
    };

    return Probeta;
};