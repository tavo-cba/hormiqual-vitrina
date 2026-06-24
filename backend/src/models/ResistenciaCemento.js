module.exports = (sequelize, DataTypes) => {
    const ResistenciaCemento = sequelize.define('ResistenciaCemento', {
        idResistenciaCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        valor: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true,
        },
    }, {
        tableName: 'ResistenciaCemento',
        comment: 'Categorías de resistencia a compresión.',
        timestamp: false
    });

    return ResistenciaCemento;
};