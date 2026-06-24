module.exports = (sequelize, DataTypes) => {
    const Dosificacion = sequelize.define('Dosificacion', {
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        idTipoHormigon: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idEdadDisenio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idAsentamientoDisenio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        agua: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: false,
        },
        idTamanioMaximoNominal: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idTipoDescarga: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        codigoEnPlanta: {
            type: DataTypes.STRING(20),
            allowNull: true,
            comment: 'Código de fórmula en Betonmatic (codigoDeFormula)',
        },
        codigoHormigonEnPlanta: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Código de hormigón en Betonmatic (codigoDeHormigon)',
        },
        descripcion: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        mfDiseno: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: true,
            comment: 'PR8.1 — Módulo de Finura del AF de diseño. Se compara contra el MF de cada partida para verificar CIRSOC 200:2024 §3.2.3.2.g (variación ≤ 0.20). NULL en datos legacy.',
        },
        // Sesión 2026-05-10: FRE-02 (S6 audit 01-calidad). Permite evaluar
        // el aire incorporado contra Tabla 4.3 CIRSOC 200-2024 §4.1.2 (la
        // matriz está discretizada por TMN × clase de exposición). Nullable
        // para back-compat con dosificaciones legacy.
        idDurabilidadExposicion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        deleted_at: {
            type: DataTypes.DATE,
            comment: 'Borrado lógico: fecha/hora de inactivación.',
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
    }, {
        tableName: 'Dosificacion',
        comment: 'Receta de hormigón (composición). Se audita con triggers.',
    });

    Dosificacion.associate = (models) => {
        /* catálogos */
        Dosificacion.belongsTo(models.TipoHormigon,         { foreignKey: 'idTipoHormigon',         as: 'tipoHormigon'         });
        Dosificacion.belongsTo(models.EdadDisenio,          { foreignKey: 'idEdadDisenio',          as: 'edadDisenio'          });
        Dosificacion.belongsTo(models.AsentamientoDisenio,  { foreignKey: 'idAsentamientoDisenio',  as: 'asentamientoDisenio'  });
        Dosificacion.belongsTo(models.TamanioMaximoNominal, { foreignKey: 'idTamanioMaximoNominal', as: 'tamanioMaximoNominal' });
        Dosificacion.belongsTo(models.TipoDescarga,         { foreignKey: 'idTipoDescarga',         as: 'tipoDescarga'         });
        Dosificacion.belongsTo(models.Planta,               { foreignKey: 'idPlanta',               as: 'planta'               });
        Dosificacion.belongsTo(models.DurabilidadExposicion, { foreignKey: 'idDurabilidadExposicion', as: 'durabilidadExposicion' });

        /* materiales pivot  ➜  alias EXACTOS que usas en include */
        Dosificacion.hasMany(models.DosificacionCemento,  { foreignKey: 'idDosificacion', as: 'cementos'   });
        Dosificacion.hasMany(models.DosificacionAditivos,  { foreignKey: 'idDosificacion', as: 'aditivos'   });
        Dosificacion.hasMany(models.DosificacionAgregados, { foreignKey: 'idDosificacion', as: 'agregados'  });
        Dosificacion.hasMany(models.DosificacionFibras, { foreignKey: 'idDosificacion', as: 'fibras'  });
      };

    return Dosificacion;
};