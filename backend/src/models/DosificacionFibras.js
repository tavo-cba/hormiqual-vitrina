module.exports = (sequelize, DataTypes) => {
    const DosificacionFibras = sequelize.define('DosificacionFibras', {
        idDosificacionFibras: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idFibra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        cantidadFibra: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: false,
        },
    }, {
        tableName: 'DosificacionFibras',
        comment: 'Asocia fibras y su cantidad a la dosificación.',
    });

    DosificacionFibras.associate = (models) => {
        DosificacionFibras.belongsTo(models.Dosificacion, {
            foreignKey: 'idDosificacion',
            as: 'dosificacion',
        });
        DosificacionFibras.belongsTo(models.Fibra, {
            foreignKey: 'idFibra',
            as: 'fibra',
        });
    };

    return DosificacionFibras;
};