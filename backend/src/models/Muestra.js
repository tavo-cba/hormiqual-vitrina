module.exports = (sequelize, DataTypes) => {
    const Muestra = sequelize.define('Muestra', {
        idMuestra: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        cantidadProbetas: {
            type: DataTypes.TINYINT.UNSIGNED,
            allowNull: false,
        },
        idDespacho: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idCliente: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idTipoHormigon: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        fecha: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idDosificacionDisenada: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'FK opcional a DosificacionDisenada (despachos del Diseñador). Mutuamente excluyente con idDosificacion (legacy).',
        },
        idObra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        remito: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        idTipoProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        temperaturaAmbiente: {
            type: DataTypes.DECIMAL(3, 1),
            allowNull: true,
        },
        temperaturaHormigon: {
            type: DataTypes.DECIMAL(3, 1),
            allowNull: true,
        },
        asentamiento: {
            type: DataTypes.DECIMAL(3, 1),
            allowNull: true,
            comment: '@deprecated — usar asentamientoMm. Mantenido para back-compat con código legacy.',
        },
        // C-MOD-04 fix (auditoría 08, Bloque 5): unidad explícita en mm,
        // consistente con `MedicionPaston.asentamientoMm` y con IRAM 1536.
        asentamientoMm: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: true,
            comment: 'Asentamiento (cono de Abrams) en mm — IRAM 1536:1978.',
        },
        aireincorporado: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        idOperador: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idModalidadMuestra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        estado: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },

    }, {
        tableName: 'Muestra',
        comment: 'Registro de cada muestra de hormigón fresco. Puede o no estar asociada a un despacho.',
    });

    Muestra.associate = (models) => {
        // C-MOD-01 fix (auditoría 08, Bloque 6): cascadas peligrosas hacia
        // arriba reemplazadas por RESTRICT. Antes: borrar un Empleado, un
        // TipoProbeta o un Despacho disparaba DELETE en cascada de todas
        // las muestras dependientes + sus probetas + ensayos (evidencia
        // normativa). Ahora la dependencia se respeta y obliga al admin a
        // resolver el conflicto explícitamente. La cascada hacia abajo
        // (Muestra → Probeta) sí se mantiene, ver hasMany al final.
        Muestra.belongsTo(models.TipoProbeta, {
            foreignKey: 'idTipoProbeta',
            as: 'tipoprobeta',
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
        });
        Muestra.belongsTo(models.ModalidadMuestra, {
            foreignKey: 'idModalidadMuestra',
            as: 'modalidad',
        });
        Muestra.belongsTo(models.Empleado, {
            foreignKey: 'idOperador',
            as: 'operador',
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
        });
        Muestra.belongsTo(models.Despacho, {
            foreignKey: 'idDespacho',
            as: 'despacho',
            onDelete: 'RESTRICT',
            onUpdate: 'CASCADE',
        });
        Muestra.belongsTo(models.Cliente, {
            foreignKey: 'idCliente',
            as: 'cliente',
        });
        Muestra.belongsTo(models.TipoHormigon, {
            foreignKey: 'idTipoHormigon',
            as: 'tipoHormigon',
        });
        Muestra.belongsTo(models.Planta, {
            foreignKey: 'idPlanta',
            as: 'planta',
        });
        Muestra.belongsTo(models.Dosificacion, {
            foreignKey: 'idDosificacion',
            as: 'dosificacion',
        });
        // FK opcional a la dosificación del Diseñador. Guard por si el tenant
        // no tiene el modelo de Calidad cargado (consistente con Despacho).
        if (models.DosificacionDisenada) {
            Muestra.belongsTo(models.DosificacionDisenada, {
                foreignKey: 'idDosificacionDisenada',
                as: 'dosificacionDisenada',
                onDelete: 'RESTRICT',
                onUpdate: 'CASCADE',
            });
        }
        Muestra.belongsTo(models.Obra, {
            foreignKey: 'idObra',
            as: 'obra',
        });
        Muestra.hasMany(models.Probeta, {
            foreignKey: 'idMuestra',
            as: 'probetas',
            onDelete: "CASCADE",
            hooks: true
        });
    };

    return Muestra;
};
