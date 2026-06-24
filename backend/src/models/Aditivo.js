module.exports = (sequelize, DataTypes) => {
    const Aditivo = sequelize.define('Aditivo', {
        idAditivo: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        marca: {
            type: DataTypes.STRING(20),
            allowNull: false,
        },
        fabrica: {
            type: DataTypes.STRING(20),
            allowNull: false,
        },
        funcion: {
            type: DataTypes.STRING(255),
        },
        tipoFuncional: {
            type: DataTypes.ENUM(
                'PLASTIFICANTE', 'REDUCTOR_AGUA_RANGO_MEDIO', 'SUPERPLASTIFICANTE',
                'FLUIDIFICANTE', 'RETARDADOR', 'CONTROLADOR_HIDRATACION',
                'INCORPORADOR_AIRE', 'ESPUMIGENO', 'OTRO'
            ),
            allowNull: true,
        },
        subtipo: {
            type: DataTypes.STRING(80),
            allowNull: true,
        },
        baseQuimica: {
            type: DataTypes.STRING(80),
            allowNull: true,
        },
        unidadDosificacion: {
            type: DataTypes.ENUM('PORC_SOBRE_CEMENTO', 'ML_POR_100KG_CEMENTO', 'KG_M3'),
            allowNull: true,
        },
        idUnidadMedida: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        dosisMinima: {
            type: DataTypes.DECIMAL(6, 2),
        },
        dosisMaxima: {
            type: DataTypes.DECIMAL(6, 2),
        },
        densidad: {
            type: DataTypes.DECIMAL(6, 2),
        },
        dosisHabitual: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: true,
        },
        reduccionAguaPctEsperada: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
        },
        incrementoAsentamientoEsperado: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
        },
        retencionTrabajabilidadMin: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        retardoEsperadoMin: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        aireIncorporadoPctEsperado: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: true,
        },
        solidosPct: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
            comment: 'Porcentaje de sólidos',
        },
        modoEfectoSugerido: {
            type: DataTypes.ENUM(
              'AHORRO_AGUA', 'AUMENTO_ASENTAMIENTO',
              'RETARDANTE', 'ACELERANTE_FRAGUE', 'ACELERANTE_ENDURECIMIENTO',
              'INCORPORADOR_AIRE', 'ESPUMIGENO', 'ANTICONGELANTE', 'REDUCTOR_RETRACCION',
              'EXPANSIVO', 'INHIBIDOR_CORROSION', 'VISCOSANTE',
              'IMPERMEABILIZANTE', 'FIBRAS', 'OTRO',
            ),
            allowNull: true,
            comment: 'Modo de efecto sugerido por defecto',
        },
        observaciones: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        metadataTecnicaJson: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
    }, {
        tableName: 'Aditivo',
        comment: 'Aditivos utilizados en la mezcla (plastificantes, retardantes, etc.).',
    });

    Aditivo.associate = (models) => {
        Aditivo.belongsTo(models.UnidadMedida, {
            foreignKey: 'idUnidadMedida',
            as: 'unidadMedida',
        });
    };

    return Aditivo;
};