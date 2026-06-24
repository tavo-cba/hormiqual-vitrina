'use strict';

/**
 * MuestraPaston — tercera fuente de probetas, paralela a `Muestra` (propias)
 * y `MuestraTerceros`.
 *
 * Se genera automáticamente al guardar un pastón de prueba: las probetas
 * planificadas en el pastón se asocian a una `MuestraPaston` con `origen`
 * (PLANTA u OBRA) y se nombran `T{loteNumero}-{O|P}-P{n}`.
 *
 * Un mismo pastón puede generar UNA muestra (caso simple: todas las probetas
 * de planta) o varias (ej. mitad en planta + mitad en obra). La distinción
 * permite diferenciar dónde se moldearon y trazar el efecto del transporte.
 */
module.exports = (sequelize, DataTypes) => {
    const MuestraPaston = sequelize.define('MuestraPaston', {
        idMuestraPaston: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idPastonPrueba: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idObra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idCliente: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idTipoHormigon: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idOperador: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        origen: {
            type: DataTypes.ENUM('PLANTA', 'OBRA'),
            allowNull: false,
            comment: 'Lugar de toma. Determina la letra del nombre: O=obra, P=planta.',
        },
        fecha: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        loteNumero: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            comment: 'Número secuencial del pastón por día+planta+dosificación.',
        },
        // B3 (sugerencia DeepSeek 2026-06-14): condición de mezcla en el
        // momento del moldeo. Si hubo correcciones de agua/aditivo durante el
        // pastón, las probetas moldeadas antes vs después NO representan la
        // misma mezcla → la resistencia se interpreta mal sin saber a qué
        // medición del timeline corresponden. Granularidad a nivel MUESTRA
        // (un moldeo = una condición), no por probeta. Nullable: muestras
        // legacy o sin timeline quedan sin vínculo (se muestra "—").
        idMedicionPaston: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Medición del timeline del pastón vigente al moldear esta muestra (condición de mezcla).',
        },
        temperaturaAmbiente: { type: DataTypes.DECIMAL(3, 1), allowNull: true },
        temperaturaHormigon: { type: DataTypes.DECIMAL(3, 1), allowNull: true },
        asentamiento:        { type: DataTypes.DECIMAL(3, 1), allowNull: true },
        aireincorporado:     { type: DataTypes.FLOAT, allowNull: true },
        remito:              { type: DataTypes.STRING(50), allowNull: true },
        observaciones:       { type: DataTypes.TEXT, allowNull: true },
        estado: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        tableName: 'MuestraPaston',
        comment: 'Muestras de probetas generadas desde un pastón de prueba (paralelo a Muestra y MuestraTerceros).',
        indexes: [
            { fields: ['idPastonPrueba'] },
            { fields: ['fecha', 'idPlanta'] },
            { fields: ['idDosificacion'] },
        ],
    });

    MuestraPaston.associate = (models) => {
        if (models.PastonPrueba) {
            MuestraPaston.belongsTo(models.PastonPrueba, { foreignKey: 'idPastonPrueba', as: 'pastonPrueba' });
        }
        if (models.DosificacionDisenada) {
            MuestraPaston.belongsTo(models.DosificacionDisenada, { foreignKey: 'idDosificacion', as: 'dosificacion' });
        }
        if (models.Planta) {
            MuestraPaston.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
        }
        if (models.Obra) {
            MuestraPaston.belongsTo(models.Obra, { foreignKey: 'idObra', as: 'obra' });
        }
        if (models.Cliente) {
            MuestraPaston.belongsTo(models.Cliente, { foreignKey: 'idCliente', as: 'cliente' });
        }
        if (models.TipoHormigon) {
            MuestraPaston.belongsTo(models.TipoHormigon, { foreignKey: 'idTipoHormigon', as: 'tipoHormigon' });
        }
        if (models.Empleado) {
            MuestraPaston.belongsTo(models.Empleado, { foreignKey: 'idOperador', as: 'operador' });
        }
        if (models.Probeta) {
            MuestraPaston.hasMany(models.Probeta, { foreignKey: 'idMuestraPaston', as: 'probetas' });
        }
        if (models.MedicionPaston) {
            MuestraPaston.belongsTo(models.MedicionPaston, { foreignKey: 'idMedicionPaston', as: 'medicionPaston' });
        }
    };

    return MuestraPaston;
};
