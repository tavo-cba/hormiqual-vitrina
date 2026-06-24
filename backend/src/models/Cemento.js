module.exports = (sequelize, DataTypes) => {
    const Cemento = sequelize.define('Cemento', {
        idCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombreComercial: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        fabricante: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        origenFabrica: {
            type: DataTypes.STRING(50),
        },
        composicion: {
            type: DataTypes.STRING(3), // para CPN, CPF, ...
        },
        resistencia: {
            type: DataTypes.INTEGER, 
        },
        propiedades: {
            type: DataTypes.STRING(100), // CSV con "ARI,ARS" ...
        },
        densidadRelativa: {
            type: DataTypes.DECIMAL(5, 3),
            allowNull: true,
            comment: 'Densidad relativa del cemento (e.g. 3.15)',
        },
        claseResistente: {
            type: DataTypes.STRING(20),
            allowNull: true,
            comment: 'Clase resistente normativa (e.g. CP40, CP50)',
        },
        familiaCemento: {
            type: DataTypes.STRING(20),
            allowNull: true,
            comment: 'Familia para curvas a/c: CP30, CP40, CP50',
        },
        tipoNormativo: {
            type: DataTypes.STRING(40),
            allowNull: true,
            comment: 'Tipo según norma IRAM (ej: CPN 40 ARI)',
        },
        desarrolloResistencia: {
            type: DataTypes.ENUM('RAPIDO', 'NORMAL', 'LENTO'),
            allowNull: true,
            comment: 'Velocidad de desarrollo de resistencia',
        },
        edadReferenciaDefault: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: 28,
            comment: 'Edad de referencia (días)',
        },
        factorAjusteICPA: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: true,
            defaultValue: 1.00,
            comment: 'Factor multiplicador sobre resistencias del Ábaco 2 ICPA. >1 = cemento rinde más que la curva genérica, <1 = rinde menos. Default 1.00 = sin ajuste.',
        },
        modoCurvaPreferido: {
            type: DataTypes.ENUM('ICPA', 'PROPIA', 'FABRICANTE'),
            allowNull: true,
            defaultValue: 'ICPA',
            comment: 'DEPRECATED — columna zombi ignorada por el motor. La fuente de verdad es CementoPlanta.modoCurva (configurable por planta).',
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
        tableName: 'Cemento',
        comment: 'Cementos específicos fabricados por distintas empresas.',
    });

    return Cemento;
};