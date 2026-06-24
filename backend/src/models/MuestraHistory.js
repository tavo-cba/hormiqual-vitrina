module.exports = (sequelize, DataTypes) => {
    const MuestraHistory = sequelize.define('MuestraHistory', {
        idHistory: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idMuestra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        cantidadProbetas: {
            type: DataTypes.TINYINT.UNSIGNED,
            allowNull: false,
        },
        idTipoProbeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        fecha: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        hora: {
            type: DataTypes.TIME,
            allowNull: true,
        },
        temperaturaAmbiente: {
            type: DataTypes.DECIMAL(3, 1),
            allowNull: true,
        },
        temperaturaHormigon: {
            type: DataTypes.DECIMAL(3, 1),
            allowNull: true,
        },
        asentamiento: {
            type: DataTypes.DECIMAL(3, 1),
            allowNull: true,
        },
        remito: {
            type: DataTypes.STRING(20),
        },
        operation_type: {
            type: DataTypes.ENUM('INSERT', 'UPDATE', 'DELETE'),
            allowNull: false,
        },
        operation_date: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        operation_user: {
            type: DataTypes.STRING(50),
            defaultValue: 'desconocido',
        },
    }, {
        tableName: 'MuestraHistory',
        comment: 'Historial de cambios en la tabla Muestra.',
    });

    return MuestraHistory;
};