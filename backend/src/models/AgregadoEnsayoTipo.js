/**
 * PR1 — Coherencia multi-contexto.
 *
 * Ajusta los flags por contexto antes de validar/persistir:
 *   - aplicaAX = false               ⇒ nivelX = 'NINGUNA', obligatorioX = false
 *   - nivelX  = 'NINGUNA'            ⇒ obligatorioX = false
 *   - nivelX  = 'BASICA'             ⇒ obligatorioX = true (no se permite básica opcional)
 *   - nivelX  = 'AVANZADA'           ⇒ obligatorioX queda como venga (configurable)
 *   - aplicaAHormigon || aplicaATBS  ⇒ debe ser true (un ensayo huérfano no tiene sentido)
 *
 * Las inconsistencias derivables se corrigen silenciosamente; la única que
 * lanza error es el ensayo sin contexto alguno (ambos aplicaA en false).
 */
function aplicarCoherenciaMultiContexto(instance) {
    const ctxs = [
        { aplicaKey: 'aplicaAHormigon', nivelKey: 'nivelCaracterizacionHormigon', oblKey: 'obligatorioHormigon' },
        { aplicaKey: 'aplicaATBS',      nivelKey: 'nivelCaracterizacionTBS',      oblKey: 'obligatorioTBS' },
    ];

    for (const { aplicaKey, nivelKey, oblKey } of ctxs) {
        const aplica = instance[aplicaKey];
        if (aplica === false) {
            instance[nivelKey] = 'NINGUNA';
            instance[oblKey] = false;
            continue;
        }
        const nivel = instance[nivelKey];
        if (nivel === 'NINGUNA') {
            instance[oblKey] = false;
        } else if (nivel === 'BASICA') {
            instance[oblKey] = true;
        }
        // 'AVANZADA' deja obligatorioX libre.
    }

    if (instance.aplicaAHormigon === false && instance.aplicaATBS === false) {
        throw new Error(
            'AgregadoEnsayoTipo: el ensayo debe aplicar al menos a un contexto (aplicaAHormigon o aplicaATBS).'
        );
    }
}

module.exports = (sequelize, DataTypes) => {
    const AgregadoEnsayoTipo = sequelize.define('AgregadoEnsayoTipo', {
        idAgregadoEnsayoTipo: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        codigo: {
            type: DataTypes.STRING(80),
            allowNull: false,
            unique: true,
        },
        nombre: {
            type: DataTypes.STRING(200),
            allowNull: false,
        },
        normaRef: {
            type: DataTypes.STRING(120),
            allowNull: true,
        },
        aplicaA: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Array de strings, e.g. ["FINO","GRUESO"]. NULL = ambos.',
        },
        unidad: {
            type: DataTypes.STRING(30),
            allowNull: true,
        },
        periodicidadMeses: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        obligatorio: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Ensayo obligatorio según norma IRAM/CIRSOC',
        },
        warningDays: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Días antes del vencimiento para mostrar alerta',
        },
        orden: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Orden de presentación en la UI',
        },
        categoria: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Agrupación: fisica, mecanica, limpieza, forma, durabilidad',
        },
        resultadoSchema: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        esDerivado: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'true = se genera automáticamente a partir de otro ensayo',
        },
        derivadoDeCodigo: {
            type: DataTypes.STRING(80),
            allowNull: true,
            defaultValue: null,
            comment: 'Codigo del AgregadoEnsayoTipo fuente',
        },
        derivadoClave: {
            type: DataTypes.STRING(80),
            allowNull: true,
            defaultValue: null,
            comment: 'Clave en evaluacion.calculos del ensayo fuente',
        },
        isActive: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        visibleEnDosificacion: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'true = aparece en dropdown de dosificación por defecto',
        },
        visibleEnCards: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'false = no mostrar como card ni contar como faltante (derivados)',
        },
        normaId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: null,
            comment: 'FK a Norma (catálogo de normas)',
        },
        material: {
            type: DataTypes.STRING(30),
            allowNull: false,
            defaultValue: 'AGREGADOS',
            comment: 'Material al que pertenece (AGREGADOS, HORMIGON, etc.)',
        },
        visibleEnUI: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'Visible en la UI del catálogo de ensayos',
        },
        schemaKey: {
            type: DataTypes.STRING(50),
            allowNull: true,
            defaultValue: null,
            comment: 'Método técnico / estructura de resultado (e.g. GRANULOMETRIA_1505, LOS_ANGELES)',
        },
        perfil: {
            type: DataTypes.ENUM('CORE', 'AVANZADO'),
            allowNull: false,
            defaultValue: 'AVANZADO',
            comment: 'CORE = aparece por defecto; AVANZADO = solo si se activa el toggle',
        },
        visibleEnCaracterizacion: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'true = aparece en la ficha de caracterización del agregado',
        },
        caractFields: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
            comment: 'Array de { key, label, labelCorto, unidad } que definen qué campos del resultado se muestran en caracterización',
        },
        // ─── Campos TBS (Pliego DNV 2017) ───
        aplicaATBS: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'True si el ensayo aplica al contexto TBS (además de hormigón).',
        },
        limitesDNV: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Límites DNV paramétricos (operador, porClaseTransito T1-T4, porOrigenRoca, criterios).',
        },
        // ─── Multi-contexto (PR1) ───
        // La matriz por contexto (Hormigón/TBS) reemplaza progresivamente a los
        // flags globales `obligatorio` y `visibleEnCaracterizacion`. Estos
        // últimos siguen presentes durante un sprint de coexistencia.
        aplicaAHormigon: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: 'True si el ensayo aplica al contexto Hormigón.',
        },
        obligatorioHormigon: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Obligatoriedad del ensayo en contexto Hormigón.',
        },
        obligatorioTBS: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Obligatoriedad del ensayo en contexto TBS.',
        },
        nivelCaracterizacionHormigon: {
            type: DataTypes.ENUM('NINGUNA', 'BASICA', 'AVANZADA'),
            allowNull: false,
            defaultValue: 'NINGUNA',
            comment: 'Caract. Hormigón: NINGUNA=no aparece. BASICA=aparece y obligatorio fijo. AVANZADA=aparece, obligatorio configurable.',
        },
        nivelCaracterizacionTBS: {
            type: DataTypes.ENUM('NINGUNA', 'BASICA', 'AVANZADA'),
            allowNull: false,
            defaultValue: 'NINGUNA',
            comment: 'Caract. TBS: NINGUNA=no aparece. BASICA=aparece y obligatorio fijo. AVANZADA=aparece, obligatorio configurable.',
        },
    }, {
        tableName: 'AgregadoEnsayoTipo',
        comment: 'Catálogo de tipos de ensayo para agregados (IRAM, etc.)',
        hooks: {
            beforeValidate: aplicarCoherenciaMultiContexto,
        },
    });

    AgregadoEnsayoTipo.associate = (models) => {
        AgregadoEnsayoTipo.hasMany(models.AgregadoEnsayo, {
            foreignKey: 'idAgregadoEnsayoTipo',
            as: 'ensayos',
        });
        AgregadoEnsayoTipo.belongsTo(models.Norma, {
            foreignKey: 'normaId',
            as: 'norma',
        });
    };

    return AgregadoEnsayoTipo;
};

module.exports.aplicarCoherenciaMultiContexto = aplicarCoherenciaMultiContexto;
