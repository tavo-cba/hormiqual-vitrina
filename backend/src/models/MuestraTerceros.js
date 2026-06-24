module.exports = (sequelize, DataTypes) => {
    const MuestraTerceros = sequelize.define('MuestraTerceros', {
        idMuestraTerceros: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idTipoProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        fecha: {
            type: DataTypes.DATEONLY,
            allowNull: false,
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
        },
        remito: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        idOperador: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idCliente: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idObra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idTipoHormigon: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idModalidadMuestra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Modalidad de toma (en obra / planta / remota).',
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Dosificación del catálogo. Mutuamente excluyente con dosificacionTextoLibre.',
        },
        dosificacionTextoLibre: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Texto libre cuando la dosificación no está en el catálogo del tenant.',
        },
        aireincorporado: {
            type: DataTypes.FLOAT,
            allowNull: true,
            comment: 'Porcentaje de aire incorporado medido en fresco.',
        },
        estado: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        }
    }, {
        tableName: 'MuestraTerceros',
        comment: 'Muestras tomadas a terceros para ensayos de resistencia.',
        timestamps: false
    });

    MuestraTerceros.associate = (models) => {
        MuestraTerceros.belongsTo(models.TipoProbeta, { foreignKey: 'idTipoProbeta', as: 'tipoProbeta' });
        MuestraTerceros.belongsTo(models.Empleado, { foreignKey: 'idOperador', as: 'operador' });
        MuestraTerceros.belongsTo(models.Cliente, { foreignKey: 'idCliente', as: 'cliente' });
        MuestraTerceros.belongsTo(models.Obra, { foreignKey: 'idObra', as: 'obra' });
        MuestraTerceros.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
        MuestraTerceros.belongsTo(models.TipoHormigon, { foreignKey: 'idTipoHormigon', as: 'tipoHormigon' });
        if (models.ModalidadMuestra) {
            MuestraTerceros.belongsTo(models.ModalidadMuestra, { foreignKey: 'idModalidadMuestra', as: 'modalidad' });
        }
        if (models.Dosificacion) {
            MuestraTerceros.belongsTo(models.Dosificacion, { foreignKey: 'idDosificacion', as: 'dosificacion' });
        }
        MuestraTerceros.hasMany(models.Probeta, { foreignKey: 'idMuestraTerceros', as: 'probetas' });
    };

    return MuestraTerceros;
};