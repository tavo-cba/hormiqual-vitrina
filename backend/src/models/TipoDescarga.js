module.exports = (sequelize, DataTypes) => {
    const TipoDescarga = sequelize.define('TipoDescarga', {
        idTipoDescarga: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        tipo: {
            type: DataTypes.STRING(50),
            allowNull: false,
            unique: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
    }, {
        tableName: 'TipoDescarga',
        comment: 'Define la forma en que se descarga el hormigón en la obra, de acuerdo a parámetros de diseño.',
    });

    return TipoDescarga;
};