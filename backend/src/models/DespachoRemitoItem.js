module.exports = (sequelize, DataTypes) => {
    const DespachoRemitoItem = sequelize.define('DespachoRemitoItem', {
        idDespachoRemitoItem: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idDespacho: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idProductoServicio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        descripcion: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        cantidad: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 1,
        },
        orden: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
        },
        isDefault: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 0,
        },
    }, {
        tableName: 'DespachoRemitoItem',
        timestamps: true,
        comment: 'Items configurados para el remito de un despacho de hormigón.',
    });

    DespachoRemitoItem.associate = (models) => {
        DespachoRemitoItem.belongsTo(models.Despacho, {
            foreignKey: 'idDespacho',
            as: 'despacho',
        });
        // [VITRINA] Podada: ProductoServicio.
    };

    return DespachoRemitoItem;
};
