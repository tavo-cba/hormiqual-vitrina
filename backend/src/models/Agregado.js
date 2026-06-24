module.exports = (sequelize, DataTypes) => {
    const Agregado = sequelize.define('Agregado', {
        idAgregado: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(40),
            allowNull: false,
        },
        origen: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        densidad: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: true,
        },
        pesoAparente: {
            type: DataTypes.DECIMAL(6, 2),
            allowNull: true,
        },
        absorcion: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: true,
        },
        moduloFinura: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: true,
        },
        idUnidadMedida: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        slotBetonmatic: {
            type: DataTypes.STRING(10),
            allowNull: true,
            comment: 'Slot Betonmatic donde se carga este agregado en su planta (ej. "AR1"). Opción A — un material, un slot.',
        },
        // Índice de Demanda de Agua (IDA)
        ida: {
            type: DataTypes.DECIMAL(4, 3),
            allowNull: true,
            defaultValue: 1.000,
            comment: 'Índice de Demanda de Agua. 1.000 = estándar. >1 = más demanda, <1 = menos.',
        },
        idaModo: {
            type: DataTypes.ENUM('auto', 'manual'),
            allowNull: false,
            defaultValue: 'auto',
            comment: 'auto = recalculado con ensayos, manual = valor fijado por el usuario.',
        },
        idaSugerido: {
            type: DataTypes.DECIMAL(4, 3),
            allowNull: true,
            comment: 'IDA sugerido por el sistema basado en ensayos (pasa 200, absorción, etc.).',
        },
        idaNotas: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Justificación del IDA manual.',
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        // ─── Campos TBS (Pliego DNV 2017) ───
        aptitudes: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: ['HORMIGON'],
            comment: 'Lista con valores HORMIGON, TBS_RODAMIENTO, TBS_NO_RODAMIENTO.',
            // MySQL + Sequelize: DataTypes.JSON se mapea a LONGTEXT, no a JSON nativo.
            // El auto-parseo al leer no siempre se aplica — garantizamos array con getter/setter
            // para que el frontend (y cualquier consumer) reciba siempre la forma correcta.
            get() {
                const raw = this.getDataValue('aptitudes');
                if (raw == null) return ['HORMIGON'];
                if (Array.isArray(raw)) return raw;
                if (typeof raw === 'string') {
                    if (raw === '') return ['HORMIGON'];
                    try { return JSON.parse(raw); } catch { return ['HORMIGON']; }
                }
                return raw;
            },
            set(value) {
                // Normalizar: aceptar array o string JSON; guardar como string JSON para LONGTEXT.
                if (value == null) {
                    this.setDataValue('aptitudes', JSON.stringify(['HORMIGON']));
                } else if (Array.isArray(value)) {
                    this.setDataValue('aptitudes', JSON.stringify(value));
                } else if (typeof value === 'string') {
                    try { JSON.parse(value); this.setDataValue('aptitudes', value); }
                    catch { this.setDataValue('aptitudes', JSON.stringify([value])); }
                } else {
                    this.setDataValue('aptitudes', JSON.stringify(value));
                }
            },
        },
        origenRoca: {
            type: DataTypes.ENUM('ROCA_SANA', 'GRAVA', 'BASALTICO'),
            allowNull: true,
            comment: 'Clasificación estructurada requerida por DNV TBS (basalto → Sonnenbrand; grava → relación partícula triturada).',
        },
        esCalizo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'True si es caliza. DNV excluye calizos de capa de rodamiento.',
        },
    }, {
        tableName: 'Agregado',
        comment: 'Datos comunes de un agregado (ya sea fino o grueso).',
    });

    Agregado.associate = (models) => {
        Agregado.belongsTo(models.UnidadMedida, {
            foreignKey: 'idUnidadMedida',
            as: 'unidadMedida',
        });
        Agregado.belongsTo(models.Planta, {
            foreignKey: 'idPlanta',
            as: 'planta',
        });
        Agregado.hasOne(models.AgregadoFino, {
            foreignKey: "idAgregado",
            as: "agregadoFino",          // alias opcional
        });
        Agregado.hasOne(models.AgregadoGrueso, {
            foreignKey: "idAgregado",
            as: "agregadoGrueso",
        });
        Agregado.hasOne(models.AgregadoMeta, {
            foreignKey: "legacyAgregadoId",
            sourceKey: "idAgregado",
            as: "agregadoMeta",
        });
    };

    return Agregado;
};