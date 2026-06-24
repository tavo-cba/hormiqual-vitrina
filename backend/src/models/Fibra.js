module.exports = (sequelize, DataTypes) => {
    const Fibra = sequelize.define('Fibra', {
        idFibra: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        marca: {
            type: DataTypes.STRING(80),
            allowNull: false,
        },
        fabrica: {
            type: DataTypes.STRING(40),
            allowNull: false,
        },
        funcion: {
            type: DataTypes.STRING(255),
        },
        tipo: {
            type: DataTypes.ENUM('MACRO', 'MICRO', 'OTRO'),
            allowNull: false,
            defaultValue: 'OTRO',
            comment: 'Macrofibra estructural | Microfibra polimérica | Otro',
        },
        densidad: {
            type: DataTypes.DECIMAL(6, 1),
            allowNull: true,
            comment: 'Densidad real de la fibra (kg/m³). Se usa para restar su volumen del balance de la mezcla. Típicos: acero 7850, sintética estructural 910, PP microfibra 910.',
        },
        dosisMinima: {
            type: DataTypes.DECIMAL(6, 3),
            allowNull: true,
            comment: 'Dosis mínima recomendada (kg/m³).',
        },
        dosisMaxima: {
            type: DataTypes.DECIMAL(6, 3),
            allowNull: true,
            comment: 'Dosis máxima recomendada (kg/m³).',
        },
        idUnidadMedida: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
    }, {
        tableName: 'Fibra',
        comment: 'Fibras utilizadas en la mezcla',
    });

    Fibra.associate = (models) => {
        Fibra.belongsTo(models.UnidadMedida, {
            foreignKey: 'idUnidadMedida',
            as: 'unidadMedida',
        });
    };

    return Fibra;
};