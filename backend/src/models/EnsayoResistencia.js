module.exports = (sequelize, DataTypes) => {
    const EnsayoResistencia = sequelize.define("EnsayoResistencia", {
        idEnsayoResistencia: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            // C-MOD-03 fix (auditoría 08, Bloque 6): UNIQUE para reflejar
            // a nivel DB que `Probeta.hasOne(EnsayoResistencia)` es 1:1.
            // La constraint canónica se llama `uq_ensayoresistencia_idprobeta`
            // y se crea con la migración 20260508b.
            unique: 'uq_ensayoresistencia_idprobeta',
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
            comment:
                "Días desde la confección de la probeta (Muestra.fecha) hasta fechaEnsayo",
        },
        idOperarioEnsayo: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        // M-MOD-04 (auditoría 08): cambio de FLOAT → DECIMAL para evitar
        // errores de redondeo no determinísticos en el cálculo de carga.
        // Ej: 23.45 podía guardarse como 23.450001 con FLOAT, lo que
        // cambiaba la resistencia recalculada en el backend.
        lecturaPrensa: {
            type: DataTypes.DECIMAL(8, 3),
            allowNull: true,
        },
        idPrensa: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        cargaAplicada: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: false,
        },
        resistencia: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: false,
        },
        ensayoTerceros: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        observaciones: {
            type: DataTypes.TEXT,
        },
        // Bloque 3 auditoría 08 — IRAM 1546:2013 §10.4
        // Factor de corrección por relación H/D. Si H/D=2 → 1.000. Si la
        // probeta se descabezó (rotura del encabezado, etc.) y queda con
        // H/D distinto de 2, se aplica el factor de la tabla.
        factorCorreccionHD: {
            type: DataTypes.DECIMAL(4, 3),
            allowNull: false,
            defaultValue: 1.000,
            comment: 'IRAM 1546:2013 §10.4 — factor por relación H/D (1.000 si H/D=2).',
        },
        // Bloque 3 auditoría 08 — IRAM 1546:2013 §11
        // Tipo de fractura observada. Nullable para registros legacy.
        tipoRotura: {
            type: DataTypes.ENUM('CONO', 'CONO_CORTANTE', 'COLUMNAR', 'DIAGONAL', 'CORTANTE', 'OTRO'),
            allowNull: true,
            comment: 'IRAM 1546:2013 §11 — tipo de fractura.',
        },
        pendienteRevision: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: "true = pendiente de revisión por responsable de calidad",
        },
        idAprobadoPor: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: null,
        },
        fechaAprobacion: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        // Mej-17 auditoría 08 — trazabilidad de desaprobación.
        motivoDesaprobacion: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        idDesaprobadoPor: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        fechaDesaprobacion: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        // Recursos MVP Fase A (sesión 2026-05-10) — snapshot de la
        // calibración del equipo vigente al momento del ensayo. Permite
        // que un perito reproduzca con qué coeficientes se calculó la
        // resistencia. Nullable para registros legacy y mientras no se
        // implemente el hook que la popla (Fase C).
        idCalibracionAplicada: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Snapshot de la calibración vigente al momento del ensayo (ISO 17025 §6.4.7).',
        },
        idLaboratorio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Snapshot del laboratorio que ejecutó el ensayo. Auto-populado por hook desde la prensa si no se manda.',
        },
    }, {
        tableName: "EnsayoResistencia",
        comment:
            "Resultados de resistencia, con la edad de ensayo almacenada y calculada en la capa de aplicación. Se audita.",
    });

    EnsayoResistencia.associate = (models) => {
        EnsayoResistencia.belongsTo(models.Probeta, {
            foreignKey: "idProbeta",
            as: "probeta",
        });
        EnsayoResistencia.belongsTo(models.Empleado, {
            foreignKey: "idOperarioEnsayo",
            as: "operarioEnsayo",
        });
        EnsayoResistencia.belongsTo(models.Prensa, {
            foreignKey: "idPrensa",
            as: "prensa",
        });
        EnsayoResistencia.belongsTo(models.Empleado, {
            foreignKey: "idAprobadoPor",
            as: "aprobadoPor",
        });
        EnsayoResistencia.belongsTo(models.CalibracionEquipo, {
            foreignKey: "idCalibracionAplicada",
            as: "calibracionAplicada",
        });
        if (models.Laboratorio) {
            EnsayoResistencia.belongsTo(models.Laboratorio, {
                foreignKey: "idLaboratorio",
                as: "laboratorio",
            });
        }
    };

    return EnsayoResistencia;
};
