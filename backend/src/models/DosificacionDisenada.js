'use strict';

const MODO_EFECTO_ENUM = [
  'AHORRO_AGUA', 'AUMENTO_ASENTAMIENTO',
  'RETARDANTE', 'ACELERANTE_FRAGUE', 'ACELERANTE_ENDURECIMIENTO',
  'INCORPORADOR_AIRE', 'ESPUMIGENO', 'ANTICONGELANTE', 'REDUCTOR_RETRACCION',
  'EXPANSIVO', 'INHIBIDOR_CORROSION', 'VISCOSANTE',
  'IMPERMEABILIZANTE', 'FIBRAS', 'OTRO',
];

module.exports = (sequelize, DataTypes) => {
  const DosificacionDisenada = sequelize.define('DosificacionDisenada', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nombre: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    descripcion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    idPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    estado: {
      type: DataTypes.ENUM(
        'BORRADOR', 'A_PRUEBA', 'PENDIENTE_REVISION',
        'EN_PRODUCCION', 'SUSPENDIDO', 'ARCHIVADO', 'DESCARTADO',
        // Legacy values kept for backward compatibility
        'APROBADO', 'VALIDADO', 'OBSOLETO'
      ),
      allowNull: false,
      defaultValue: 'BORRADOR',
    },
    version: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
    },
    /**
     * P0.5 — STALE flag. Se marca true cuando se aplican correcciones del
     * historial (PastonCorreccion) que cambian inputs del cálculo. Mientras
     * sea true, el resultadoJson y trazabilidadJson NO reflejan los inputs
     * actuales y el frontend debe avisar al usuario que recalcule.
     *
     * Se vuelve a false cuando se ejecuta calcularDosificacion + guardarDosificacion.
     */
    resultadoStale: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si es true, el resultadoJson está obsoleto: hay correcciones aplicadas no recalculadas.',
    },
    versionPadreId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'ID de la versión anterior de este diseño',
    },
    dosificacionBaseId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'ID raíz de la cadena de versiones (= id propio en v1)',
    },
    aprobadoPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fechaAprobacion: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    puestoEnProduccionPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fechaProduccion: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    motivoSuspension: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    motivoObsolescencia: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    reemplazadaPorId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'ID de la dosificación que reemplazó a esta',
    },
    // Hash integrity
    hashIntegridad: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'SHA-256 hash of technical content, set on approval',
    },
    hashDatosJson: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
      comment: 'Serialized JSON used to compute hashIntegridad',
    },
    hashSchemaVersion: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: 'Versión del schema del payload del hash. v1 = legado (incluye factorPrudencialCurva); v2 = limpio.',
    },
    metodoColocacion: {
      type: DataTypes.ENUM('CONVENCIONAL', 'BOMBEADO'),
      allowNull: false,
      defaultValue: 'CONVENCIONAL',
      comment: 'Método de colocación previsto. Usado por el motor para evaluar la excepción §4.1.3 del mínimo de pulverulento (CIRSOC 200:2024 Tabla 4.4).',
    },
    // Codigo identifiers
    codigo: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Human-readable code with version, e.g. DOS-KXGWL1.v2',
    },
    codigoBase: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Shared across versions, e.g. DOS-KXGWL1',
    },
    // Extended approval/review fields
    observacionesAprobacion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    enviadoRevisionPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fechaEnvioRevision: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    suspendidoPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fechaSuspension: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    archivadoPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fechaArchivo: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Reviewer assignment
    revisorAsignado: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Usuario asignado como revisor para PENDIENTE_REVISION',
    },
    fechaAsignacionRevisor: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Producción
    puestoEnProduccionPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fechaProduccion: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Descarte
    descartadoPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fechaDescarte: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    motivoDescarte: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Fase 3 — Override de pastón aprobado.
    // Permite a un firmante autorizado (Responsable, DT o Admin) habilitar la
    // transición a EN_PRODUCCION sin un pastón APROBADO declarando un motivo
    // ≥50 caracteres. Se incluye en buildDatosDosificacion para que el hash
    // de integridad cubra el override y cualquier escritura directa en DB
    // se detecte vía verificarIntegridad.
    overridePastonAprobado: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'True si la dosif pasó a EN_PRODUCCION sin pastón APROBADO mediante override firmado.',
    },
    overridePastonMotivo: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Justificación firmada del override; mínimo 50 caracteres. Solo poblado si overridePastonAprobado=true.',
    },
    overridePastonFirmadoPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Username del firmante del override (RESPONSABLE_CALIDAD, DIRECTOR_TECNICO o ADMIN).',
    },
    fechaOverridePaston: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp en el que se firmó el override.',
    },
    // Mezcla reference snapshot
    mezclaVersion: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Exact version of the mezcla at time of approval',
    },
    mezclaHash: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'Hash of the mezcla at time of dosificacion approval',
    },
    mezclaSnapshotJson: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Snapshot completo de la mezcla (proporciones, granulometría, TMN, MF, densidades) capturado al salir de BORRADOR. Inmutable una vez creado.',
    },
    idDosificacionCatalogo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'FK to legacy Dosificacion catalog entry used in dispatches',
    },
    metodo: {
      type: DataTypes.ENUM('ACI_211', 'HORMIQUAL'),
      allowNull: false,
      defaultValue: 'HORMIQUAL',
      comment: 'Motor de diseño utilizado. Legacy: ACI_211. Actual: HORMIQUAL (el método legacy ICPA se colapsó a HORMIQUAL en 20260601a).',
    },
    tipologiaCodigo: {
      type: DataTypes.STRING(30),
      allowNull: true,
      defaultValue: 'convencional',
      comment: 'Código de tipología de hormigón (convencional, bombeable, autocompactante, etc.)',
    },
    // Refactor 2026-05-20 — derivación de "clase comercial IRAM 1666" desde f'ce.
    // Permite agrupar dosificaciones por familia para estadísticas (control de
    // calidad por resistencia). Se calcula en `dosificacionDisenoService.guardar`
    // usando `domain/normRef/tipoHormigonIRAM1666.derivarTipoHormigon`.
    idTipoHormigon: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    tipoHormigonModoFce: {
      type: DataTypes.ENUM('ESPECIFICADO', 'OBJETIVO'),
      allowNull: true,
      comment: "Cómo interpretar f'ce para derivar la clase: ESPECIFICADO (pliego, clase inmediata superior) u OBJETIVO (media, clase más cercana). NULL para HRDC.",
    },
    idMezcla: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    idCemento: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    idAdicion1: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    pctReemplazoAdicion1: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
    },
    idAdicion2: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    pctReemplazoAdicion2: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
    },
    idAditivo1: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    dosisAditivo1: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: true,
    },
    modoEfectoAditivo1: {
      type: DataTypes.ENUM(...MODO_EFECTO_ENUM),
      allowNull: true,
    },
    idAditivo2: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    dosisAditivo2: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: true,
    },
    modoEfectoAditivo2: {
      type: DataTypes.ENUM(...MODO_EFECTO_ENUM),
      allowNull: true,
    },
    idAditivo3: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    dosisAditivo3: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: true,
    },
    modoEfectoAditivo3: {
      type: DataTypes.ENUM(...MODO_EFECTO_ENUM),
      allowNull: true,
    },
    // Lugar de incorporación del aditivo (planta vs obra).
    // El efecto AHORRO_AGUA sólo aplica a aditivos incorporados en PLANTA.
    etapaAditivo1: { type: DataTypes.ENUM('PLANTA', 'OBRA'), allowNull: false, defaultValue: 'PLANTA' },
    etapaAditivo2: { type: DataTypes.ENUM('PLANTA', 'OBRA'), allowNull: false, defaultValue: 'PLANTA' },
    etapaAditivo3: { type: DataTypes.ENUM('PLANTA', 'OBRA'), allowNull: false, defaultValue: 'PLANTA' },
    // Dosis de corrección (redosificación para corregir asentamiento en obra).
    // Si es true: NO se incluye en el cálculo volumétrico de la dosificación
    // porque su uso y dosis son variables. Las dosis de corrección son bajas
    // y no afectan significativamente la estabilidad volumétrica.
    esCorreccionAditivo1: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    esCorreccionAditivo2: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    esCorreccionAditivo3: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // ── Fibras (macrofibra estructural / microfibra polimérica) ──
    idMacrofibra: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'FK opcional al Material (catálogo) usado como macrofibra.',
    },
    nombreMacrofibra: {
      type: DataTypes.STRING(120),
      allowNull: true,
      comment: 'Nombre/marca de la macrofibra (texto libre si no está en catálogo).',
    },
    dosisMacrofibraKgM3: {
      type: DataTypes.DECIMAL(6, 3),
      allowNull: true,
      comment: 'Dosis de macrofibra estructural (kg/m³).',
    },
    idMicrofibra: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'FK opcional al Material (catálogo) usado como microfibra.',
    },
    nombreMicrofibra: {
      type: DataTypes.STRING(120),
      allowNull: true,
      comment: 'Nombre/marca de la microfibra (texto libre si no está en catálogo).',
    },
    dosisMicrofibraKgM3: {
      type: DataTypes.DECIMAL(6, 3),
      allowNull: true,
      comment: 'Dosis de microfibra polimérica (kg/m³).',
    },
    // Fase 2A — flujo post-prueba
    numeroRondaPrueba: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: 'Contador de rondas de prueba; se incrementa desde la UI al reenviar a prueba',
    },
    cementoKgM3Adoptado: {
      type: DataTypes.DECIMAL(6, 1),
      allowNull: true,
      comment: 'Cantidad de cemento adoptada tras la prueba (override de decisión técnica, paralelo al calculado)',
    },
    proporcionesAgregadosAdoptadasJson: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Proporciones de la mezcla granular adoptadas por dosificación (override local; no modifica la mezcla base)',
    },
    // Condiciones de exposición y uso (CIRSOC 200-2024 §3.2.3.3)
    expuestoDesgaste: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Hormigón expuesto a desgaste superficial (pavimentos, pisos, piletas)',
    },
    aspectoSuperficialImportante: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Aspecto superficial importante (hormigón a la vista, arquitectónico)',
    },
    tipoArmadura: {
      type: DataTypes.ENUM('simple', 'armado', 'pretensado'),
      allowNull: false,
      defaultValue: 'armado',
      comment: 'Tipo de hormigón por armadura — afecta límites de cloruros (art. 2.2.8)',
    },
    ambienteHumedo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // CIRSOC 200-2024 Tabla 9.3 — Hormigones con características particulares
    tipoHormigonParticular: {
      type: DataTypes.ENUM('BAJO_AGUA', 'IMPERMEABILIDAD', 'ABRASION'),
      allowNull: true,
      comment: 'Si la obra requiere requisitos particulares de Tabla 9.3.',
    },
    claseHormigonParticular: {
      type: DataTypes.ENUM('I', 'II', 'III', 'IV'),
      allowNull: true,
    },
    espesorElementoMm: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Espesor del elemento estructural (mm). Clave para tipos con sub-condición por espesor y para topes TMN/espesor.',
    },
    parametrosObjetivoJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    resultadoJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    trazabilidadJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    valoresAdoptados: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Valores adoptados tras verificación experimental (pastones de prueba)',
    },
    pastonReferenciaId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'ID del pastón cuyos datos se toman como valores verificados',
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedBy: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  }, {
    tableName: 'DosificacionDisenada',
    comment: 'Diseños de dosificación generados por el motor.',
  });

  DosificacionDisenada.associate = (models) => {
    DosificacionDisenada.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
    DosificacionDisenada.belongsTo(models.MezclaAgregados, { foreignKey: 'idMezcla', as: 'mezcla' });
    DosificacionDisenada.belongsTo(models.Cemento, { foreignKey: 'idCemento', as: 'cemento' });
    DosificacionDisenada.belongsTo(models.Material, { foreignKey: 'idAdicion1', as: 'adicion1' });
    DosificacionDisenada.belongsTo(models.Material, { foreignKey: 'idAdicion2', as: 'adicion2' });
    DosificacionDisenada.belongsTo(models.Aditivo, { foreignKey: 'idAditivo1', as: 'aditivo1' });
    DosificacionDisenada.belongsTo(models.Aditivo, { foreignKey: 'idAditivo2', as: 'aditivo2' });
    DosificacionDisenada.belongsTo(models.Aditivo, { foreignKey: 'idAditivo3', as: 'aditivo3' });
    // Link to legacy Dosificacion catalog (for production results)
    DosificacionDisenada.belongsTo(models.Dosificacion, { foreignKey: 'idDosificacionCatalogo', as: 'dosificacionCatalogo' });
    // Refactor 2026-05-20 — clase comercial IRAM 1666 derivada del f'ce.
    if (models.TipoHormigon) {
      DosificacionDisenada.belongsTo(models.TipoHormigon, { foreignKey: 'idTipoHormigon', as: 'tipoHormigon' });
    }
    // Versioning self-references
    DosificacionDisenada.belongsTo(models.DosificacionDisenada, { foreignKey: 'versionPadreId', as: 'versionPadre' });
    DosificacionDisenada.belongsTo(models.DosificacionDisenada, { foreignKey: 'reemplazadaPorId', as: 'reemplazadaPor' });
    // Historial
    DosificacionDisenada.hasMany(models.DosificacionDisenadaHistorial, { foreignKey: 'dosificacionDisenadaId', as: 'historial' });
    // Pastones de prueba
    DosificacionDisenada.hasMany(models.PastonPrueba, { foreignKey: 'idDosificacionDisenada', as: 'pastones' });
    DosificacionDisenada.belongsTo(models.PastonPrueba, { foreignKey: 'pastonReferenciaId', as: 'pastonReferencia' });
  };

  return DosificacionDisenada;
};
