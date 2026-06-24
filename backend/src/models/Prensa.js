module.exports = (sequelize, DataTypes) => {
    const Prensa = sequelize.define('Prensa', {
        idPrensa: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        marca: {
            type: DataTypes.STRING(50),
        },
        modelo: {
            type: DataTypes.STRING(50),
        },
        anio: {
            type: DataTypes.DATE,
        },
        capacidad: {
            type: DataTypes.STRING(10),
        },
        fechaUltimaCalibracion: {
            type: DataTypes.DATEONLY,
        },
        certificadoVigente: {
            type: DataTypes.BOOLEAN,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
        idUnidadMedidaPrensa: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        tipoOperacion: {
            type: DataTypes.ENUM('MANUAL', 'AUTOMATICA', 'SEMIAUTOMATICA'),
            allowNull: false,
            defaultValue: 'MANUAL',
            comment: 'MANUAL = lectura dial + ecuación de calibración. AUTOMATICA/SEMIAUTOMATICA = carga directa de la prensa.',
        },
        coeficienteUno: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        coeficienteDos: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        coeficienteTres: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: null,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
    }, {
        tableName: 'Prensa',
        comment: 'Equipos de laboratorio para ensayos de resistencia a compresión.',
    });
    Prensa.associate = (models) => {
        Prensa.belongsTo(models.UnidadMedidaPrensa, {
            foreignKey: 'idUnidadMedidaPrensa',
            as: 'unidadMedida',
        });
        Prensa.belongsTo(models.Planta, {
            foreignKey: 'idPlanta',
            as: 'planta',
        });
    };
    return Prensa;
};