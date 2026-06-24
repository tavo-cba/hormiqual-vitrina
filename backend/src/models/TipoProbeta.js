module.exports = (sequelize, DataTypes) => {
    const TipoProbeta = sequelize.define('TipoProbeta', {
        idTipoProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        tipo: {
            type: DataTypes.STRING(20),
            allowNull: false,
            unique: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
    }, {
        tableName: 'TipoProbeta',
        comment: 'Tipos de probetas de hormigón, clasificadas por dimensiones.',
    });

    return TipoProbeta;
};