module.exports = (sequelize, DataTypes) => {
    const EquipoLaboratorio = sequelize.define('EquipoLaboratorio', {
        idEquipo: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        // Tipo de equipo. Generaliza Prensa a cualquier instrumento del
        // laboratorio sujeto a calibración trazable (IRAM 1546 §6.4 /
        // ISO/IEC 17025 §6.4.7). Las prensas migradas tienen tipo='PRENSA'.
        tipo: {
            type: DataTypes.ENUM(
                'PRENSA',
                'BALANZA',
                'HORNO',
                'ESTUFA',
                'AGITADOR',
                'VIBRADOR',
                'MESA_FLUIDEZ',
                'CONO_ABRAMS',
                'CONO_SLUMP',
                'PICNOMETRO',
                'VASO_VOLUMETRICO',
                'TERMOMETRO',
                'HIGROMETRO',
                'CRONOMETRO',
                'MEDIDOR_AIRE',
                'OTRO',
            ),
            allowNull: false,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        marca: { type: DataTypes.STRING(50), allowNull: true },
        modelo: { type: DataTypes.STRING(50), allowNull: true },
        numeroSerie: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Número de serie del equipo (trazabilidad ISO 17025).',
        },
        anio: { type: DataTypes.DATE, allowNull: true },
        capacidad: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Capacidad nominal con unidad (ej. "3000 kN", "500 g", "200 ºC").',
        },
        ubicacion: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Ubicación física del equipo (laboratorio, sala de curado, etc.).',
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Planta a la que pertenece. NULL = compartido. Caché legacy — la fuente real es EquipoPlanta.',
        },
        idLaboratorio: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Laboratorio al que pertenece el equipo. NULL = sin laboratorio asignado.',
        },
        // Vínculo con el catálogo de unidades de medida pensado originalmente
        // para prensas (kN, kgf, etc.). Para otros tipos puede quedar NULL.
        idUnidadMedidaPrensa: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        // Modo de operación (sólo significativo para tipo=PRENSA).
        tipoOperacion: {
            type: DataTypes.ENUM('MANUAL', 'AUTOMATICA', 'SEMIAUTOMATICA'),
            allowNull: false,
            defaultValue: 'MANUAL',
            comment: 'MANUAL = lectura dial + ecuación de calibración. AUTOMATICA/SEMIAUTOMATICA = carga directa de la prensa.',
        },
        // Coeficientes de regresión (sólo aplican si tipoOperacion = MANUAL).
        // Para AUTOMATICA/SEMIAUTOMATICA quedan NULL. Si se necesitan más de
        // 3 coeficientes, usar el campo `coeficientes` JSON de la calibración.
        coeficienteUno: { type: DataTypes.FLOAT, allowNull: true },
        coeficienteDos: { type: DataTypes.FLOAT, allowNull: true },
        coeficienteTres: { type: DataTypes.FLOAT, allowNull: true },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        observaciones: { type: DataTypes.TEXT, allowNull: true },
        // Campos denormalizados para listados rápidos. Se actualizan con
        // un hook cada vez que se crea/aprueba/anula una calibración.
        fechaUltimaCalibracion: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'Fecha de la última calibración vigente (denormalizado).',
        },
        certificadoVigente: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
            defaultValue: false,
            comment: 'Indica si la última calibración está vigente (denormalizado).',
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        deleted_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Borrado lógico.',
        },
    }, {
        tableName: 'EquipoLaboratorio',
        comment: 'Equipos del laboratorio sujetos a calibración trazable (IRAM 1546 §6.4 / ISO 17025 §6.4.7).',
        indexes: [
            { fields: ['tipo'] },
            { fields: ['idPlanta'] },
            { fields: ['activo'] },
        ],
    });

    EquipoLaboratorio.associate = (models) => {
        EquipoLaboratorio.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
        EquipoLaboratorio.belongsTo(models.UnidadMedidaPrensa, {
            foreignKey: 'idUnidadMedidaPrensa',
            as: 'unidadMedida',
        });
        EquipoLaboratorio.hasMany(models.CalibracionEquipo, {
            foreignKey: 'idEquipo',
            as: 'calibraciones',
        });
        if (models.EquipoPlanta) {
            EquipoLaboratorio.hasMany(models.EquipoPlanta, {
                foreignKey: 'idEquipo',
                as: 'plantasAsignadas',
            });
        }
        if (models.Laboratorio) {
            EquipoLaboratorio.belongsTo(models.Laboratorio, {
                foreignKey: 'idLaboratorio',
                as: 'laboratorio',
            });
        }
    };

    return EquipoLaboratorio;
};
