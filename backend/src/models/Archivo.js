// /models/Archivo.js
module.exports = (sequelize, DataTypes) => {
    const Archivo = sequelize.define(
        'Archivo',
        {
            idArchivo: {
                type: DataTypes.INTEGER.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },
            nombreOriginal: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            key: {
                /*  ruta relativa en disco  –o–  key del objeto en S3  */
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            mimeType: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            size: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: false,
            },
            url: {
                type: DataTypes.STRING(512),
            },
            idProbeta: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idEmpleado: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idObra: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idPlanta: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idPrensa: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idVehiculo: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idRegistroCombustible: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idFuenteCombustible: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idFacturaCompra: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idPago: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idCobranza: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idFacturaVenta: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idDespacho: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idDespachoArido: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
            idOrdenVenta: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
            },
        },
        {
            tableName: 'Archivo',
            comment: 'Archivos subidos por el usuario',
        }
    );
    Archivo.associate = (models) => {
        Archivo.belongsTo(models.Probeta, {
            foreignKey: 'idProbeta',
            as: 'probeta',
            onDelete: 'CASCADE',
        });
        Archivo.belongsTo(models.Empleado, {
            foreignKey: 'idEmpleado',
            as: 'empleado',
            onDelete: 'CASCADE',
        });
        Archivo.belongsTo(models.Obra, {
            foreignKey: 'idObra',
            as: 'obra',
            onDelete: 'CASCADE',
        });
        Archivo.belongsTo(models.Planta, {
            foreignKey: 'idPlanta',
            as: 'planta',
            onDelete: 'CASCADE',
        });
        Archivo.belongsTo(models.Prensa, {
            foreignKey: 'idPrensa',
            as: 'prensa',
            onDelete: 'CASCADE',
        });
        // [VITRINA] Podadas: Vehiculo, RegistroCombustible, FuenteCombustible,
        // FacturaCompra, Pago, Cobranza, FacturaVenta, DespachoArido, OrdenVenta, Vencimiento.
        Archivo.belongsTo(models.Despacho, {
            foreignKey: 'idDespacho',
            as: 'despacho',
            onDelete: 'SET NULL',
        });
        Archivo.belongsToMany(models.CategoriaArchivo, {
            through: models.ArchivoCategoria,
            foreignKey: 'idArchivo',
            otherKey: 'idCategoriaArchivo',
            as: 'categorias',
        });
    };
    return Archivo;
};
