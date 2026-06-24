module.exports = (sequelize, DataTypes) => {
    const NormaArchivo = sequelize.define('NormaArchivo', {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        normaId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        filename: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        storageKey: {
            type: DataTypes.STRING(500),
            allowNull: false,
            comment: 'S3 key or local path relative to uploads/',
        },
        mimeType: {
            type: DataTypes.STRING(100),
            allowNull: false,
            defaultValue: 'application/pdf',
        },
        size: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'File size in bytes',
        },
        uploadedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
        },
    }, {
        tableName: 'NormaArchivo',
        timestamps: false,
    });

    NormaArchivo.associate = (models) => {
        NormaArchivo.belongsTo(models.Norma, {
            foreignKey: 'normaId',
            as: 'norma',
        });
    };

    return NormaArchivo;
};
