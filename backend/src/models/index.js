const { Sequelize, DataTypes } = require('sequelize');
const MuestraHooks = require('./hooks/MuestraHooks');
const DosificacionHooks = require('./hooks/DosificacionHooks');
const EnsayoResistenciaHooks = require('./hooks/EnsayoResistenciaHooks');
const { registerInvalidationHooks } = require('../cache/invalidation');

// Caché para las conexiones
const dbCache = {};
// Mapa de promesas pendientes para evitar crear múltiples conexiones concurrentes al mismo tenant
const dbPending = {};

const createDbConnection = async (tenant) => {

  // Si está en caché, toma la conexión
  if (dbCache[tenant]) {
    return dbCache[tenant];
  }

  // Si ya hay una creación en curso para este tenant, esperar a que termine
  if (dbPending[tenant]) {
    return dbPending[tenant];
  }

  // Envolver en promesa para que llamadas concurrentes esperen el mismo resultado
  dbPending[tenant] = (async () => {
    try {

  // Configuración dinámica de la base de datos por user.
  // Busca env vars de forma case-insensitive (en Linux process.env es
  // case-sensitive; en Windows no, por lo que el .env puede estar en cualquier
  // case según el sistema en que se desarrolló).
  const findEnvCi = (prefix, t) => {
    const upper = process.env[`${prefix}${t.toUpperCase()}`];
    if (upper !== undefined) return upper;
    const lower = process.env[`${prefix}${t.toLowerCase()}`];
    if (lower !== undefined) return lower;
    // Búsqueda exhaustiva por si hay capitalizaciones mixtas.
    const target = `${prefix}${t}`.toLowerCase();
    for (const key of Object.keys(process.env)) {
      if (key.toLowerCase() === target) return process.env[key];
    }
    return undefined;
  };

  const dbConfig = {
    database: findEnvCi('DATABASE_', tenant),
    username: findEnvCi('DB_USERNAME_', tenant),
    password: findEnvCi('DB_PASSWORD_', tenant),
    host: findEnvCi('DB_HOST_', tenant) || 'localhost',
    dialect: 'mysql',
  };

  // Verificación de que el user esté en .env
  if (!dbConfig.database) {
    throw new Error(`Base de datos no configurada para este usuario. tenant=${JSON.stringify(tenant)}`);
  }

  // Instancia de Sequelize para el user determinado
  const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
    host: dbConfig.host,
    dialect: dbConfig.dialect,
    logging: false,
    pool: {
      min: 2,
      max: 10,
      idle: 10000,
      acquire: 30000,
      evict: 10000,
    },
    dialectOptions: {
      connectTimeout: 10000,
    },
  });

  // Creación de la db para manipularla con Sequelize
  const db = {};
  db.Sequelize = Sequelize;
  db.sequelize = sequelize;
  db.tenantName = tenant;

  // Le definimos todos los modelos
  db.Rol = require('./Rol')(sequelize, DataTypes);
  db.Prensa = require('./Prensa')(sequelize, DataTypes);
  db.EquipoLaboratorio = require('./EquipoLaboratorio')(sequelize, DataTypes);
  db.CalibracionEquipo = require('./CalibracionEquipo')(sequelize, DataTypes);
  db.EquipoPlanta = require('./EquipoPlanta')(sequelize, DataTypes);
  db.Laboratorio = require('./Laboratorio')(sequelize, DataTypes);
  db.LaboratorioPlanta = require('./LaboratorioPlanta')(sequelize, DataTypes);
  db.ConfigChangeLog = require('./ConfigChangeLog')(sequelize, DataTypes);
  db.TipoProbeta = require('./TipoProbeta')(sequelize, DataTypes);
  db.ModalidadMuestra = require('./ModalidadMuestra')(sequelize, DataTypes);
  db.TipoHormigon = require('./TipoHormigon')(sequelize, DataTypes);
  db.EdadDisenio = require('./EdadDisenio')(sequelize, DataTypes);
  db.AsentamientoDisenio = require('./AsentamientoDisenio')(sequelize, DataTypes);
  db.TipoDescarga = require('./TipoDescarga')(sequelize, DataTypes);
  db.TipoCemento = require('./TipoCemento')(sequelize, DataTypes);
  db.Aditivo = require('./Aditivo')(sequelize, DataTypes);
  db.Fibra = require('./Fibra')(sequelize, DataTypes);
  db.Entidad = require('./Entidad')(sequelize, DataTypes);
  db.Archivo = require('./Archivo')(sequelize, DataTypes);
  db.CategoriaArchivo = require('./CategoriaArchivo')(sequelize, DataTypes);
  db.ArchivoCategoria = require('./ArchivoCategoria')(sequelize, DataTypes);
  db.TamanioMaximoNominal = require('./TamanioMaximoNominal')(sequelize, DataTypes);
  db.Agregado = require('./Agregado')(sequelize, DataTypes);
  db.Empleado = require('./Empleado')(sequelize, DataTypes);
  db.EmpleadoRol = require('./EmpleadoRol')(sequelize, DataTypes);
  db.Email = require('./Email')(sequelize, DataTypes);
  db.Localidad = require('./Localidad')(sequelize, DataTypes);
  db.Domicilio = require('./Domicilio')(sequelize, DataTypes);
  db.Telefono = require('./Telefono')(sequelize, DataTypes);
  db.Contacto = require('./Contacto')(sequelize, DataTypes);
  db.Planta = require('./Planta')(sequelize, DataTypes);
  db.Obra = require('./Obra')(sequelize, DataTypes);
  db.Cliente = require('./Cliente')(sequelize, DataTypes);
  db.Cemento = require('./Cemento')(sequelize, DataTypes);
  db.Dosificacion = require('./Dosificacion')(sequelize, DataTypes);
  db.DosificacionCemento = require('./DosificacionCemento')(sequelize, DataTypes);
  db.DosificacionAditivos = require('./DosificacionAditivos')(sequelize, DataTypes);
  db.DespachoEstado = require('./DespachoEstado')(sequelize, DataTypes);
  db.DespachoEstadoHistory = require('./DespachoEstadoHistory')(sequelize, DataTypes);
  db.DosificacionAgregados = require('./DosificacionAgregados')(sequelize, DataTypes);
  db.DosificacionFibras = require('./DosificacionFibras')(sequelize, DataTypes);
  db.DespachoCementosExtra = require('./DespachoCementosExtra')(sequelize, DataTypes);
  db.DespachoAditivosExtra = require('./DespachoAditivosExtra')(sequelize, DataTypes);
  db.DespachoAgregadosExtra = require('./DespachoAgregadosExtra')(sequelize, DataTypes);
  db.DespachoFibrasExtra = require('./DespachoFibrasExtra')(sequelize, DataTypes);
  db.DespachoAguaExtra = require('./DespachoAguaExtra')(sequelize, DataTypes);
  db.DespachoRemitoItem = require('./DespachoRemitoItem')(sequelize, DataTypes);
  db.AgregadoFino = require('./AgregadoFino')(sequelize, DataTypes);
  db.AgregadoGrueso = require('./AgregadoGrueso')(sequelize, DataTypes);
  db.Muestra = require('./Muestra')(sequelize, DataTypes);
  db.EnsayoDetalle = require('./EnsayoDetalle')(sequelize, DataTypes);
  db.Probeta = require('./Probeta')(sequelize, DataTypes);
  db.EnsayoResistencia = require('./EnsayoResistencia')(sequelize, DataTypes);
  db.MuestraHistory = require('./MuestraHistory')(sequelize, DataTypes);
  db.DosificacionHistory = require('./DosificacionHistory')(sequelize, DataTypes);
  db.EnsayoResistenciaHistory = require('./EnsayoResistenciaHistory')(sequelize, DataTypes);
  db.ComposicionCemento = require('./ComposicionCemento')(sequelize, DataTypes);
  db.ResistenciaCemento = require('./ResistenciaCemento')(sequelize, DataTypes);
  db.PropiedadesCemento = require('./PropiedadesCemento')(sequelize, DataTypes);
  db.TipoCementoPropiedades = require('./TipoCementoPropiedades')(sequelize, DataTypes);
  db.EstadoProbeta = require('./EstadoProbeta')(sequelize, DataTypes);
  db.UnidadMedida = require('./UnidadMedida')(sequelize, DataTypes);
  db.UnidadMedidaPrensa = require('./UnidadMedidaPrensa')(sequelize, DataTypes);
  db.Despacho = require('./Despacho')(sequelize, DataTypes);
  db.User = require('./User')(sequelize, DataTypes);
  db.Config = require('./Config')(sequelize, DataTypes);
  db.UserPlanta = require('./UserPlanta')(sequelize, DataTypes);
  // Talleres + repuestos + auditoría (se registran ANTES de que se ejecute el associate
  // de MantenimientoHistory, así éste encuentra los modelos en `models`)
  db.Menu = require('./Menu')(sequelize, DataTypes);
  db.PermisoMenu = require('./PermisoMenu')(sequelize, DataTypes);
  db.MuestraTerceros = require('./MuestraTerceros')(sequelize, DataTypes);
  db.MuestraPaston = require('./MuestraPaston')(sequelize, DataTypes);

  // Catálogo canónico de tamices (espejo en DB de tamicesCatalog.js)
  db.Tamiz = require('./Tamiz')(sequelize, DataTypes);

  // Materiales TBS

  // Paramétricas DNV TBS (Pliego 2017)

  // Entidad ObraTBS (extensión técnica de Obra para el dominio TBS)

  // Dotación de Obra TBS (diseño técnico con versionado)

  // Tramo de Prueba (validación en campo de la Dotación)

  // Lote de obra TBS (unidad de control de calidad en ejecución)

  // Workflow genérico (ciclo de vida reutilizable para Dotación TBS, Dosificación, Lote, etc.)


  // Cubiertas (sesión 2026-05-11) — trazabilidad de neumáticos
  // Elementos de Obra (Fase ③) — catálogo + solicitudes desde el Portal de Obra
  db.ReporteResistencia = require('./ReporteResistencia')(sequelize, DataTypes);
  db.ReporteResistenciaProbeta = require('./ReporteResistenciaProbeta')(sequelize, DataTypes);

  // Compromisos recurrentes (gastos / cobros programados)

  // Obligaciones recurrentes (presentaciones / vencimientos normativos)

  // F931 — DJ mensual de cargas sociales (insumo del costeo real de personal)

  // Reglas de costo de personal — costos extra a liquidaciones/F931
  // (IERIC, Fondo Desempleo, Ropa de trabajo, etc.)

  // Calidad – Materiales
  db.MaterialTipo = require('./MaterialTipo')(sequelize, DataTypes);
  db.Material = require('./Material')(sequelize, DataTypes);
  db.MaterialPropiedad = require('./MaterialPropiedad')(sequelize, DataTypes);
  db.CalidadArchivo = require('./CalidadArchivo')(sequelize, DataTypes);
  db.MaterialDocumento = require('./MaterialDocumento')(sequelize, DataTypes);
  db.MaterialPrecio = require('./MaterialPrecio')(sequelize, DataTypes);
  db.ExtraccionDocumento = require('./ExtraccionDocumento')(sequelize, DataTypes);
  db.ExtraccionPlantilla = require('./ExtraccionPlantilla')(sequelize, DataTypes);

  // Calidad – Curvas granulométricas
  db.CurvaGranulometrica = require('./CurvaGranulometrica')(sequelize, DataTypes);
  db.CurvaPunto = require('./CurvaPunto')(sequelize, DataTypes);
  db.CurvaSet = require('./CurvaSet')(sequelize, DataTypes);

  // Calidad – Mezclas de Agregados
  db.MezclaAgregados = require('./MezclaAgregados')(sequelize, DataTypes);
  db.MezclaAgregadosItem = require('./MezclaAgregadosItem')(sequelize, DataTypes);

  // Calidad – Motor de dosificación (curvas + diseño)
  db.CurvaAguaAsentamiento = require('./CurvaAguaAsentamiento')(sequelize, DataTypes);
  db.CurvaACResistencia = require('./CurvaACResistencia')(sequelize, DataTypes);
  db.AireEsperado = require('./AireEsperado')(sequelize, DataTypes);
  db.DurabilidadExposicion = require('./DurabilidadExposicion')(sequelize, DataTypes);
  db.AireDurabilidad = require('./AireDurabilidad')(sequelize, DataTypes);
  db.PulverulentoMinimo = require('./PulverulentoMinimo')(sequelize, DataTypes);
  db.Consistencia = require('./Consistencia')(sequelize, DataTypes);
  db.HormigonParticular = require('./HormigonParticular')(sequelize, DataTypes);
  db.CorrectoresICPA = require('./CorrectoresICPA')(sequelize, DataTypes);
  db.AbacoCurvaICPA = require('./AbacoCurvaICPA')(sequelize, DataTypes);
  db.DosificacionDisenada = require('./DosificacionDisenada')(sequelize, DataTypes);
  db.DosificacionDisenadaHistorial = require('./DosificacionDisenadaHistorial')(sequelize, DataTypes);
  db.DisenoHistorial = require('./DisenoHistorial')(sequelize, DataTypes);
  db.TipologiaHormigon = require('./TipologiaHormigon')(sequelize, DataTypes);
  db.RecetaObra = require('./RecetaObra')(sequelize, DataTypes);
  db.PastonPrueba = require('./PastonPrueba')(sequelize, DataTypes);
  db.PastonCorreccion = require('./PastonCorreccion')(sequelize, DataTypes);
  db.RedosificacionObra = require('./RedosificacionObra')(sequelize, DataTypes);
  db.PrediccionComportamientoFresco = require('./PrediccionComportamientoFresco')(sequelize, DataTypes);
  db.MedicionPaston = require('./MedicionPaston')(sequelize, DataTypes);
  db.PlacaElastomero = require('./PlacaElastomero')(sequelize, DataTypes);
  db.PlacaElastomeroPrensa = require('./PlacaElastomeroPrensa')(sequelize, DataTypes);
  db.SecuenciaIdentificacionPlaca = require('./SecuenciaIdentificacionPlaca')(sequelize, DataTypes);
  db.ControlRecepcionPlaca = require('./ControlRecepcionPlaca')(sequelize, DataTypes);
  db.AlertaCalidad = require('./AlertaCalidad')(sequelize, DataTypes);

  // Calidad – Curvas de cemento (Abrams)
  db.CurvaCemento = require('./CurvaCemento')(sequelize, DataTypes);
  db.CurvaCementoPunto = require('./CurvaCementoPunto')(sequelize, DataTypes);
  db.CurvaCementoAbrams = require('./CurvaCementoAbrams')(sequelize, DataTypes);

  // Calidad – Disponibilidad y configuración de materiales por planta
  db.CementoPlanta = require('./CementoPlanta')(sequelize, DataTypes);
  db.MaterialPlanta = require('./MaterialPlanta')(sequelize, DataTypes);

  // Calidad – Catálogo de Normas
  db.NormaAplicaA = require('./NormaAplicaA')(sequelize, DataTypes);
  db.Norma = require('./Norma')(sequelize, DataTypes);
  db.NormaArchivo = require('./NormaArchivo')(sequelize, DataTypes);

  // Calidad – Ensayos de Agregados
  db.AgregadoEnsayoTipo = require('./AgregadoEnsayoTipo')(sequelize, DataTypes);
  db.AgregadoEnsayo = require('./AgregadoEnsayo')(sequelize, DataTypes);
  db.AgregadoEnsayoArchivo = require('./AgregadoEnsayoArchivo')(sequelize, DataTypes);
  db.AgregadoMeta = require('./AgregadoMeta')(sequelize, DataTypes);
  // PR5 — Snapshots persistidos del catálogo de tipos de ensayo
  db.CatalogoEnsayoSnapshot = require('./CatalogoEnsayoSnapshot')(sequelize, DataTypes);
  db.Agua = require('./Agua')(sequelize, DataTypes);
  // Calidad - Piletas (Laboratorio)
  db.Pileta = require('./Pileta')(sequelize, DataTypes);
  db.PiletaEstado = require('./PiletaEstado')(sequelize, DataTypes);
  db.PiletaRegistroTemperatura = require('./PiletaRegistroTemperatura')(sequelize, DataTypes);
  db.PiletaRegistroConsumo = require('./PiletaRegistroConsumo')(sequelize, DataTypes);
  db.PiletaComando = require('./PiletaComando')(sequelize, DataTypes);

  // Agent IA

  // Betonmatic

  // Validación de ubicación de vehículo antes de cargar

  // Bocas de carga por planta (loading points)

  // Stock propio de materiales (libro mayor por material real) — Fase 1

  // Planificación

  // CRM — seguimiento comercial de presupuestos
  // Categorización de clientes

  //LSD

  // Maquinaria

  // Compensaciones

  // Geolocker share links

  // Bloque K — repositorio de evidencias técnicas (CIRSOC §3.2.3.2 f)
  db.TechnicalEvidence = require('./TechnicalEvidence')(sequelize, DataTypes);
  db.OverrideRequest = require('./OverrideRequest')(sequelize, DataTypes);
  db.DocumentApprovalRequest = require('./DocumentApprovalRequest')(sequelize, DataTypes);

  await checkAndRemoveAllDuplicateIndexes(sequelize);
  await runPendingMigrations(sequelize);

  // Aplicamos hooks
  MuestraHooks(db.Muestra, db.MuestraHistory);
  DosificacionHooks(db.Dosificacion, db.DosificacionHistory);
  EnsayoResistenciaHooks(db.EnsayoResistencia, db.EnsayoResistenciaHistory);
  require('./hooks/PrensaHooks')(db.Prensa, db.EquipoLaboratorio, db.EquipoPlanta);

  // Asociaciones entre modelos
  Object.values(db).forEach(model => {
    if (model.associate) {
      model.associate(db);
    }
  });

  // Inyectar tenantId para que los servicios puedan acceder al cache
  db._tenantId = tenant;

  // Registrar hooks de invalidacion de cache
  registerInvalidationHooks(db, tenant);

  // Guardar la conexión en caché
  dbCache[tenant] = db;


  return db;

    } finally {
      delete dbPending[tenant];
    }
  })();

  return dbPending[tenant];
};


