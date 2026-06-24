module.exports = (sequelize, DataTypes) => {
    const DosificacionHistory = sequelize.define('DosificacionHistory', {
        idHistory: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        idTipoHormigon: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idEdadDisenio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idAsentamientoDisenio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        agua: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: false,
        },
        idTamanioMaximoNominal: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idTipoDescarga: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        codigoEnPlanta: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
        deleted_at: {
            type: DataTypes.DATE,
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
        tableName: 'DosificacionHistory',
        comment: 'Historial de cambios en la tabla Dosificacion.',
    });

    return DosificacionHistory;
};