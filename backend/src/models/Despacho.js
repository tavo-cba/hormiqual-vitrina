module.exports = (sequelize, DataTypes) => {
    const Despacho = sequelize.define('Despacho', {
        idDespacho: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        volumenDepacho: {
            type: DataTypes.FLOAT.UNSIGNED,
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
        confirmacionHorario: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        remito: {
            type: DataTypes.STRING(20),
        },
        asentamiento: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        observaciones: {
            type: DataTypes.STRING(250),
            allowNull: true,
        },
        idDosificacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'FK a Dosificacion (catálogo legacy). Mutuamente excluyente con idDosificacionDisenada — el despacho tiene una u otra según `Planta.origenDosificaciones`.',
        },
        idDosificacionDisenada: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'FK a DosificacionDisenada (motor Calidad). Mutuamente excluyente con idDosificacion.',
        },
        ordenPlantista: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Orden ejecutado por el plantista en la cola "Por despachar". NULL = sin reordenar.',
        },
        idCliente: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idObra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idVehiculo: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idSemirremolque: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idEmpleado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        idDespachoEstado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 1,
        },
        idMuestra: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idPedido: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idBocaCarga: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Boca de carga asignada. NULL = planta con boca única o sin asignar.',
        },
        travelTime: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'Tiempo de viaje en segundos para el despacho.',
        },
        tieneMuestra: {
            type: DataTypes.TINYINT(1),
            allowNull: false,
            defaultValue: 0
        },
        muestraObligatoria: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Si el pedido exige muestra (Fase B). El Panel Plantista la requiere antes de finalizar la carga.',
        },
        retiraEnPlanta: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        rutaReal: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
            comment: 'JSON array de breadcrumbs GPS [{lat,lng,ts}] del recorrido real planta→obra',
            get() {
                const raw = this.getDataValue('rutaReal');
                if (!raw) return null;
                try { return JSON.parse(raw); } catch { return null; }
            },
            set(val) {
                this.setDataValue('rutaReal', val ? JSON.stringify(val) : null);
            },
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
    }, {
        tableName: 'Despacho',
        comment: 'Registro de todos los despachos de hormigón.',
    });

    Despacho.associate = (models) => {
        Despacho.belongsTo(models.Dosificacion, {
            foreignKey: 'idDosificacion',
            as: 'dosificacion',
        });
        if (models.DosificacionDisenada) {
            Despacho.belongsTo(models.DosificacionDisenada, {
                foreignKey: 'idDosificacionDisenada',
                as: 'dosificacionDisenada',
            });
        }
        Despacho.belongsTo(models.Cliente, {
            foreignKey: 'idCliente',
            as: 'cliente',
        });
        Despacho.belongsTo(models.Obra, {
            foreignKey: 'idObra',
            as: 'obra',
        });
        Despacho.hasOne(models.Muestra, {
            foreignKey: "idDespacho",
            as: "muestras",
            onDelete: "CASCADE",
            hooks: true,
        });
        // [VITRINA] Podadas: Vehiculo (x2), Pedido, BocaCarga, RemitoVenta, RemitoToken.
        Despacho.belongsTo(models.DespachoEstado, {
            foreignKey: 'idDespachoEstado',
            as: 'estadoDespacho',
        });
        Despacho.belongsTo(models.Empleado, {
            foreignKey: 'idEmpleado',
            as: 'chofer',
        });
        Despacho.belongsTo(models.Planta, {
            foreignKey: 'idPlanta',
            as: 'planta',
        });
        Despacho.hasMany(models.DespachoAditivosExtra, { foreignKey: 'idDespacho', as: 'aditivosExtra' });
        Despacho.hasMany(models.DespachoCementosExtra, { foreignKey: 'idDespacho', as: 'cementosExtra' });
        Despacho.hasMany(models.DespachoAgregadosExtra, { foreignKey: 'idDespacho', as: 'agregadosExtra' });
        Despacho.hasMany(models.DespachoFibrasExtra, { foreignKey: 'idDespacho', as: 'fibrasExtra' });
        Despacho.hasOne(models.DespachoAguaExtra, { foreignKey: 'idDespacho', as: 'aguaExtra' });
        Despacho.hasMany(models.DespachoRemitoItem, { foreignKey: 'idDespacho', as: 'remitoItems', onDelete: 'CASCADE' });
        Despacho.hasMany(models.DespachoEstadoHistory, { foreignKey: 'idDespacho', as: 'estadoHistory' });

    };

    return Despacho;
};