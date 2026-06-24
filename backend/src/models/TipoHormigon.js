module.exports = (sequelize, DataTypes) => {
    const TipoHormigon = sequelize.define('TipoHormigon', {
        idTipoHormigon: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        tipoHormigon: {
            type: DataTypes.STRING(10),
            allowNull: false,
        },
        // M-CAL-05 (auditoría 08, sesión 2026-05-08): resistencia
        // característica f'c en MPa. Antes se extraía con regex del string
        // `tipoHormigon` (frágil: "H-300" devolvía 300 erróneamente).
        // Si está NULL, el caller hace fallback al regex con warning.
        fcMpa: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
            comment: "Resistencia característica f'c en MPa.",
        },
        // Refactor 2026-05-20 (segunda pasada) — origen normativo de la clase.
        // Permite distinguir clases vigentes (IRAM 1666:2020 + CIRSOC 200:2024)
        // de clases históricas que se siguen usando "por usos y costumbres"
        // (CIRSOC 201:1982 / IRAM 1666:1986: H-8, H-13, H-17, H-21).
        enIram1666: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        enCirsoc200: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        notaLegacy: {
            type: DataTypes.STRING(120),
            allowNull: true,
            comment: 'Si la clase es histórica, texto del origen normativo (ej. "CIRSOC 201:1982 / IRAM 1666:1986").',
        },
        // true si la clase fue creada al vuelo porque el f'ce ingresado no
        // matcheó ninguna del catálogo normativo. Reemplaza al `fueraIram1666`
        // de la primera pasada (semántica ambigua).
        adHoc: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
    }, {
        tableName: 'TipoHormigon',
        comment: 'Clasifica el hormigón según su resistencia/diseño (ej. H21).',
    });

    return TipoHormigon;
};