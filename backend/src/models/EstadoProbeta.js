module.exports = (sequelize, DataTypes) => {
    const EstadoProbeta = sequelize.define('EstadoProbeta', {
        idEstadoProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        estado: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
    }, {
        tableName: 'EstadoProbeta',
        comment: 'Estados posibles de una probeta dentro del proceso de control de calidad.',
    });

    return EstadoProbeta;
};