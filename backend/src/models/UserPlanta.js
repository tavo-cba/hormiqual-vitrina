module.exports = (sequelize, DataTypes) => {
    const UserPlanta = sequelize.define('UserPlanta', {
        idUserPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idUser: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
    }, {
        tableName: 'UserPlanta',
        timestamps: false,
        comment: 'Relaciona usuarios con plantas habilitadas',
    });

    UserPlanta.associate = (models) => {
        UserPlanta.belongsTo(models.User, { foreignKey: 'idUser', as: 'user' });
        UserPlanta.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
    };

    return UserPlanta;
};