module.exports = (sequelize, DataTypes) => {
    const AgregadoEnsayo = sequelize.define('AgregadoEnsayo', {
        idAgregadoEnsayo: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        legacyAgregadoId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idAgregadoEnsayoTipo: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        fechaMuestreo: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        fechaEnsayo: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        laboratorio: {
            type: DataTypes.STRING(150),
            allowNull: true,
        },
        nroInforme: {
            type: DataTypes.STRING(80),
            allowNull: true,
        },
        resultado: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        cumple: {
            type: DataTypes.ENUM('CUMPLE', 'NO_CUMPLE', 'NO_EVAL', 'PENDIENTE'),
            allowNull: false,
            defaultValue: 'NO_EVAL',
        },
        observaciones: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        fechaVencimiento: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        fuenteEnsayoId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: null,
            comment: 'FK al ensayo fuente que generó este derivado',
        },
        esAutoCalculado: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'true = generado automáticamente, no editable manualmente',
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        contextoAplicacion: {
            type: DataTypes.ENUM('HORMIGON', 'TBS', 'AMBOS'),
            allowNull: false,
            defaultValue: 'HORMIGON',
            comment: 'HORMIGON evalúa contra IRAM 1627/CIRSOC. TBS evalúa contra huso DNV al armar Dotación. AMBOS suma las dos.',
        },
        idHusoDnvReferencia: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Huso DNV contra el que se evalúa la curva en contexto TBS. Opcional.',
        },
    }, {
        tableName: 'AgregadoEnsayo',
        comment: 'Ensayo concreto realizado sobre un agregado existente.',
    });

    AgregadoEnsayo.associate = (models) => {
        AgregadoEnsayo.belongsTo(models.AgregadoEnsayoTipo, {
            foreignKey: 'idAgregadoEnsayoTipo',
            as: 'tipo',
        });
        AgregadoEnsayo.hasMany(models.AgregadoEnsayoArchivo, {
            foreignKey: 'idAgregadoEnsayo',
            as: 'archivos',
        });
        AgregadoEnsayo.belongsTo(models.AgregadoEnsayo, {
            foreignKey: 'fuenteEnsayoId',
            as: 'fuenteEnsayo',
        });
        AgregadoEnsayo.hasMany(models.AgregadoEnsayo, {
            foreignKey: 'fuenteEnsayoId',
            as: 'derivados',
        });
        // [VITRINA] Podada: HusoDNV (TBS/DNV).
    };

    return AgregadoEnsayo;
};