const dropIndexSafe = async (sequelize, table, indexName) => {
  try {
    await sequelize.query(
      `ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``
    );
  } catch (err) {
    // 1091 = índice/campo no existe → lo ignoramos
    if (err.original?.errno === 1091) {
      // ya no existe, sin problema
    } else {
      // otros errores los propagamos
      throw err;
    }
  }
};

const checkAndRemoveAllDuplicateIndexes = async (sequelize) => {
  try {
    const [tables] = await sequelize.query(`SHOW TABLES`);
    for (const row of tables) {
      const tableName = Object.values(row)[0];
      const [indexes] = await sequelize.query(`SHOW INDEX FROM \`${tableName}\``);
      // Agrupamos solo índices UNIQUE por columna
      const groups = indexes.reduce((acc, idx) => {
        if (idx.Non_unique === 0) {
          (acc[idx.Column_name] ||= []).push(idx);
        }
        return acc;
      }, {});
      // Para cada columna con más de un UNIQUE, eliminamos duplicados
      for (const [col, list] of Object.entries(groups)) {
        if (list.length > 1) {
          for (let i = 1; i < list.length; i++) {
            await dropIndexSafe(sequelize, tableName, list[i].Key_name);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error al verificar/eliminar índices duplicados:", err);
  }
};


/**
 * Safely add a column if it doesn't exist.
 * MySQL doesn't support IF NOT EXISTS for ADD COLUMN,
 * so we catch error 1060 (duplicate column).
 */
const addColumnSafe = async (sequelize, table, column, definition) => {
  try {
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  } catch (err) {
    if (err.original?.errno === 1060) return; // column already exists
    throw err;
  }
};

/**
 * Ensure new columns exist in MezclaAgregados, DosificacionDisenada, and DisenoHistorial tables.
 * Safe to run multiple times — skips existing columns.
 */
const runPendingMigrations = async (sequelize) => {
  try {
    // [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
    // Bloque original creaba tablas de sesión del bot WhatsApp (whatsappSessionStore).
    // try {
    //   const wppStore = require('../services/whatsappSessionStore');
    //   await sequelize.query(wppStore.ENSURE_TABLE_SQL);
    //   await sequelize.query(wppStore.ENSURE_PROCESSED_SQL);
    // } catch (e) { console.warn('[migrations] WhatsappSession:', e.message); }

    // ── MezclaAgregados: estado & versioning columns ──
    await addColumnSafe(sequelize, 'MezclaAgregados', 'estado',
      "ENUM('BORRADOR','A_PRUEBA','PENDIENTE_REVISION','APROBADO','SUSPENDIDO','ARCHIVADO') NOT NULL DEFAULT 'BORRADOR'");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'version', "INT UNSIGNED NOT NULL DEFAULT 1");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'versionPadreId', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'mezclaBaseId', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'codigo', "VARCHAR(50) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'codigoBase', "VARCHAR(50) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'hashIntegridad', "VARCHAR(64) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'hashDatosJson', "LONGTEXT NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'aprobadoPor', "VARCHAR(255) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'fechaAprobacion', "DATETIME NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'observacionesAprobacion', "TEXT NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'enviadoRevisionPor', "VARCHAR(255) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'fechaEnvioRevision', "DATETIME NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'motivoSuspension', "TEXT NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'suspendidoPor', "VARCHAR(255) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'fechaSuspension', "DATETIME NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'archivadoPor', "VARCHAR(255) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'fechaArchivo', "DATETIME NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'reemplazadaPorId', "INT UNSIGNED NULL");

    // ── MezclaAgregados: post-optimization adjustment metadata ──
    await addColumnSafe(sequelize, 'MezclaAgregados', 'tipoOptimizacion', "VARCHAR(30) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'proporcionesOptimasJson', "JSON NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'rangosFactiblesJson', "JSON NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'metricasOptimoJson', "JSON NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'metricasAdoptadoJson', "JSON NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'calidadAjuste', "VARCHAR(15) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'motivoAjuste', "TEXT NULL");

    // ── DosificacionDisenada: Fibras (macro/micro) ──
    await addColumnSafe(sequelize, 'Fibra', 'tipo',
      "ENUM('MACRO','MICRO','OTRO') NOT NULL DEFAULT 'OTRO'");
    await addColumnSafe(sequelize, 'Fibra', 'densidad', "DECIMAL(6,1) NULL");
    await addColumnSafe(sequelize, 'Fibra', 'dosisMinima', "DECIMAL(6,3) NULL");
    await addColumnSafe(sequelize, 'Fibra', 'dosisMaxima', "DECIMAL(6,3) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'idMacrofibra', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'nombreMacrofibra', "VARCHAR(120) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'dosisMacrofibraKgM3', "DECIMAL(6,3) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'idMicrofibra', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'nombreMicrofibra', "VARCHAR(120) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'dosisMicrofibraKgM3', "DECIMAL(6,3) NULL");

    // ── DosificacionDisenada: Tabla 9.3 CIRSOC (hormigones particulares) ──
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'tipoHormigonParticular',
      "ENUM('BAJO_AGUA','IMPERMEABILIDAD','ABRASION') NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'claseHormigonParticular',
      "ENUM('I','II','III','IV') NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'espesorElementoMm', "INT UNSIGNED NULL");

    // ── DosificacionDisenada: Fase 2A (post-prueba) ──
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'numeroRondaPrueba', "INT UNSIGNED NOT NULL DEFAULT 1");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'cementoKgM3Adoptado', "DECIMAL(6,1) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'proporcionesAgregadosAdoptadasJson', "JSON NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'valoresAdoptados', "JSON NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'pastonReferenciaId', "INT UNSIGNED NULL");

    // ── DosificacionDisenada: 3er aditivo (persistencia) ──
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'idAditivo3', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'dosisAditivo3', "DECIMAL(6,2) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'modoEfectoAditivo3',
      "ENUM('AHORRO_AGUA','AUMENTO_ASENTAMIENTO','RETARDANTE','ACELERANTE_FRAGUE','ACELERANTE_ENDURECIMIENTO','INCORPORADOR_AIRE','ANTICONGELANTE','REDUCTOR_RETRACCION','EXPANSIVO','INHIBIDOR_CORROSION','VISCOSANTE','IMPERMEABILIZANTE','FIBRAS','OTRO') NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'etapaAditivo1',
      "ENUM('PLANTA','OBRA') NOT NULL DEFAULT 'PLANTA'");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'etapaAditivo2',
      "ENUM('PLANTA','OBRA') NOT NULL DEFAULT 'PLANTA'");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'etapaAditivo3',
      "ENUM('PLANTA','OBRA') NOT NULL DEFAULT 'PLANTA'");
    // Flags: el aditivo es dosis de corrección (redosificación opcional)
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'esCorreccionAditivo1',
      "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'esCorreccionAditivo2',
      "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'esCorreccionAditivo3',
      "TINYINT(1) NOT NULL DEFAULT 0");

    // ── RedosificacionObra: columna etapa (Fase 2B) ──
    await addColumnSafe(sequelize, 'RedosificacionObra', 'etapa',
      "ENUM('PLANTA','TRANSPORTE','OBRA') NOT NULL DEFAULT 'OBRA'");

    // ── RedosificacionObra: ampliación a modelo unificado de acciones ──
    await addColumnSafe(sequelize, 'RedosificacionObra', 'tipoAccion',
      "ENUM('ADITIVO','AGUA','FIBRA','AIRE','OTRO') NOT NULL DEFAULT 'ADITIVO'");
    await addColumnSafe(sequelize, 'RedosificacionObra', 'idFibra', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'RedosificacionObra', 'nombreMaterial', "VARCHAR(200) NULL");
    await addColumnSafe(sequelize, 'RedosificacionObra', 'cantidad', "DECIMAL(10,3) NULL");
    await addColumnSafe(sequelize, 'RedosificacionObra', 'unidad', "VARCHAR(20) NULL DEFAULT 'L'");
    await addColumnSafe(sequelize, 'RedosificacionObra', 'medicionAntesId', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'RedosificacionObra', 'medicionDespuesId', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'RedosificacionObra', 'aireMedidoAntes', "DECIMAL(4,2) NULL");
    await addColumnSafe(sequelize, 'RedosificacionObra', 'aireMedidoDespues', "DECIMAL(4,2) NULL");
    // Hacer idAditivo nullable (antes era NOT NULL, ahora AGUA/FIBRA/OTRO no lo necesitan)
    try { await sequelize.query("ALTER TABLE `RedosificacionObra` MODIFY `idAditivo` INT UNSIGNED NULL"); } catch {}
    // Hacer motivo y modoEfecto nullable para registros legacy
    try { await sequelize.query("ALTER TABLE `RedosificacionObra` MODIFY `modoEfecto` ENUM('AHORRO_AGUA','AUMENTO_ASENTAMIENTO','RETARDANTE','ACELERANTE_FRAGUE','ACELERANTE_ENDURECIMIENTO','INCORPORADOR_AIRE','ANTICONGELANTE','REDUCTOR_RETRACCION','EXPANSIVO','INHIBIDOR_CORROSION','VISCOSANTE','IMPERMEABILIZANTE','FIBRAS','OTRO') NULL DEFAULT 'AUMENTO_ASENTAMIENTO'"); } catch {}

    // ── MedicionPaston (Fase 2B): crear tabla si no existe ──
    try {
      await sequelize.query(`CREATE TABLE IF NOT EXISTS \`MedicionPaston\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`idPastonPrueba\` INT UNSIGNED NOT NULL,
        \`ordenSecuencia\` INT UNSIGNED NOT NULL DEFAULT 1,
        \`etiqueta\` VARCHAR(80) NULL,
        \`etapa\` ENUM('PLANTA','TRANSPORTE','OBRA') NOT NULL DEFAULT 'PLANTA',
        \`fechaHora\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`asentamientoMm\` DECIMAL(5,1) NULL,
        \`temperaturaHormigonC\` DECIMAL(4,1) NULL,
        \`temperaturaAmbienteC\` DECIMAL(4,1) NULL,
        \`aireMedidoPct\` DECIMAL(4,2) NULL,
        \`probetasMoldeadas\` SMALLINT UNSIGNED NULL,
        \`observacion\` TEXT NULL,
        \`usuario\` VARCHAR(255) NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_medicion_paston_orden\` (\`idPastonPrueba\`, \`ordenSecuencia\`)
      )`);
    } catch (e) { console.warn('[migrations] MedicionPaston:', e.message); }
    await addColumnSafe(sequelize, 'MedicionPaston', 'aspecto', "VARCHAR(50) NULL");
    // Agregados/retenidos por medición
    await addColumnSafe(sequelize, 'MedicionPaston', 'aguaAgregadaLts', "DECIMAL(8,2) NULL");
    await addColumnSafe(sequelize, 'MedicionPaston', 'aditivoAgregadoNombre', "VARCHAR(120) NULL");
    await addColumnSafe(sequelize, 'MedicionPaston', 'aditivoAgregadoCantidad', "DECIMAL(10,3) NULL");
    await addColumnSafe(sequelize, 'MedicionPaston', 'aditivoAgregadoUnidad', "VARCHAR(10) NULL");
    await addColumnSafe(sequelize, 'MedicionPaston', 'aditivosAgregadosJson', "JSON NULL");
    await addColumnSafe(sequelize, 'PastonPrueba', 'numeroRondaPrueba', "INT UNSIGNED NOT NULL DEFAULT 1");
    await addColumnSafe(sequelize, 'MedicionPaston', 'volumenRemanenteM3', "DECIMAL(6,3) NULL");
    await addColumnSafe(sequelize, 'MedicionPaston', 'aguaRetenidaLts', "DECIMAL(8,2) NULL");
    await addColumnSafe(sequelize, 'MedicionPaston', 'aditivoRetenidoNombre', "VARCHAR(120) NULL");
    await addColumnSafe(sequelize, 'MedicionPaston', 'aditivoRetenidoCantidad', "DECIMAL(10,3) NULL");
    await addColumnSafe(sequelize, 'MedicionPaston', 'aditivoRetenidoUnidad', "VARCHAR(10) NULL");
    // 2026-05-18 — tipo de probeta persistido (catálogo TipoProbeta). Permite
    // corregir el tipo de las probetas moldeadas al editar un pastón guardado.
    await addColumnSafe(sequelize, 'Probeta', 'idTipoProbeta', "INT UNSIGNED NULL");

    // ── HormigonParticular (CIRSOC 200-2024 Tabla 9.3) ──
    try {
      await sequelize.query(`CREATE TABLE IF NOT EXISTS \`HormigonParticular\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`tipoHormigon\` ENUM('BAJO_AGUA','IMPERMEABILIDAD','ABRASION') NOT NULL,
        \`clase\` ENUM('I','II','III','IV') NOT NULL,
        \`casoTipico\` TEXT NULL,
        \`espesorMmMin\` INT UNSIGNED NULL,
        \`espesorMmMax\` INT UNSIGNED NULL,
        \`acMax\` DECIMAL(4,3) NOT NULL,
        \`claseMinima\` VARCHAR(10) NOT NULL,
        \`aireIncorporado\` ENUM('OPCIONAL','NO','REQUERIDO') NOT NULL DEFAULT 'OPCIONAL',
        \`consistenciaPermitida\` JSON NULL,
        \`penetracionAguaMaxMm\` DECIMAL(5,1) NULL,
        \`tmnMaxMm\` DECIMAL(5,1) NULL,
        \`tmnMaxFraccionEspesor\` DECIMAL(4,3) NULL,
        \`desgasteLAMaxPct\` DECIMAL(4,1) NULL,
        \`notas\` TEXT NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_hp_tipo_clase\` (\`tipoHormigon\`, \`clase\`)
      )`);
    } catch (e) { console.warn('[migrations] HormigonParticular:', e.message); }

    // Seed idempotente: 4 filas (I bajo agua, II-a/II-b impermeabilidad, III/IV abrasión).
    try {
      const [[{ cnt }]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM `HormigonParticular`");
      if (Number(cnt) === 0) {
        await sequelize.query(`INSERT INTO \`HormigonParticular\`
          (tipoHormigon, clase, casoTipico, espesorMmMin, espesorMmMax, acMax, claseMinima, aireIncorporado, consistenciaPermitida, penetracionAguaMaxMm, tmnMaxMm, tmnMaxFraccionEspesor, desgasteLAMaxPct, notas, createdAt, updatedAt)
          VALUES
          ('BAJO_AGUA','I','Pilotes de gran diámetro.', NULL, NULL, 0.450, 'H-30', 'OPCIONAL', JSON_ARRAY('FLUIDA','MUY_FLUIDA'), NULL, 25.0, NULL, NULL, 'TMN ≤ 25 mm.', NOW(), NOW()),
          ('IMPERMEABILIDAD','II','Cisternas. Depósitos para agua. Conductos. Tuberías.', NULL, 500, 0.450, 'H-30', 'OPCIONAL', JSON_ARRAY('PLASTICA','MUY_PLASTICA'), 30.0, NULL, NULL, NULL, 'Espesor ≤ 500 mm.', NOW(), NOW()),
          ('IMPERMEABILIDAD','II','Cisternas. Depósitos para agua. Conductos. Tuberías.', 501, NULL, 0.550, 'H-20', 'OPCIONAL', JSON_ARRAY('PLASTICA','MUY_PLASTICA'), 30.0, NULL, NULL, NULL, 'Espesor > 500 mm.', NOW(), NOW()),
          ('ABRASION','III','Resbalamiento de materiales a granel. Movimiento de objetos pesados.', NULL, NULL, 0.420, 'H-40', 'NO', JSON_ARRAY('PLASTICA','SECA'), NULL, 26.5, 0.333, 30.0, 'TMN ≤ 26,5 mm y ≤ 1/3 del espesor. Los Ángeles ≤ 30%.', NOW(), NOW()),
          ('ABRASION','IV','Escurrimiento de agua con velocidad ≥ 12 m/s y arrastre o suspensión de partículas sólidas abrasivas.', NULL, NULL, 0.450, 'H-30', 'NO', JSON_ARRAY('PLASTICA','MUY_PLASTICA'), NULL, 26.5, 0.333, 30.0, 'TMN ≤ 26,5 mm y ≤ 1/3 del espesor. Los Ángeles ≤ 30%.', NOW(), NOW())
        `);
      }
    } catch (e) { console.warn('[migrations] HormigonParticular seed:', e.message); }

    // ── DosificacionDisenada: new columns from sprint ──
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'hashIntegridad', "VARCHAR(64) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'hashDatosJson', "LONGTEXT NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'codigo', "VARCHAR(50) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'codigoBase', "VARCHAR(50) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'observacionesAprobacion', "TEXT NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'enviadoRevisionPor', "VARCHAR(255) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'fechaEnvioRevision', "DATETIME NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'suspendidoPor', "VARCHAR(255) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'fechaSuspension', "DATETIME NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'archivadoPor', "VARCHAR(255) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'fechaArchivo', "DATETIME NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'mezclaVersion', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'mezclaHash', "VARCHAR(64) NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'mezclaSnapshotJson', "JSON NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'resultadoStale', "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'idDosificacionCatalogo', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'dosificacionBaseId', "INT UNSIGNED NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'versionPadreId', "INT UNSIGNED NULL");

    // ── Condiciones de exposición y uso (CIRSOC 200-2024 §3.2.3.3) ──
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'expuestoDesgaste', "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'aspectoSuperficialImportante', "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'tipoArmadura', "ENUM('simple','armado','pretensado') NOT NULL DEFAULT 'armado'");

    // ── DisenoHistorial: create table if not exists ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`DisenoHistorial\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`entidadTipo\` ENUM('mezcla','dosificacion') NOT NULL,
        \`entidadId\` INT UNSIGNED NOT NULL,
        \`estadoAnterior\` VARCHAR(25) NULL,
        \`estadoNuevo\` VARCHAR(25) NOT NULL,
        \`usuario\` VARCHAR(255) NOT NULL,
        \`motivo\` TEXT NULL,
        \`observaciones\` TEXT NULL,
        \`hashAlMomento\` VARCHAR(64) NULL,
        \`metadata\` JSON NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_entidad\` (\`entidadTipo\`, \`entidadId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── RecetaObra: create table if not exists ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`RecetaObra\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`dosificacionDisenadaId\` INT UNSIGNED NOT NULL,
        \`volumenBachada\` DECIMAL(6,2) NOT NULL,
        \`humedadesJson\` JSON NOT NULL,
        \`aguaTeorica\` DECIMAL(8,2) NOT NULL,
        \`aguaCorregida\` DECIMAL(8,2) NOT NULL,
        \`correccionTotal\` DECIMAL(8,2) NOT NULL,
        \`cantidadesM3Json\` JSON NOT NULL,
        \`cantidadesBachadaJson\` JSON NOT NULL,
        \`fechaMedicion\` DATE NOT NULL,
        \`medidoPor\` VARCHAR(255) NULL,
        \`observaciones\` TEXT NULL,
        \`creadoPor\` VARCHAR(255) NOT NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_receta_dosif\` (\`dosificacionDisenadaId\`, \`fechaMedicion\` DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── Expand DosificacionDisenada.estado ENUM if needed (add new values) ──
    // MySQL allows ALTER COLUMN MODIFY to expand ENUMs safely
    try {
      await sequelize.query(`
        ALTER TABLE \`DosificacionDisenada\` MODIFY COLUMN \`estado\`
        ENUM('BORRADOR','A_PRUEBA','PENDIENTE_REVISION','APROBADO','SUSPENDIDO','ARCHIVADO','VALIDADO','EN_PRODUCCION','OBSOLETO')
        NOT NULL DEFAULT 'BORRADOR'
      `);
    } catch { /* ignore if already correct */ }

    // ── DisenoHistorial: add tipoEvento column & make estadoNuevo nullable ──
    await addColumnSafe(sequelize, 'DisenoHistorial', 'tipoEvento', "VARCHAR(30) NOT NULL DEFAULT 'cambio_estado'");
    try {
      await sequelize.query("ALTER TABLE `DisenoHistorial` MODIFY COLUMN `estadoNuevo` VARCHAR(25) NULL");
    } catch { /* ignore if already nullable */ }

    // ── Soft-delete columns for DosificacionDisenada & MezclaAgregados ──
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'deletedAt', "DATETIME NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'deletedBy', "VARCHAR(255) NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'deletedAt', "DATETIME NULL");
    await addColumnSafe(sequelize, 'MezclaAgregados', 'deletedBy', "VARCHAR(255) NULL");

    // ── TipologiaHormigon table + tipologiaCodigo on DosificacionDisenada ──
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`TipologiaHormigon\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          \`codigo\` VARCHAR(30) NOT NULL UNIQUE,
          \`nombre\` VARCHAR(100) NOT NULL,
          \`descripcion\` TEXT NULL,
          \`activa\` TINYINT(1) NOT NULL DEFAULT 1,
          \`curvaFamilia\` VARCHAR(20) NOT NULL DEFAULT 'FULLER_TALBOT',
          \`curvaExponente\` DECIMAL(4,3) NOT NULL DEFAULT 0.500,
          \`restriccionesGranulometricas\` JSON NULL,
          \`restriccionesDosificacion\` JSON NULL,
          \`esPredefinida\` TINYINT(1) NOT NULL DEFAULT 0,
          \`orden\` INT NOT NULL DEFAULT 0,
          \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } catch (e) { /* already exists */ }

    // Seed predefined tipologías if table is empty
    try {
      const [rows] = await sequelize.query("SELECT COUNT(*) AS cnt FROM `TipologiaHormigon`");
      if (rows[0].cnt === 0) {
        await sequelize.query(`
          INSERT INTO \`TipologiaHormigon\` (\`codigo\`, \`nombre\`, \`descripcion\`, \`curvaFamilia\`, \`curvaExponente\`, \`restriccionesGranulometricas\`, \`restriccionesDosificacion\`, \`esPredefinida\`, \`orden\`) VALUES
          ('convencional', 'Convencional / Estructural', 'Hormigón vibrado estándar para estructuras de edificación y obras civiles generales.', 'FULLER_TALBOT', 0.500, '{}', '{"asentamiento_recomendado_min":8,"asentamiento_recomendado_max":15}', 1, 0),
          ('bombeable', 'Bombeable', 'Hormigón diseñado para ser trasladado por tubería a presión. Mayor contenido de finos.', 'FULLER_TALBOT', 0.450, '{"pasa_0_15_min":10,"pasa_0_30_min":15,"tmn_max":25,"mf_max":4.5,"relacion_finos_min":40}', '{"asentamiento_min":12,"asentamiento_max":22,"asentamiento_recomendado_min":15,"asentamiento_recomendado_max":20,"vol_pasta_min":300,"aditivos_recomendados":["superplastificante"]}', 1, 1),
          ('autocompactante', 'Autocompactante (HAC)', 'Hormigón que fluye y se compacta por su propio peso sin vibración. Requiere superplastificante.', 'ANDREASEN_MOD', 0.280, '{"tmn_max":19,"vol_gruesos_max":350,"polvo_min_kg":450,"relacion_finos_min":50,"mf_max":4.0}', '{"tipo_trabajabilidad":"escurrimiento","asentamiento_min":55,"asentamiento_max":80,"asentamiento_recomendado_min":60,"asentamiento_recomendado_max":75,"vol_pasta_min":340,"aditivos_requeridos":["superplastificante"],"aditivos_recomendados":["viscosante"]}', 1, 2),
          ('masivo', 'Masivo (bajo calor)', 'Hormigón para elementos de gran volumen. TMN grande, pocos finos, bajo calor de hidratación.', 'FULLER_TALBOT', 0.550, '{"tmn_min":37.5,"mf_min":5.0,"relacion_finos_max":40}', '{"asentamiento_recomendado_min":4,"asentamiento_recomendado_max":10,"cemento_max_kg":300,"aditivos_recomendados":["retardante"]}', 1, 3),
          ('pavimento_rigido', 'Pavimento rígido', 'Hormigón para pavimentos de carreteras, pisos industriales. Baja trabajabilidad, alta resistencia a flexión.', 'FULLER_TALBOT', 0.500, '{}', '{"asentamiento_recomendado_min":2,"asentamiento_recomendado_max":6}', 1, 4),
          ('proyectado', 'Hormigón proyectado (shotcrete)', 'Hormigón aplicado por proyección neumática. TMN pequeño, alta cohesión.', 'FULLER_TALBOT', 0.400, '{"tmn_max":12.5,"pasa_0_30_min":20,"mf_max":4.0}', '{"asentamiento_recomendado_min":4,"asentamiento_recomendado_max":8,"aditivos_requeridos":["acelerante"]}', 1, 5),
          ('alta_resistencia', 'Alta resistencia (> 50 MPa)', 'Hormigones con f''ck > 50 MPa. Baja a/c, alto contenido de cementíceos.', 'FULLER_TALBOT', 0.450, '{"tmn_max":19}', '{"asentamiento_recomendado_min":12,"asentamiento_recomendado_max":20,"aditivos_requeridos":["superplastificante"]}', 1, 6),
          ('arquitectonico', 'Arquitectónico / Visto', 'Hormigón donde la superficie es la terminación final. Requiere uniformidad y buen acabado.', 'FULLER_TALBOT', 0.420, '{"tmn_max":19,"relacion_finos_min":45}', '{"asentamiento_recomendado_min":12,"asentamiento_recomendado_max":18}', 1, 7),
          ('rcc', 'Compactado con rodillo (RCC)', 'Hormigón seco compactado con rodillo. TMN grande, sin asentamiento.', 'FULLER_TALBOT', 0.550, '{"tmn_min":37.5}', '{"asentamiento_recomendado_min":0,"asentamiento_recomendado_max":2}', 1, 8),
          ('personalizado', 'Personalizado', 'Tipología con parámetros completamente configurables por el usuario.', 'FULLER_TALBOT', 0.500, '{}', '{}', 1, 99)
        `);
      }
    } catch (e) { console.warn('[migrations] tipologia seed:', e.message); }

    await addColumnSafe(sequelize, 'DosificacionDisenada', 'tipologiaCodigo', "VARCHAR(30) NULL");

    // ── IDA (Índice de Demanda de Agua) en Agregado ──
    await addColumnSafe(sequelize, 'Agregado', 'ida', "DECIMAL(4,3) DEFAULT 1.000");
    await addColumnSafe(sequelize, 'Agregado', 'idaModo', "ENUM('auto','manual') NOT NULL DEFAULT 'auto'");
    await addColumnSafe(sequelize, 'Agregado', 'idaSugerido', "DECIMAL(4,3) NULL");
    await addColumnSafe(sequelize, 'Agregado', 'idaNotas', "TEXT NULL");

    // ── Motor HormiQual: metodo ENUM ──
    // El valor legacy 'ICPA' se colapsa a 'HORMIQUAL' (ver migración 20260601a).
    // Se hace el UPDATE antes del MODIFY para que el ALTER no falle si quedan filas 'ICPA'.
    try {
      await sequelize.query(`UPDATE \`DosificacionDisenada\` SET \`metodo\` = 'HORMIQUAL' WHERE \`metodo\` = 'ICPA'`);
      await sequelize.query(`
        ALTER TABLE \`DosificacionDisenada\`
        MODIFY COLUMN \`metodo\` ENUM('ACI_211','HORMIQUAL') NOT NULL DEFAULT 'HORMIQUAL'
      `);
    } catch (e) {
      // Safe to ignore if already modified or column structure matches
      if (e.original?.errno !== 1060 && e.original?.errno !== 1146) console.warn('[migrations] metodo ENUM:', e.message);
    }

    // ── FactorEdadCemento: age-dependent resistance factors by cement type ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`FactorEdadCemento\` (
        \`idFactorEdadCemento\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`cementoTipo\` VARCHAR(30) NOT NULL,
        \`edadDias\` SMALLINT UNSIGNED NOT NULL,
        \`factor\` DECIMAL(5,3) NOT NULL,
        \`fuente\` VARCHAR(255) NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`idFactorEdadCemento\`),
        UNIQUE KEY \`uq_cemento_edad\` (\`cementoTipo\`, \`edadDias\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Factores de edad β(t) por tipo de cemento.'
    `);

    // Seed age factors only if table is empty
    const [factorRows] = await sequelize.query('SELECT COUNT(*) AS cnt FROM `FactorEdadCemento`');
    if (factorRows[0].cnt === 0) {
      const seed = [
        // CPN (Portland normal)
        ['CPN',1,0.200],['CPN',3,0.400],['CPN',7,0.650],['CPN',14,0.850],['CPN',28,1.000],['CPN',56,1.080],['CPN',90,1.120],['CPN',180,1.150],['CPN',365,1.180],
        // CPN_ARS (alta resistencia al sulfato)
        ['CPN_ARS',1,0.250],['CPN_ARS',3,0.500],['CPN_ARS',7,0.720],['CPN_ARS',14,0.880],['CPN_ARS',28,1.000],['CPN_ARS',56,1.050],['CPN_ARS',90,1.080],['CPN_ARS',180,1.100],['CPN_ARS',365,1.120],
        // CPP (puzolánico)
        ['CPP',1,0.150],['CPP',3,0.300],['CPP',7,0.500],['CPP',14,0.700],['CPP',28,1.000],['CPP',56,1.150],['CPP',90,1.250],['CPP',180,1.350],['CPP',365,1.420],
        // CPE (escoria)
        ['CPE',1,0.120],['CPE',3,0.250],['CPE',7,0.450],['CPE',14,0.650],['CPE',28,1.000],['CPE',56,1.200],['CPE',90,1.350],['CPE',180,1.450],['CPE',365,1.550],
        // CPF (filler)
        ['CPF',1,0.180],['CPF',3,0.350],['CPF',7,0.580],['CPF',14,0.780],['CPF',28,1.000],['CPF',56,1.100],['CPF',90,1.150],['CPF',180,1.200],['CPF',365,1.220],
      ];
      const vals = seed.map(([t,e,f]) => `('${t}',${e},${f},'Bibliográfico')`).join(',');
      await sequelize.query(`INSERT INTO \`FactorEdadCemento\` (\`cementoTipo\`,\`edadDias\`,\`factor\`,\`fuente\`) VALUES ${vals}`);
    }

    // ── Valores adoptados y pastón de referencia ──
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'valoresAdoptados', "JSON NULL");
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'pastonReferenciaId', "INT UNSIGNED NULL");

    // ── PastonPrueba: trial batch records ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`PastonPrueba\` (
        \`idPastonPrueba\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`idDosificacionDisenada\` INT UNSIGNED NOT NULL,
        \`volumenM3\` DECIMAL(6,4) NOT NULL,
        \`factorExcedente\` DECIMAL(4,2) NOT NULL DEFAULT 1.10,
        \`volumenEfectivoM3\` DECIMAL(6,4) NOT NULL,
        \`correccionHumedad\` TINYINT(1) NOT NULL DEFAULT 0,
        \`componentes\` JSON NOT NULL,
        \`fecha\` DATE NULL,
        \`hora\` TIME NULL,
        \`operador\` VARCHAR(255) NULL,
        \`asentamientoMedido\` DECIMAL(5,1) NULL,
        \`temperaturaHormigon\` DECIMAL(4,1) NULL,
        \`temperaturaAmbiente\` DECIMAL(4,1) NULL,
        \`puvMedido\` DECIMAL(8,2) NULL,
        \`aireMedido\` DECIMAL(4,2) NULL,
        \`aspecto\` VARCHAR(50) NULL,
        \`probetasMoldeadas\` SMALLINT UNSIGNED NULL,
        \`tipoProbeta\` VARCHAR(20) NULL,
        \`identificacionProbetas\` VARCHAR(100) NULL,
        \`observaciones\` TEXT NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`createdBy\` VARCHAR(255) NULL,
        PRIMARY KEY (\`idPastonPrueba\`),
        KEY \`idx_paston_dosificacion\` (\`idDosificacionDisenada\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Pastones de prueba de laboratorio.'
    `);

    // ── PastonCorreccion: corrections applied after trial batches ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`PastonCorreccion\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`dosificacionId\` INT UNSIGNED NOT NULL,
        \`pastonId\` INT UNSIGNED NOT NULL,
        \`campo\` VARCHAR(100) NOT NULL,
        \`campoLabel\` VARCHAR(200) NOT NULL,
        \`valorAnterior\` VARCHAR(255) NOT NULL,
        \`valorNuevo\` VARCHAR(255) NOT NULL,
        \`unidad\` VARCHAR(20) NULL,
        \`motivo\` TEXT NOT NULL,
        \`usuario\` VARCHAR(255) NOT NULL,
        \`recalculoEjecutado\` TINYINT(1) NOT NULL DEFAULT 0,
        \`resultadoRecalculo\` JSON NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_corr_dosif\` (\`dosificacionId\`),
        KEY \`idx_corr_paston\` (\`pastonId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Correcciones aplicadas a la dosificación tras un pastón de prueba.'
    `);

    // ── RedosificacionObra: acciones trazables de redosificación en obra ──
    // Ej: recuperar asentamiento con dosis extra de superplastificante post-transporte.
    // El mismo aditivo puede aparecer en el diseño (aditivo1/2) y acá simultáneamente;
    // son instancias conceptuales distintas.
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`RedosificacionObra\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`idDosificacionDisenada\` INT UNSIGNED NOT NULL,
        \`idAditivo\` INT UNSIGNED NOT NULL,
        \`dosis\` DECIMAL(6,3) NOT NULL,
        \`unidadDosis\` ENUM('PCT_CEMENTO','CC_M3','G_M3','KG_M3') NOT NULL DEFAULT 'PCT_CEMENTO',
        \`modoEfecto\` ENUM('AHORRO_AGUA','AUMENTO_ASENTAMIENTO','RETARDANTE','ACELERANTE_FRAGUE','ACELERANTE_ENDURECIMIENTO','INCORPORADOR_AIRE','ANTICONGELANTE','REDUCTOR_RETRACCION','EXPANSIVO','INHIBIDOR_CORROSION','VISCOSANTE','IMPERMEABILIZANTE','FIBRAS','OTRO') NOT NULL DEFAULT 'AUMENTO_ASENTAMIENTO',
        \`motivo\` VARCHAR(255) NOT NULL,
        \`observaciones\` TEXT NULL,
        \`fecha\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`volumenHormigonM3\` DECIMAL(8,3) NULL,
        \`asentamientoAntes\` DECIMAL(5,1) NULL,
        \`asentamientoDespues\` DECIMAL(5,1) NULL,
        \`reduccionAguaPct\` DECIMAL(5,2) NULL,
        \`pastonRefId\` INT UNSIGNED NULL,
        \`despachoRefId\` INT UNSIGNED NULL,
        \`usuario\` VARCHAR(255) NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_redos_dosificacion\` (\`idDosificacionDisenada\`),
        KEY \`idx_redos_aditivo\` (\`idAditivo\`),
        KEY \`idx_redos_paston\` (\`pastonRefId\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Redosificaciones aplicadas en obra.'
    `);

    // ── PrediccionComportamientoFresco: predicción heurística V1 ──
    // Tabla creada por migración formal:
    //   migrations/20260413-create-prediccion-comportamiento-fresco.js
    // (se retiró el CREATE TABLE IF NOT EXISTS ad hoc para mantener el esquema
    // bajo control de Sequelize CLI).

    // ── AireDurabilidad: CIRSOC 200:2024 Tabla 4.3 — aire incorporado por TMN y clase C1/C2 ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`AireDurabilidad\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`tmnMm\` DECIMAL(5,1) NOT NULL,
        \`claseExposicion\` VARCHAR(5) NOT NULL,
        \`aireTotalPct\` DECIMAL(3,1) NOT NULL,
        \`toleranciaPct\` DECIMAL(3,1) NOT NULL DEFAULT 1.5,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_tmn_clase\` (\`tmnMm\`, \`claseExposicion\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Aire total requerido por TMN y clase de exposición C1/C2 (CIRSOC 200:2024 Tabla 4.3).'
    `);

    // Seed Tabla 4.3 if empty
    const [aireRows] = await sequelize.query('SELECT COUNT(*) AS cnt FROM `AireDurabilidad`');
    if (aireRows[0].cnt === 0) {
      await sequelize.query(`
        INSERT INTO \`AireDurabilidad\` (\`tmnMm\`, \`claseExposicion\`, \`aireTotalPct\`, \`toleranciaPct\`) VALUES
        (13.2, 'C1', 5.5, 1.5),
        (13.2, 'C2', 7.0, 1.5),
        (19.0, 'C1', 5.0, 1.5),
        (19.0, 'C2', 6.0, 1.5),
        (26.5, 'C1', 4.5, 1.5),
        (26.5, 'C2', 6.0, 1.5),
        (37.5, 'C1', 4.5, 1.5),
        (37.5, 'C2', 5.5, 1.5)
      `);
    } else {
      // Fix incorrect seed values from earlier version (CIRSOC 200:2024 Tabla 4.3 errata)
      await sequelize.query(`UPDATE \`AireDurabilidad\` SET \`aireTotalPct\` = 5.5 WHERE \`tmnMm\` = 13.2 AND \`claseExposicion\` = 'C1' AND \`aireTotalPct\` = 6.5`);
      await sequelize.query(`UPDATE \`AireDurabilidad\` SET \`aireTotalPct\` = 7.0 WHERE \`tmnMm\` = 13.2 AND \`claseExposicion\` = 'C2' AND \`aireTotalPct\` = 7.5`);
      await sequelize.query(`UPDATE \`AireDurabilidad\` SET \`aireTotalPct\` = 5.0 WHERE \`tmnMm\` = 19.0 AND \`claseExposicion\` = 'C1' AND \`aireTotalPct\` = 6.0`);
      await sequelize.query(`UPDATE \`AireDurabilidad\` SET \`aireTotalPct\` = 6.0 WHERE \`tmnMm\` = 19.0 AND \`claseExposicion\` = 'C2' AND \`aireTotalPct\` = 7.0`);
      await sequelize.query(`UPDATE \`AireDurabilidad\` SET \`aireTotalPct\` = 4.5 WHERE \`tmnMm\` = 26.5 AND \`claseExposicion\` = 'C1' AND \`aireTotalPct\` = 5.0`);
    }

    // ── PulverulentoMinimo: CIRSOC 200:2024 Tabla 4.4 — mínimo material pulverulento por TMN ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`PulverulentoMinimo\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`tmnMm\` DECIMAL(5,1) NOT NULL UNIQUE,
        \`minimoKgM3\` INT UNSIGNED NOT NULL,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Material pulverulento mínimo pasante 300 µm por TMN (CIRSOC 200:2024 Tabla 4.4).'
    `);

    // Seed Tabla 4.4 if empty — CIRSOC 200:2024 values corrected
    const [pulvRows] = await sequelize.query('SELECT COUNT(*) AS cnt FROM `PulverulentoMinimo`');
    if (pulvRows[0].cnt === 0) {
      await sequelize.query(`
        INSERT INTO \`PulverulentoMinimo\` (\`tmnMm\`, \`minimoKgM3\`) VALUES
        (13.2, 480),
        (19.0, 440),
        (26.5, 410),
        (37.5, 380),
        (53.0, 350)
      `);
    }
    // Force-correct pulverulento values unconditionally (CIRSOC 200:2024 Tabla 4.4)
    // Previous conditional update failed for some databases — now always enforced.
    const pulvCorrections = [
      [13.2, 480], [19.0, 440], [26.5, 410], [37.5, 380], [53.0, 350],
    ];
    for (const [tmn, minKg] of pulvCorrections) {
      await sequelize.query(
        `UPDATE \`PulverulentoMinimo\` SET \`minimoKgM3\` = ${minKg} WHERE ABS(\`tmnMm\` - ${tmn}) < 0.05`
      );
    }

    // ── Consistencia: CIRSOC 200:2024 Tablas 4.1 y 4.2 — clases de consistencia ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`Consistencia\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`codigo\` VARCHAR(20) NOT NULL UNIQUE,
        \`nombre\` VARCHAR(30) NOT NULL,
        \`orden\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`permiteRemoldeo\` TINYINT(1) NOT NULL DEFAULT 0,
        \`permiteAsentamiento\` TINYINT(1) NOT NULL DEFAULT 0,
        \`permiteExtendido\` TINYINT(1) NOT NULL DEFAULT 0,
        \`metodoDefecto\` VARCHAR(15) NOT NULL,
        \`remoldeoMin\` DECIMAL(4,1) NULL,
        \`remoldeoMax\` DECIMAL(4,1) NULL,
        \`remoldeoTolerancia\` DECIMAL(3,1) NULL,
        \`asentamientoMin\` DECIMAL(4,1) NULL,
        \`asentamientoMax\` DECIMAL(4,1) NULL,
        \`asentamientoTolerancia\` DECIMAL(3,1) NULL,
        \`extendidoMin\` DECIMAL(4,1) NULL,
        \`extendidoMax\` DECIMAL(4,1) NULL,
        \`extendidoTolerancia\` DECIMAL(3,1) NULL,
        \`requiereSuperplastificante\` TINYINT(1) NOT NULL DEFAULT 0,
        \`recomiendaFluidificante\` TINYINT(1) NOT NULL DEFAULT 0,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Clases de consistencia CIRSOC 200:2024 Tablas 4.1 y 4.2.'
    `);
    await addColumnSafe(sequelize, 'Consistencia', 'recomiendaFluidificante', 'TINYINT(1) NOT NULL DEFAULT 0');

    // Seed 6 classes if empty
    const [consRows] = await sequelize.query('SELECT COUNT(*) AS cnt FROM `Consistencia`');
    if (consRows[0].cnt === 0) {
      await sequelize.query(`
        INSERT INTO \`Consistencia\`
          (\`codigo\`, \`nombre\`, \`orden\`,
           \`permiteRemoldeo\`, \`permiteAsentamiento\`, \`permiteExtendido\`, \`metodoDefecto\`,
           \`remoldeoMin\`, \`remoldeoMax\`, \`remoldeoTolerancia\`,
           \`asentamientoMin\`, \`asentamientoMax\`, \`asentamientoTolerancia\`,
           \`extendidoMin\`, \`extendidoMax\`, \`extendidoTolerancia\`,
           \`requiereSuperplastificante\`, \`recomiendaFluidificante\`)
        VALUES
          ('muy_seca',     'Muy seca',     1, 1, 0, 0, 'remoldeo',       5.0, 30.0, 2.0, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0),
          ('seca',         'Seca',         2, 1, 1, 0, 'asentamiento',   3.0,  8.0, 1.0,  2.0,  5.0, 1.0, NULL, NULL, NULL, 0, 0),
          ('plastica',     'Plástica',     3, 0, 1, 0, 'asentamiento',  NULL, NULL, NULL,  5.0, 10.0, 2.0, NULL, NULL, NULL, 0, 0),
          ('muy_plastica', 'Muy plástica', 4, 0, 1, 1, 'asentamiento',  NULL, NULL, NULL, 10.0, 15.0, 2.0, 50.0, 55.0, 1.0, 0, 1),
          ('fluida',       'Fluida',       5, 0, 1, 1, 'asentamiento',  NULL, NULL, NULL, 15.0, 18.0, 3.0, 55.0, 60.0, 1.0, 1, 0),
          ('muy_fluida',   'Muy fluida',   6, 0, 0, 1, 'extendido',     NULL, NULL, NULL, NULL, NULL, NULL, 60.0, 65.0, 2.0, 1, 0)
      `);
    } else {
      // Ensure existing databases get the recomiendaFluidificante flag for muy_plastica
      await sequelize.query(`UPDATE \`Consistencia\` SET \`recomiendaFluidificante\` = 1 WHERE \`codigo\` = 'muy_plastica' AND \`recomiendaFluidificante\` = 0`);
    }

    // ── Ensayo catalog: normalizar defaults ──
    try {
      await sequelize.query(`
        UPDATE \`AgregadoEnsayoTipo\`
        SET obligatorio = 1, periodicidadMeses = 12, warningDays = 60,
            perfil = 'CORE', visibleEnUI = 1, visibleEnCards = 1
        WHERE isActive = 1 AND material IN ('AGREGADOS', 'AGUA')
      `);
    } catch (_) { /* tabla puede no existir aún */ }

    // ── Ensayos sin fechaVencimiento: calcular desde fechaEnsayo + periodicidad ──
    try {
      await sequelize.query(`
        UPDATE \`AgregadoEnsayo\` e
        INNER JOIN \`AgregadoEnsayoTipo\` t ON e.idAgregadoEnsayoTipo = t.idAgregadoEnsayoTipo
        SET e.fechaVencimiento = DATE_ADD(e.fechaEnsayo, INTERVAL t.periodicidadMeses MONTH)
        WHERE e.fechaVencimiento IS NULL
          AND e.fechaEnsayo IS NOT NULL
          AND t.periodicidadMeses IS NOT NULL
          AND t.periodicidadMeses > 0
          AND e.isActive = 1
      `);
    } catch (_) { /* tablas pueden no existir */ }

    // ── Clean up underscores in Norma.codigo (IRAM_1505 → IRAM 1505) ──
    try {
      // Replace underscores with spaces
      await sequelize.query(`UPDATE \`Norma\` SET codigo = REPLACE(codigo, '_', ' ') WHERE codigo LIKE '%\\_%'`);
      // Fix sub-part numbers: "IRAM 1687 1" → "IRAM 1687-1"
      await sequelize.query(`UPDATE \`Norma\` SET codigo = CONCAT(SUBSTRING_INDEX(codigo, ' ', 2), '-', SUBSTRING_INDEX(codigo, ' ', -1)) WHERE codigo REGEXP '[0-9] [0-9]$'`);
    } catch (_) { /* Norma may not exist */ }

    // ── NormaAplicaA: lookup table for "Aplica a" field ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`NormaAplicaA\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        \`nombre\` VARCHAR(100) NOT NULL UNIQUE,
        \`orden\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    const [naaRows] = await sequelize.query('SELECT COUNT(*) AS cnt FROM `NormaAplicaA`');
    if (naaRows[0].cnt === 0) {
      await sequelize.query(`
        INSERT INTO \`NormaAplicaA\` (\`nombre\`, \`orden\`) VALUES
        ('Agregados finos', 1),
        ('Agregados gruesos', 2),
        ('Agregados finos y gruesos', 3),
        ('Cemento', 4),
        ('Hormigón', 5),
        ('Asfalto', 6),
        ('Suelos', 7)
      `);
    }
    await addColumnSafe(sequelize, 'Norma', 'aplicaAId', 'INT UNSIGNED NULL');

    // Migrate existing Norma.aplicaA JSON data → aplicaAId FK
    try {
      // 1. Map normas with aplicaA JSON containing "agregados" → "Agregados finos y gruesos"
      await sequelize.query(`
        UPDATE \`Norma\` SET aplicaAId = (SELECT id FROM \`NormaAplicaA\` WHERE nombre = 'Agregados finos y gruesos' LIMIT 1)
        WHERE aplicaAId IS NULL AND aplicaA IS NOT NULL AND LOWER(CAST(aplicaA AS CHAR)) LIKE '%agregado%'
      `);
      // 2. Map normas about hormigón (by title)
      await sequelize.query(`
        UPDATE \`Norma\` SET aplicaAId = (SELECT id FROM \`NormaAplicaA\` WHERE nombre = 'Hormigón' LIMIT 1)
        WHERE aplicaAId IS NULL AND (LOWER(titulo) LIKE '%hormig%' OR LOWER(titulo) LIKE '%hormig%')
      `);
      // 3. Map normas about cemento (by title)
      await sequelize.query(`
        UPDATE \`Norma\` SET aplicaAId = (SELECT id FROM \`NormaAplicaA\` WHERE nombre = 'Cemento' LIMIT 1)
        WHERE aplicaAId IS NULL AND LOWER(titulo) LIKE '%cemento%'
      `);
    } catch (_) { /* migration best-effort */ }

    // ── Ensayo tipo IDs: no longer renumbered on startup ──
    // (Previously deleted and re-inserted all rows to get sequential IDs 1..N;
    //  removed because it's destructive and unnecessary.)

    // ── Agua: create table if not exists ──
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`Agua\` (
        \`idAgua\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`nombre\` VARCHAR(200) NOT NULL,
        \`fuenteOrigen\` ENUM('RED_PUBLICA','POZO','RECUPERADA_HORMIGON','RESIDUAL_INDUSTRIAL','SUBTERRANEA','LLUVIA','SUPERFICIAL','MAR_SALOBRE','RESIDUAL_CLOACAL_TRATADA') NULL,
        \`idPlanta\` INT UNSIGNED NULL,
        \`laboratorio\` VARCHAR(200) NULL,
        \`observaciones\` TEXT NULL,
        \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
        \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`idAgua\`),
        INDEX \`idx_agua_planta\` (\`idPlanta\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='Fuentes de agua según IRAM 1601.'
    `);

    // ── MaterialTipo: seed Agua (id 6) if missing ──
    try {
      const [aguaTipoRows] = await sequelize.query("SELECT COUNT(*) AS cnt FROM `MaterialTipo` WHERE `idMaterialTipo` = 6");
      if (aguaTipoRows[0].cnt === 0) {
        await sequelize.query(`
          INSERT INTO \`MaterialTipo\` (\`idMaterialTipo\`, \`nombre\`, \`descripcion\`, \`icono\`, \`orden\`, \`activo\`, \`createdAt\`, \`updatedAt\`)
          VALUES (6, 'Agua', 'Agua de amasado y curado', 'fa-solid fa-droplet', 6, 1, NOW(), NOW())
        `);
      }
    } catch (_) { /* MaterialTipo may not exist yet */ }

    // ── Material: garantizar columna idMaterialTipo en tenants legacy ──
    // El modelo la tiene NOT NULL, pero bases creadas antes del catálogo
    // unificado (pre abril 2026) podrían no tenerla, generando warnings de
    // startup. `addColumnSafe` crea NULLable por default; luego backfill a 1
    // (agregados — el tipo legacy más común) y se promueve a NOT NULL si la
    // tabla ya no tiene NULLs.
    await addColumnSafe(sequelize, 'Material', 'idMaterialTipo',
      "INT UNSIGNED NULL COMMENT 'FK a MaterialTipo; backfill automático en tenants legacy'");
    try {
      await sequelize.query("UPDATE `Material` SET `idMaterialTipo` = 1 WHERE `idMaterialTipo` IS NULL");
      // Promover a NOT NULL solo si no quedaron nulls (defensivo)
      const [[{ cnt }]] = await sequelize.query("SELECT COUNT(*) AS cnt FROM `Material` WHERE `idMaterialTipo` IS NULL");
      if (Number(cnt) === 0) {
        await sequelize.query("ALTER TABLE `Material` MODIFY `idMaterialTipo` INT UNSIGNED NOT NULL");
      }
    } catch (err) {
      console.warn('[migrations] Material.idMaterialTipo backfill:', err.message);
    }

    // Sesión 2026-05-29 — tenants con `Material` creada por sync() viejo
    // pueden no tener algunas columnas del modelo actual. Las agregamos
    // defensivamente. addColumnSafe es idempotente (errno 1060 → skip).
    await addColumnSafe(sequelize, 'Material', 'proveedor',           "VARCHAR(100) NULL");
    await addColumnSafe(sequelize, 'Material', 'origen',              "VARCHAR(100) NULL");
    await addColumnSafe(sequelize, 'Material', 'fechaAlta',           "DATE NULL");
    await addColumnSafe(sequelize, 'Material', 'observaciones',       "TEXT NULL");
    await addColumnSafe(sequelize, 'Material', 'tipoAdicion',
      "ENUM('FILLER_CALCAREO','CENIZA_VOLANTE','ESCORIA','HUMO_SILICE','PUZOLANA','OTRO') NULL");
    await addColumnSafe(sequelize, 'Material', 'densidadRelativa',    "DECIMAL(5,3) NULL");
    await addColumnSafe(sequelize, 'Material', 'superficieEspecifica', "DECIMAL(8,1) NULL");
    await addColumnSafe(sequelize, 'Material', 'metadataTecnicaJson', "JSON NULL");
    // Sequelize timestamps (default ON en el modelo). Algunos tenants
    // legacy crearon Material sin ellos.
    await addColumnSafe(sequelize, 'Material', 'createdAt', "DATETIME NULL");
    await addColumnSafe(sequelize, 'Material', 'updatedAt', "DATETIME NULL");
    try {
      await sequelize.query("UPDATE `Material` SET `createdAt` = NOW() WHERE `createdAt` IS NULL");
      await sequelize.query("UPDATE `Material` SET `updatedAt` = NOW() WHERE `updatedAt` IS NULL");
    } catch (_) { /* non-blocking */ }

    // ── AgregadoEnsayoTipo: caracterización columns ──
    await addColumnSafe(sequelize, 'AgregadoEnsayoTipo', 'visibleEnCaracterizacion', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'true = aparece en la ficha de caracterización del agregado'");
    await addColumnSafe(sequelize, 'AgregadoEnsayoTipo', 'caractFields', "JSON NULL COMMENT 'Array de { key, label, labelCorto, unidad } para la ficha de caracterización'");

    // ── AgregadoMeta: tipoRoca & evaluacionRas columns ──
    await addColumnSafe(sequelize, 'AgregadoMeta', 'tipoRoca',
      "ENUM('GRANITICA','BASALTICA','CALCAREA','CUARCITICA','OTRA') NULL DEFAULT NULL");
    await addColumnSafe(sequelize, 'AgregadoMeta', 'evaluacionRas',
      "ENUM('NO_EVALUADO','NO_REACTIVO','POTENCIALMENTE_REACTIVO') NULL DEFAULT 'NO_EVALUADO'");
    await addColumnSafe(sequelize, 'AgregadoMeta', 'alertaClasificacion', 'JSON NULL DEFAULT NULL');

    // ── DosificacionDisenada: ambienteHumedo column ──
    await addColumnSafe(sequelize, 'DosificacionDisenada', 'ambienteHumedo',
      "TINYINT(1) NOT NULL DEFAULT 0");

    // ── Bloque K — TechnicalEvidence (CIRSOC §3.2.3.2 f) MVP textual ──
    // Tabla idempotente: si ya existe la creación falla y se ignora.
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`TechnicalEvidence\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`tipo\` ENUM('LAB_STUDY', 'PRIOR_PROJECT') NOT NULL,
          \`referencia\` VARCHAR(160) NOT NULL,
          \`fecha\` DATE NOT NULL,
          \`descripcion\` TEXT NOT NULL,
          \`laboratorio\` VARCHAR(120) NULL,
          \`urlAdjunto\` VARCHAR(500) NULL,
          \`materialesAsociados\` JSON NOT NULL,
          \`dosificacionesAsociadas\` JSON NOT NULL,
          \`claseResistenciaAplicable\` VARCHAR(10) NULL,
          \`responsableCarga\` VARCHAR(120) NOT NULL,
          \`rolCarga\` VARCHAR(40) NULL,
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_TechnicalEvidence_tipo\` (\`tipo\`),
          INDEX \`idx_TechnicalEvidence_activo\` (\`activo\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err) {
      // La tabla ya existe o hubo otro error de DDL no fatal
      if (err.original?.errno !== 1050) {
        console.warn('[migrations] TechnicalEvidence:', err.message);
      }
    }

    // ── Bloque K.3 — OverrideRequest (log auditable de liberaciones) ──
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`OverrideRequest\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`idDosificacionDisenada\` INT UNSIGNED NOT NULL,
          \`idMezcla\` INT UNSIGNED NOT NULL,
          \`idMaterial\` INT UNSIGNED NULL,
          \`ambito\` ENUM('OBRA', 'AUTOCONTROL_PLANTA') NOT NULL,
          \`estado\` ENUM('PENDIENTE', 'APROBADO', 'RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
          \`motivo\` TEXT NOT NULL,
          \`evidenciaAlternativaDescripcion\` TEXT NULL,
          \`solicitadoPor\` VARCHAR(120) NOT NULL,
          \`rolSolicitante\` VARCHAR(40) NULL,
          \`fechaSolicitud\` DATETIME NOT NULL,
          \`resueltoPor\` VARCHAR(120) NULL,
          \`rolResolutor\` VARCHAR(40) NULL,
          \`matriculaResolutor\` VARCHAR(40) NULL,
          \`fechaResolucion\` DATETIME NULL,
          \`observacionesResolucion\` TEXT NULL,
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_OverrideRequest_dosif\` (\`idDosificacionDisenada\`),
          INDEX \`idx_OverrideRequest_mezcla\` (\`idMezcla\`),
          INDEX \`idx_OverrideRequest_estado\` (\`estado\`),
          INDEX \`idx_OverrideRequest_activo\` (\`activo\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err) {
      if (err.original?.errno !== 1050) {
        console.warn('[migrations] OverrideRequest:', err.message);
      }
    }

    // ── Fase 2 RBAC — DocumentApprovalRequest ──
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`DocumentApprovalRequest\` (
          \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`tipoDocumento\` ENUM('CERTIFICADO', 'INFORME_EVALUACION', 'CERTIFICADO_DOSIFICACION') NOT NULL,
          \`idMaterial\` INT UNSIGNED NULL,
          \`idDosificacionDisenada\` INT UNSIGNED NULL,
          \`contextoJson\` JSON NOT NULL,
          \`estado\` ENUM('PENDIENTE', 'APROBADO', 'RECHAZADO', 'EXPIRADO') NOT NULL DEFAULT 'PENDIENTE',
          \`motivoSolicitud\` TEXT NULL,
          \`solicitadoPor\` VARCHAR(120) NOT NULL,
          \`rolSolicitante\` VARCHAR(40) NULL,
          \`fechaSolicitud\` DATETIME NOT NULL,
          \`resueltoPor\` VARCHAR(120) NULL,
          \`rolResolutor\` VARCHAR(40) NULL,
          \`matriculaResolutor\` VARCHAR(40) NULL,
          \`fechaResolucion\` DATETIME NULL,
          \`observacionesResolucion\` TEXT NULL,
          \`pdfEmitidoAt\` DATETIME NULL,
          \`pdfEmitidoPor\` VARCHAR(120) NULL,
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_DocApproval_estado\` (\`estado\`),
          INDEX \`idx_DocApproval_material\` (\`idMaterial\`),
          INDEX \`idx_DocApproval_dosif\` (\`idDosificacionDisenada\`),
          INDEX \`idx_DocApproval_activo\` (\`activo\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err) {
      if (err.original?.errno !== 1050) {
        console.warn('[migrations] DocumentApprovalRequest:', err.message);
      }
    }

    // ── Disponibilidad y configuración de materiales por planta ──
    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`CementoPlanta\` (
          \`idCementoPlanta\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`idCemento\` INT UNSIGNED NOT NULL,
          \`idPlanta\` INT UNSIGNED NOT NULL,
          \`modoCurva\` ENUM('ICPA','FABRICANTE','PROPIA') NOT NULL DEFAULT 'ICPA',
          \`factorAjuste\` DECIMAL(5,3) NOT NULL DEFAULT 1.000,
          \`idCurvaPropia\` INT UNSIGNED NULL,
          \`observaciones\` TEXT NULL,
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`idCementoPlanta\`),
          UNIQUE KEY \`uq_CementoPlanta_cemento_planta\` (\`idCemento\`, \`idPlanta\`),
          INDEX \`idx_CementoPlanta_planta\` (\`idPlanta\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err) {
      if (err.original?.errno !== 1050) {
        console.warn('[migrations] CementoPlanta:', err.message);
      }
    }

    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`MaterialPlanta\` (
          \`idMaterialPlanta\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`materialSource\` ENUM('aditivo','adicion','fibra','agregado','agua') NOT NULL,
          \`materialSourceId\` INT UNSIGNED NOT NULL,
          \`idPlanta\` INT UNSIGNED NOT NULL,
          \`observaciones\` TEXT NULL,
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`idMaterialPlanta\`),
          UNIQUE KEY \`uq_MaterialPlanta_src_id_planta\` (\`materialSource\`, \`materialSourceId\`, \`idPlanta\`),
          INDEX \`idx_MaterialPlanta_planta\` (\`idPlanta\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err) {
      if (err.original?.errno !== 1050) {
        console.warn('[migrations] MaterialPlanta:', err.message);
      }
    }

    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`EquipoPlanta\` (
          \`idEquipoPlanta\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`idEquipo\` INT UNSIGNED NOT NULL,
          \`idPlanta\` INT UNSIGNED NOT NULL,
          \`observaciones\` TEXT NULL,
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`idEquipoPlanta\`),
          UNIQUE KEY \`uq_EquipoPlanta_equipo_planta\` (\`idEquipo\`, \`idPlanta\`),
          INDEX \`idx_EquipoPlanta_planta\` (\`idPlanta\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err) {
      if (err.original?.errno !== 1050) {
        console.warn('[migrations] EquipoPlanta:', err.message);
      }
    }

    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`Laboratorio\` (
          \`idLaboratorio\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`nombre\` VARCHAR(150) NOT NULL,
          \`direccion\` VARCHAR(255) NULL,
          \`observaciones\` TEXT NULL,
          \`idPrensaPorDefecto\` INT UNSIGNED NULL,
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`idLaboratorio\`),
          INDEX \`idx_Laboratorio_activo\` (\`activo\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err) {
      if (err.original?.errno !== 1050) {
        console.warn('[migrations] Laboratorio:', err.message);
      }
    }

    try {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS \`LaboratorioPlanta\` (
          \`idLaboratorioPlanta\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`idLaboratorio\` INT UNSIGNED NOT NULL,
          \`idPlanta\` INT UNSIGNED NOT NULL,
          \`observaciones\` TEXT NULL,
          \`activo\` TINYINT(1) NOT NULL DEFAULT 1,
          \`createdAt\` DATETIME NOT NULL,
          \`updatedAt\` DATETIME NOT NULL,
          PRIMARY KEY (\`idLaboratorioPlanta\`),
          UNIQUE KEY \`uq_LaboratorioPlanta_lab_planta\` (\`idLaboratorio\`, \`idPlanta\`),
          INDEX \`idx_LaboratorioPlanta_planta\` (\`idPlanta\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    } catch (err) {
      if (err.original?.errno !== 1050) {
        console.warn('[migrations] LaboratorioPlanta:', err.message);
      }
    }

    await addColumnSafe(sequelize, 'EquipoLaboratorio', 'idLaboratorio', 'INT UNSIGNED NULL');
    await addColumnSafe(sequelize, 'Pileta', 'idLaboratorio', 'INT UNSIGNED NULL');
    await addColumnSafe(sequelize, 'Prensa', 'tipoOperacion', "ENUM('MANUAL','AUTOMATICA','SEMIAUTOMATICA') NOT NULL DEFAULT 'MANUAL'");
    await addColumnSafe(sequelize, 'EquipoLaboratorio', 'tipoOperacion', "ENUM('MANUAL','AUTOMATICA','SEMIAUTOMATICA') NOT NULL DEFAULT 'MANUAL'");

    // Backfill Equipo → Prensa.
    //
    // Si se crearon equipos con tipo='PRENSA' desde la pantalla nueva ANTES
    // del fix de sync inverso (2026-05-13), esos equipos no tienen su fila
    // gemela en la tabla legacy `Prensa`. Sin la fila gemela:
    //  - El dropdown del ensayoForm (que consume /api/prensas) no las muestra.
    //  - La FK EnsayoResistencia.idPrensa → Prensa fallaría al cargar un
    //    ensayo con esa prensa.
    //
    // Este INSERT IGNORE crea filas Prensa con idPrensa = idEquipo (la
    // convención del seed 20260510c). Sólo inserta lo que falta — los
    // equipos que ya tienen su Prensa gemela quedan intactos.
    try {
      const dbName = sequelize.config?.database || 'unknown';
      const [result] = await sequelize.query(`
        INSERT IGNORE INTO \`Prensa\` (
          \`idPrensa\`, \`nombre\`, \`marca\`, \`modelo\`, \`anio\`, \`capacidad\`,
          \`descripcion\`, \`idUnidadMedidaPrensa\`, \`tipoOperacion\`,
          \`coeficienteUno\`, \`coeficienteDos\`, \`coeficienteTres\`,
          \`idPlanta\`, \`activo\`, \`fechaUltimaCalibracion\`, \`certificadoVigente\`,
          \`createdAt\`, \`updatedAt\`
        )
        SELECT
          e.idEquipo, e.nombre, e.marca, e.modelo, e.anio, e.capacidad,
          e.descripcion, e.idUnidadMedidaPrensa,
          COALESCE(e.tipoOperacion, 'MANUAL'),
          e.coeficienteUno, e.coeficienteDos, e.coeficienteTres,
          e.idPlanta, e.activo, e.fechaUltimaCalibracion, e.certificadoVigente,
          NOW(), NOW()
        FROM \`EquipoLaboratorio\` e
        WHERE e.tipo = 'PRENSA'
          AND NOT EXISTS (SELECT 1 FROM \`Prensa\` p WHERE p.idPrensa = e.idEquipo)
      `);
      const affected = result?.affectedRows ?? 0;
      if (affected > 0) {
        console.log(`[bootstrap][${dbName}] Backfill Equipo→Prensa: ${affected} fila(s) creada(s).`);
      }
    } catch (err) {
      console.warn('[bootstrap] Backfill Equipo→Prensa:', err.message);
    }

    // [VITRINA] fuera de alcance: ruta recortada, no sembrar en cada boot.
    // Todo este bloque de auto-seed de menús (Laboratorios, Equipos, Preferencias,
    // Panel del Plantista, Stock Betonmatic, Stock de materiales, Roles de Producción)
    // se desactiva: re-creaba ítems que apuntan a rutas recortadas en cada arranque.
    if (false) {
    // Seed idempotente de los items del menú de Laboratorio.
    //
    // Por qué acá y no en una migración: el user pidió explícitamente no
    // tener migraciones que toquen `Menu` porque sus tenants de producción
    // tienen idMenu propios distintos. Este seed se ejecuta en cada arranque
    // y SOLO inserta si no existe la ruta — no hardcodea ningún idMenu y no
    // modifica filas existentes. Si el padre "Laboratorio" no existe en el
    // tenant, el seed loguea un INFO y termina (no inventa el árbol).
    try {
      const dbName = sequelize.config?.database || 'unknown';
      const [labRows] = await sequelize.query(
        "SELECT idMenu FROM `Menu` WHERE nombre = 'Laboratorio' AND idMenuPadre IS NOT NULL AND activo = 1 LIMIT 1"
      );
      if (labRows.length === 0) {
        console.log(`[bootstrap][${dbName}] Seed menú Laboratorio: padre "Laboratorio" no encontrado, skip.`);
      } else {
        const idLab = labRows[0].idMenu;
        const itemsLab = [
          { nombre: 'Laboratorios', ruta: '/calidad/laboratorio/laboratorios', icono: 'fa-solid fa-flask-vial' },
          { nombre: 'Equipos',      ruta: '/calidad/laboratorio/equipos',      icono: 'fa-solid fa-toolbox' },
        ];
        let creados = 0;
        let yaExistian = 0;
        for (const it of itemsLab) {
          // 1) ¿Ya existe esa ruta?
          const [existRows] = await sequelize.query(
            "SELECT idMenu FROM `Menu` WHERE ruta = :ruta LIMIT 1",
            { replacements: { ruta: it.ruta } }
          );
          if (existRows.length > 0) {
            yaExistian++;
            continue;
          }
          // 2) Calcular el próximo `orden` entre los hermanos.
          const [maxOrdenRows] = await sequelize.query(
            "SELECT COALESCE(MAX(orden), 0) AS maxOrden FROM `Menu` WHERE idMenuPadre = :idLab",
            { replacements: { idLab } }
          );
          const nextOrden = Number(maxOrdenRows[0].maxOrden || 0) + 1;
          // 3) Insertar.
          await sequelize.query(
            "INSERT INTO `Menu` (idMenuPadre, nombre, ruta, icono, orden, activo, modulo, createdAt, updatedAt) " +
            "VALUES (:idLab, :nombre, :ruta, :icono, :orden, 1, 'calidad', NOW(), NOW())",
            { replacements: { idLab, nombre: it.nombre, ruta: it.ruta, icono: it.icono, orden: nextOrden } }
          );
          creados++;
        }
        console.log(`[bootstrap][${dbName}] Seed menú Laboratorio: creados=${creados}, yaExistian=${yaExistian} (padre idMenu=${idLab}).`);
        // Invalidar cache para que los items aparezcan sin esperar TTL de 30 min.
        if (creados > 0) {
          try {
            const { getCacheForDb } = require('../services/cacheHelpers');
            const tc = getCacheForDb({ sequelize });
            tc.invalidate('menus');
          } catch (_) { /* opcional */ }
        }
      }
    } catch (err) {
      console.warn('[bootstrap] Seed menú Laboratorio FAIL:', err.message);
    }

    // Seed idempotente del item "Preferencias" bajo Configuración.
    // Mismo patrón que el seed de Laboratorio: busca el padre por nombre,
    // sólo inserta si no existe la ruta, invalida cache al crear.
    try {
      const dbName = sequelize.config?.database || 'unknown';
      // "Configuración" puede ser top-level (idMenuPadre IS NULL) o hijo según
      // el árbol del tenant. Buscamos por nombre sin filtrar por padre.
      const [cfgRows] = await sequelize.query(
        "SELECT idMenu FROM `Menu` WHERE nombre = 'Configuración' AND activo = 1 LIMIT 1"
      );
      if (cfgRows.length === 0) {
        console.log(`[bootstrap][${dbName}] Seed menú Preferencias: padre "Configuración" no encontrado, skip.`);
      } else {
        const idCfg = cfgRows[0].idMenu;
        const ruta = '/configuracion/preferencias';
        const [existRows] = await sequelize.query(
          "SELECT idMenu FROM `Menu` WHERE ruta = :ruta LIMIT 1",
          { replacements: { ruta } }
        );
        if (existRows.length === 0) {
          const [maxOrdenRows] = await sequelize.query(
            "SELECT COALESCE(MAX(orden), 0) AS maxOrden FROM `Menu` WHERE idMenuPadre = :idCfg",
            { replacements: { idCfg } }
          );
          const nextOrden = Number(maxOrdenRows[0].maxOrden || 0) + 1;
          await sequelize.query(
            "INSERT INTO `Menu` (idMenuPadre, nombre, ruta, icono, orden, activo, modulo, createdAt, updatedAt) " +
            "VALUES (:idCfg, 'Preferencias', :ruta, 'fa-solid fa-sliders', :orden, 1, NULL, NOW(), NOW())",
            { replacements: { idCfg, ruta, orden: nextOrden } }
          );
          console.log(`[bootstrap][${dbName}] Seed menú Preferencias: creado (padre idMenu=${idCfg}).`);
          try {
            const { getCacheForDb } = require('../services/cacheHelpers');
            const tc = getCacheForDb({ sequelize });
            tc.invalidate('menus');
          } catch (_) { /* opcional */ }
        } else {
          console.log(`[bootstrap][${dbName}] Seed menú Preferencias: ya existía.`);
        }
      }
    } catch (err) {
      console.warn('[bootstrap] Seed menú Preferencias FAIL:', err.message);
    }

    // Seed idempotente del item "Panel del Plantista" bajo Producción (Fase 6.1).
    // Mismo patrón que los seeds anteriores: busca el padre por nombre, sólo
    // inserta si no existe la ruta, invalida cache al crear.
    try {
      const dbName = sequelize.config?.database || 'unknown';
      const [prodRows] = await sequelize.query(
        "SELECT idMenu FROM `Menu` WHERE nombre = 'Producción' AND activo = 1 LIMIT 1"
      );
      if (prodRows.length === 0) {
        console.log(`[bootstrap][${dbName}] Seed menú Panel del Plantista: padre "Producción" no encontrado, skip.`);
      } else {
        const idProd = prodRows[0].idMenu;
        const ruta = '/produccion/panel-plantista';
        const [existRows] = await sequelize.query(
          "SELECT idMenu FROM `Menu` WHERE ruta = :ruta LIMIT 1",
          { replacements: { ruta } }
        );
        if (existRows.length === 0) {
          const [maxOrdenRows] = await sequelize.query(
            "SELECT COALESCE(MAX(orden), 0) AS maxOrden FROM `Menu` WHERE idMenuPadre = :idProd",
            { replacements: { idProd } }
          );
          const nextOrden = Number(maxOrdenRows[0].maxOrden || 0) + 1;
          await sequelize.query(
            "INSERT INTO `Menu` (idMenuPadre, nombre, ruta, icono, orden, activo, modulo, createdAt, updatedAt) " +
            "VALUES (:idProd, 'Panel del Plantista', :ruta, 'fa-solid fa-helmet-safety', :orden, 1, 'produccion', NOW(), NOW())",
            { replacements: { idProd, ruta, orden: nextOrden } }
          );
          console.log(`[bootstrap][${dbName}] Seed menú Panel del Plantista: creado (padre idMenu=${idProd}).`);
          try {
            const { getCacheForDb } = require('../services/cacheHelpers');
            const tc = getCacheForDb({ sequelize });
            tc.invalidate('menus');
          } catch (_) { /* opcional */ }
        } else {
          console.log(`[bootstrap][${dbName}] Seed menú Panel del Plantista: ya existía.`);
        }
      }
    } catch (err) {
      console.warn('[bootstrap] Seed menú Panel del Plantista FAIL:', err.message);
    }

    // Seed idempotente del item "Stock Betonmatic" bajo Producción.
    try {
      const dbName = sequelize.config?.database || 'unknown';
      const [prodRows] = await sequelize.query(
        "SELECT idMenu FROM `Menu` WHERE nombre = 'Producción' AND activo = 1 LIMIT 1"
      );
      if (prodRows.length === 0) {
        console.log(`[bootstrap][${dbName}] Seed menú Stock Betonmatic: padre "Producción" no encontrado, skip.`);
      } else {
        const idProd = prodRows[0].idMenu;
        const ruta = '/produccion/stock-betonmatic';
        const [existRows] = await sequelize.query(
          "SELECT idMenu FROM `Menu` WHERE ruta = :ruta LIMIT 1",
          { replacements: { ruta } }
        );
        if (existRows.length === 0) {
          const [maxOrdenRows] = await sequelize.query(
            "SELECT COALESCE(MAX(orden), 0) AS maxOrden FROM `Menu` WHERE idMenuPadre = :idProd",
            { replacements: { idProd } }
          );
          const nextOrden = Number(maxOrdenRows[0].maxOrden || 0) + 1;
          await sequelize.query(
            "INSERT INTO `Menu` (idMenuPadre, nombre, ruta, icono, orden, activo, modulo, createdAt, updatedAt) " +
            "VALUES (:idProd, 'Consumos de planta', :ruta, 'fa-solid fa-warehouse', :orden, 1, 'produccion', NOW(), NOW())",
            { replacements: { idProd, ruta, orden: nextOrden } }
          );
          console.log(`[bootstrap][${dbName}] Seed menú Consumos de planta: creado.`);
          try {
            const { getCacheForDb } = require('../services/cacheHelpers');
            const tc = getCacheForDb({ sequelize });
            tc.invalidate('menus');
          } catch (_) { /* opcional */ }
        } else {
          console.log(`[bootstrap][${dbName}] Seed menú Stock Betonmatic: ya existía.`);
        }
      }
    } catch (err) {
      console.warn('[bootstrap] Seed menú Stock Betonmatic FAIL:', err.message);
    }

    // Rename idempotente: "Stock Betonmatic" → "Consumos de planta" (2026-06-10).
    // La pantalla muestra consumos/cargas del día, no stock; "Stock" se reservó
    // para la nueva pantalla de existencias propias. Sólo renombra si conserva el
    // nombre viejo (respeta una eventual personalización del usuario).
    try {
      await sequelize.query(
        "UPDATE `Menu` SET nombre = 'Consumos de planta', updatedAt = NOW() " +
        "WHERE ruta = '/produccion/stock-betonmatic' AND nombre = 'Stock Betonmatic'"
      );
      try {
        const { getCacheForDb } = require('../services/cacheHelpers');
        getCacheForDb({ sequelize }).invalidate('menus');
      } catch (_) { /* opcional */ }
    } catch (err) {
      console.warn('[bootstrap] Rename menú Consumos de planta FAIL:', err.message);
    }

    // Seed idempotente del item "Stock de materiales" bajo Producción (stock propio HormiQual, Fase 1).
    try {
      const dbName = sequelize.config?.database || 'unknown';
      const [prodRows] = await sequelize.query(
        "SELECT idMenu FROM `Menu` WHERE nombre = 'Producción' AND activo = 1 LIMIT 1"
      );
      if (prodRows.length === 0) {
        console.log(`[bootstrap][${dbName}] Seed menú Stock de materiales: padre "Producción" no encontrado, skip.`);
      } else {
        const idProd = prodRows[0].idMenu;
        const ruta = '/produccion/stock-materiales';
        const [existRows] = await sequelize.query(
          "SELECT idMenu FROM `Menu` WHERE ruta = :ruta LIMIT 1",
          { replacements: { ruta } }
        );
        if (existRows.length === 0) {
          const [maxOrdenRows] = await sequelize.query(
            "SELECT COALESCE(MAX(orden), 0) AS maxOrden FROM `Menu` WHERE idMenuPadre = :idProd",
            { replacements: { idProd } }
          );
          const nextOrden = Number(maxOrdenRows[0].maxOrden || 0) + 1;
          await sequelize.query(
            "INSERT INTO `Menu` (idMenuPadre, nombre, ruta, icono, orden, activo, modulo, createdAt, updatedAt) " +
            "VALUES (:idProd, 'Stock de materiales', :ruta, 'fa-solid fa-boxes-stacked', :orden, 1, 'produccion', NOW(), NOW())",
            { replacements: { idProd, ruta, orden: nextOrden } }
          );
          console.log(`[bootstrap][${dbName}] Seed menú Stock de materiales: creado.`);
          try {
            const { getCacheForDb } = require('../services/cacheHelpers');
            const tc = getCacheForDb({ sequelize });
            tc.invalidate('menus');
          } catch (_) { /* opcional */ }
        } else {
          console.log(`[bootstrap][${dbName}] Seed menú Stock de materiales: ya existía.`);
        }
      }
    } catch (err) {
      console.warn('[bootstrap] Seed menú Stock de materiales FAIL:', err.message);
    }

    // Seed idempotente del item "Roles de Producción" bajo Producción (Fase 3).
    // Mismo patrón que los seeds anteriores.
    try {
      const dbName = sequelize.config?.database || 'unknown';
      const [prodRows] = await sequelize.query(
        "SELECT idMenu FROM `Menu` WHERE nombre = 'Producción' AND activo = 1 LIMIT 1"
      );
      if (prodRows.length === 0) {
        console.log(`[bootstrap][${dbName}] Seed menú Roles de Producción: padre "Producción" no encontrado, skip.`);
      } else {
        const idProd = prodRows[0].idMenu;
        const ruta = '/produccion/roles';
        const [existRows] = await sequelize.query(
          "SELECT idMenu FROM `Menu` WHERE ruta = :ruta LIMIT 1",
          { replacements: { ruta } }
        );
        if (existRows.length === 0) {
          const [maxOrdenRows] = await sequelize.query(
            "SELECT COALESCE(MAX(orden), 0) AS maxOrden FROM `Menu` WHERE idMenuPadre = :idProd",
            { replacements: { idProd } }
          );
          const nextOrden = Number(maxOrdenRows[0].maxOrden || 0) + 1;
          await sequelize.query(
            "INSERT INTO `Menu` (idMenuPadre, nombre, ruta, icono, orden, activo, modulo, createdAt, updatedAt) " +
            "VALUES (:idProd, 'Roles de Producción', :ruta, 'fa-solid fa-user-gear', :orden, 1, 'produccion', NOW(), NOW())",
            { replacements: { idProd, ruta, orden: nextOrden } }
          );
          console.log(`[bootstrap][${dbName}] Seed menú Roles de Producción: creado (padre idMenu=${idProd}).`);
          try {
            const { getCacheForDb } = require('../services/cacheHelpers');
            const tc = getCacheForDb({ sequelize });
            tc.invalidate('menus');
          } catch (_) { /* opcional */ }
        } else {
          console.log(`[bootstrap][${dbName}] Seed menú Roles de Producción: ya existía.`);
        }
      }
    } catch (err) {
      console.warn('[bootstrap] Seed menú Roles de Producción FAIL:', err.message);
    }
    } // [VITRINA] fin del bloque de auto-seed de menús desactivado (if (false))

    // CurvaCemento.idPlanta: NULL = curva global del fabricante; con valor = curva propia/experiencia de esa planta
    await addColumnSafe(sequelize, 'CurvaCemento', 'idPlanta', 'INT UNSIGNED NULL');

    // MaterialPrecio.idPlanta: precio scoped por planta (transporte, contratos, etc.)
    await addColumnSafe(sequelize, 'MaterialPrecio', 'idPlanta', 'INT UNSIGNED NULL');

    // Siembra inicial: cada cemento existente se habilita en cada planta con configuración default ICPA + factor 1.000
    try {
      await sequelize.query(`
        INSERT INTO \`CementoPlanta\` (\`idCemento\`, \`idPlanta\`, \`modoCurva\`, \`factorAjuste\`, \`activo\`, \`createdAt\`, \`updatedAt\`)
        SELECT c.\`idCemento\`, p.\`idPlanta\`,
               COALESCE(c.\`modoCurvaPreferido\`, 'ICPA'),
               COALESCE(c.\`factorAjusteICPA\`, 1.000),
               1, NOW(), NOW()
          FROM \`Cemento\` c
          CROSS JOIN \`Planta\` p
          WHERE p.\`activo\` = 1
            AND NOT EXISTS (
              SELECT 1 FROM \`CementoPlanta\` cp
              WHERE cp.\`idCemento\` = c.\`idCemento\` AND cp.\`idPlanta\` = p.\`idPlanta\`
            )
      `);
    } catch (err) {
      console.warn('[migrations] Seed CementoPlanta:', err.message);
    }

    // Siembra inicial para aditivos / adiciones / fibras: habilitar en todas las plantas activas
    try {
      await sequelize.query(`
        INSERT INTO \`MaterialPlanta\` (\`materialSource\`, \`materialSourceId\`, \`idPlanta\`, \`activo\`, \`createdAt\`, \`updatedAt\`)
        SELECT 'aditivo', a.\`idAditivo\`, p.\`idPlanta\`, 1, NOW(), NOW()
          FROM \`Aditivo\` a
          CROSS JOIN \`Planta\` p
          WHERE p.\`activo\` = 1 AND a.\`activo\` = 1
            AND NOT EXISTS (
              SELECT 1 FROM \`MaterialPlanta\` mp
              WHERE mp.\`materialSource\` = 'aditivo'
                AND mp.\`materialSourceId\` = a.\`idAditivo\`
                AND mp.\`idPlanta\` = p.\`idPlanta\`
            )
      `);
      await sequelize.query(`
        INSERT INTO \`MaterialPlanta\` (\`materialSource\`, \`materialSourceId\`, \`idPlanta\`, \`activo\`, \`createdAt\`, \`updatedAt\`)
        SELECT 'fibra', f.\`idFibra\`, p.\`idPlanta\`, 1, NOW(), NOW()
          FROM \`Fibra\` f
          CROSS JOIN \`Planta\` p
          WHERE p.\`activo\` = 1 AND f.\`activo\` = 1
            AND NOT EXISTS (
              SELECT 1 FROM \`MaterialPlanta\` mp
              WHERE mp.\`materialSource\` = 'fibra'
                AND mp.\`materialSourceId\` = f.\`idFibra\`
                AND mp.\`idPlanta\` = p.\`idPlanta\`
            )
      `);
      // Adiciones: Material con idMaterialTipo=4
      await sequelize.query(`
        INSERT INTO \`MaterialPlanta\` (\`materialSource\`, \`materialSourceId\`, \`idPlanta\`, \`activo\`, \`createdAt\`, \`updatedAt\`)
        SELECT 'adicion', m.\`idMaterial\`, p.\`idPlanta\`, 1, NOW(), NOW()
          FROM \`Material\` m
          CROSS JOIN \`Planta\` p
          WHERE p.\`activo\` = 1 AND m.\`activo\` = 1 AND m.\`idMaterialTipo\` = 4
            AND NOT EXISTS (
              SELECT 1 FROM \`MaterialPlanta\` mp
              WHERE mp.\`materialSource\` = 'adicion'
                AND mp.\`materialSourceId\` = m.\`idMaterial\`
                AND mp.\`idPlanta\` = p.\`idPlanta\`
            )
      `);
    } catch (err) {
      console.warn('[migrations] Seed MaterialPlanta:', err.message);
    }

    // Backfill: precios existentes sin idPlanta se replican a todas las plantas activas
    try {
      const [needsBackfill] = await sequelize.query(`
        SELECT COUNT(*) AS n FROM \`MaterialPrecio\` WHERE \`idPlanta\` IS NULL
      `);
      if (needsBackfill[0]?.n > 0) {
        // Para cada precio sin planta, crear copias por planta y eliminar el original
        await sequelize.query(`
          INSERT INTO \`MaterialPrecio\` (\`materialSource\`, \`materialSourceId\`, \`idPlanta\`, \`precioUnitario\`, \`unidad\`, \`moneda\`, \`fechaVigencia\`, \`fechaVencimiento\`, \`proveedor\`, \`incluyeFlete\`, \`costoFlete\`, \`observaciones\`, \`createdAt\`, \`updatedAt\`)
          SELECT mp.\`materialSource\`, mp.\`materialSourceId\`, p.\`idPlanta\`, mp.\`precioUnitario\`, mp.\`unidad\`, mp.\`moneda\`, mp.\`fechaVigencia\`, mp.\`fechaVencimiento\`, mp.\`proveedor\`, mp.\`incluyeFlete\`, mp.\`costoFlete\`, mp.\`observaciones\`, NOW(), NOW()
            FROM \`MaterialPrecio\` mp
            CROSS JOIN \`Planta\` p
            WHERE mp.\`idPlanta\` IS NULL AND p.\`activo\` = 1
        `);
        await sequelize.query(`DELETE FROM \`MaterialPrecio\` WHERE \`idPlanta\` IS NULL`);
      }
    } catch (err) {
      console.warn('[migrations] Backfill MaterialPrecio.idPlanta:', err.message);
    }

    // ─── Unificación de curvas a/c en CurvaCemento (modelo único) ───
    //
    // Refactor 2026-04-29: Las curvas ICPA, del fabricante y propias del usuario conviven
    // en `CurvaCemento` con discriminador `origenCurva`. Los valores legacy quedan así:
    //   - 'EXPERIENCIA' → 'PROPIA' (rename, alinea con CementoPlanta.modoCurva)
    //   - 'ICPA'        → nuevo valor (curvas Ábaco 2 por familia)
    // Las filas de `CurvaACResistencia` se replican como CurvaCemento(origen='ICPA') si no
    // existen. La tabla legacy queda como fallback para tenants sin migración aplicada.
    try {
      // Paso 1: ENUM intermedio que admite los 4 valores (idempotente)
      await sequelize.query(`
        ALTER TABLE \`CurvaCemento\`
        MODIFY COLUMN \`origenCurva\`
        ENUM('ICPA','FABRICANTE','EXPERIENCIA','PROPIA') NOT NULL DEFAULT 'PROPIA'
      `);
      // Paso 2: rename data EXPERIENCIA → PROPIA
      await sequelize.query(`
        UPDATE \`CurvaCemento\` SET \`origenCurva\` = 'PROPIA' WHERE \`origenCurva\` = 'EXPERIENCIA'
      `);
      // Paso 3: limpieza heurística — curvas mal etiquetadas (ICPA marcadas como FABRICANTE)
      await sequelize.query(`
        UPDATE \`CurvaCemento\`
        SET \`origenCurva\` = 'ICPA'
        WHERE \`activo\` = 1
          AND \`origenCurva\` = 'FABRICANTE'
          AND \`idPlanta\` IS NULL
          AND (
                LOWER(\`fabricante\`) = 'icpa'
             OR LOWER(\`nombre\`) LIKE '%icpa%abaco%'
             OR LOWER(\`nombre\`) LIKE '%abaco%icpa%'
             OR LOWER(\`nombre\`) LIKE '%abaco 2%'
             OR LOWER(\`fuenteDocumento\`) LIKE '%icpa%abaco%'
          )
      `);
      // Paso 4: ENUM final (sin EXPERIENCIA)
      await sequelize.query(`
        ALTER TABLE \`CurvaCemento\`
        MODIFY COLUMN \`origenCurva\`
        ENUM('ICPA','FABRICANTE','PROPIA') NOT NULL DEFAULT 'PROPIA'
      `);
    } catch (err) {
      console.warn('[migrations] CurvaCemento.origenCurva ENUM/rename:', err.message);
    }

    // Migración CurvaACResistencia → CurvaCemento (origen=ICPA) por familia.
    // Solo crea filas para familias que no tengan ya una curva ICPA global.
    try {
      const familias = ['CP30', 'CP40', 'CP50'];
      for (const familia of familias) {
        // ¿existe ya una CurvaCemento ICPA global para esta familia?
        const [existing] = await sequelize.query(
          `SELECT id FROM \`CurvaCemento\`
            WHERE \`origenCurva\` = 'ICPA'
              AND \`familiaCemento\` = :familia
              AND \`idPlanta\` IS NULL
              AND \`activo\` = 1
            LIMIT 1`,
          { replacements: { familia } }
        );
        if (existing.length > 0) continue;

        // ¿hay datos en CurvaACResistencia para esta familia?
        const [ptosLegacy] = await sequelize.query(
          `SELECT \`edadDias\`, \`resistenciaMpa\`, \`acEstimado\`
             FROM \`CurvaACResistencia\`
            WHERE \`familiaCemento\` = :familia AND \`activo\` = 1
            ORDER BY \`edadDias\` ASC, \`resistenciaMpa\` DESC`,
          { replacements: { familia } }
        );
        if (ptosLegacy.length === 0) continue;

        // Crear el header de la curva
        const [insertResult] = await sequelize.query(
          `INSERT INTO \`CurvaCemento\`
              (\`familiaCemento\`, \`nombre\`, \`tipoCurva\`, \`fabricante\`,
               \`fuenteDocumento\`, \`origenCurva\`, \`activo\`, \`createdAt\`, \`updatedAt\`)
           VALUES
              (:familia, :nombre, 'TABLA_AC_RESISTENCIA', 'ICPA',
               'ICPA - Ábaco 2: Relación a/c vs Resistencia (genérica por familia)',
               'ICPA', 1, NOW(), NOW())`,
          {
            replacements: {
              familia,
              nombre: `ICPA Ábaco 2 - ${familia}`,
            },
          }
        );
        const curvaId = insertResult; // mysql2 returns insertId as the result of INSERT
        if (!curvaId) continue;

        // Insertar puntos (a/c, resistencia) para cada edad
        const puntosValues = ptosLegacy.map((p, idx) =>
          `(${Number(curvaId)}, ${Number(p.edadDias)}, ${Number(p.acEstimado)}, ${Number(p.resistenciaMpa)}, ${idx}, NOW(), NOW())`
        ).join(',');
        await sequelize.query(
          `INSERT INTO \`CurvaCementoPunto\`
              (\`curvaCementoId\`, \`edadDias\`, \`relacionAc\`, \`resistenciaMpa\`, \`orden\`, \`createdAt\`, \`updatedAt\`)
           VALUES ${puntosValues}`
        );
      }
    } catch (err) {
      console.warn('[migrations] CurvaACResistencia → CurvaCemento ICPA:', err.message);
    }

    // ─── AlertaCalidad.tipo: ENUM aditivo (Prompt 1, Commit 5) ───
    //
    // Agrega 3 tipos nuevos al ENUM `tipo` de AlertaCalidad sin alterar los
    // 9 valores históricos. La operación es idempotente: ejecutar el ALTER
    // varias veces produce el mismo schema final.
    //
    // ⚠ ROLLBACK NO SEGURO: Una vez que la BD tenga registros con los tipos
    // nuevos (ENSAYO_NO_CUMPLE_BLOQUEANTE, APTITUD_CONDICIONADA,
    // ENSAYO_INCONCLUYENTE), volver a la lista corta corromperá esos
    // registros: MySQL los convertirá a string vacío o lanzará error según
    // sql_mode. Si se necesita revertir el cambio, primero migrar los datos
    // (UPDATE registros con tipo nuevo a un tipo histórico equivalente) y
    // luego ejecutar el ALTER de retroceso.
    try {
      await sequelize.query(`
        ALTER TABLE \`AlertaCalidad\`
        MODIFY COLUMN \`tipo\` ENUM(
          'ENSAYO_POR_VENCER',
          'ENSAYO_VENCIDO',
          'ENSAYO_NO_CUMPLE',
          'RESISTENCIA_BAJA',
          'RESISTENCIA_ANOMALA',
          'SPC_FUERA_CONTROL',
          'PLACA_LIMITE',
          'PLACA_AGOTADA',
          'MATERIAL_SIN_ENSAYO',
          'ENSAYO_NO_CUMPLE_BLOQUEANTE',
          'APTITUD_CONDICIONADA',
          'ENSAYO_INCONCLUYENTE'
        ) NOT NULL
      `);
    } catch (err) {
      // 1146 = tabla no existe (primer deploy antes de sync); en ese caso
      // Sequelize.sync() ya creará la tabla con la lista completa.
      if (err.original?.errno !== 1146) {
        console.warn('[migrations] AlertaCalidad.tipo ENUM extension:', err.message);
      }
    }

  } catch (err) {
    console.error('[migrations] Error running pending migrations:', err.message);
  }
};

// Refactor 2026-05-20: el seed idempotente de los 5 roles canónicos en `Rol`
// fue eliminado. Los roles canónicos viven ahora directamente en columnas de
// `Users` (isAdmin, esClienteExterno, rolCalidad) y los registros viejos en
// `Rol` se eliminaron vía migración 20260617-cleanup-empleadorol-canonicos.

module.exports = { createDbConnection };
