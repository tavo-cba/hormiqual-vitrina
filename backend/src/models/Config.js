module.exports = (sequelize, DataTypes) => {
  const Config = sequelize.define('Config', {
    idConfig: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nombreEmpresa: {
      type: DataTypes.STRING(100),
    },
    direccionEmpresa: {
      type: DataTypes.STRING(255),
    },
    cuitEmpresa: {
      type: DataTypes.STRING(50),
    },
    logoLink: {
      type: DataTypes.STRING(255),
    },
    logoKey: {
      type: DataTypes.STRING(255),
    },
    logoLightLink: {
      type: DataTypes.STRING(255),
    },
    logoLightKey: {
      type: DataTypes.STRING(255),
    },
    mailUser: {
      type: DataTypes.STRING(255),
    },
    mailPassword: {
      type: DataTypes.TEXT,
    },
    mailHost: {
      type: DataTypes.STRING(255),
    },
    mailPort: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 465,
    },
    frontendUrl: {
      type: DataTypes.STRING(255),
    },
    thumbnail: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    apiKeyRsv: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    apiKeyMaps: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    apiGPTKey: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    whatsappApiKey: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    whatsappPhoneId: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    probetaSerieUno: {
      type: DataTypes.INTEGER,
      defaultValue: 7,
      allowNull: true,
    },
    probetaSerieDos: {
      type: DataTypes.INTEGER,
      defaultValue: 28,
      allowNull: true,
    },
    probetaSerieTres: {
      type: DataTypes.INTEGER,
      defaultValue: 28,
      allowNull: true,
    },
    probetaSerieCuatro: {
      type: DataTypes.INTEGER,
      defaultValue: 56,
      allowNull: true,
    },
    firmaEmpleadorBase64: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },
    facturacionRazonSocial: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    facturacionNombreFantasia: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    facturacionCuit: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    facturacionDomicilio: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    facturacionCondicionIvaId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    facturacionInicioActividades: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    facturacionIngresosBrutos: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    facturacionPuntoVenta: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Punto de venta por defecto para facturación electrónica',
    },
    facturacionCbu: {
      type: DataTypes.STRING(22),
      allowNull: true,
      comment: 'CBU de la cuenta bancaria del emisor (obligatorio para FCE)',
    },
    // Configuración Claude API
    claudeApiKey: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Configuración IMAP
    imapHost: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    imapPort: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 993,
    },
    imapUser: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    imapPassword: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    imapTls: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    imapEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    // Configuración del agente IA
    gptBudgetLimit: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 50.00,
      allowNull: true,
      comment: 'Presupuesto máximo mensual en USD para OpenAI',
    },
    gptBudgetRenewalDay: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: true,
      comment: 'Día del mes en que se renueva el presupuesto (1-28)',
    },
    gptAlertThreshold: {
      type: DataTypes.INTEGER,
      defaultValue: 80,
      allowNull: true,
      comment: 'Porcentaje de uso para mostrar alerta (1-100)',
    },
    // Configuración de Remito Electrónico
    remitoPuntoVenta: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Punto de venta para remitos electrónicos',
    },
    remitoCAI: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    remitoCAIVencimiento: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    remitoCondicionesVenta: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Texto de condiciones de venta para el remito',
    },
    remitoElectronicoActivo: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Habilitar sistema de remito electrónico',
    },
    remitoAutoEmail: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Enviar email automáticamente al firmar remito',
    },
    remitoNumeracionDesde: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Número de remito inicial autorizado por AFIP',
    },
    remitoNumeracionHasta: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Número de remito final autorizado por AFIP',
    },
    // AFIP multi-tenant
    afipKeyPath: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Ruta al archivo .key del certificado AFIP',
    },
    afipCertPath: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Ruta al archivo .crt del certificado AFIP',
    },
    afipEnvironment: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: 'test',
      comment: 'Entorno AFIP: test o production',
    },
    // Portal URL (distinto a frontendUrl)
    portalUrl: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'URL del portal público (ej: https://portal.arideros.com.ar)',
    },
    // WhatsApp soporte
    whatsappSoporte: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Número de WhatsApp para soporte (ej: 542984586115)',
    },
    // Color de marca para el portal de empleados
    themeColor: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Color principal de marca (hex, ej: #143258) usado por el Portal de Empleados',
    },
    // S3 / Almacenamiento
    s3AccessKeyId: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'AWS Access Key ID para S3',
    },
    s3SecretAccessKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'AWS Secret Access Key para S3',
    },
    s3Region: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Region del bucket S3 (ej: sa-east-1)',
    },
    s3Bucket: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Nombre del bucket S3',
    },
    // Configuración Geolocker
    geolockerApiKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'API key de Geolocker para integración',
    },
    geolockerApiUrl: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: 'https://backend.geolocker.com.ar',
      comment: 'URL del backend de Geolocker',
    },
    // Laboratorio
    labApiKey: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'API key para autenticacion del laboratorio',
    },
    // Módulos habilitados
    modulosHabilitados: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
      comment: 'JSON array con los módulos habilitados (null = todos)',
    },
    // Calidad - Revisión de ensayos
    aprobacionAutomaticaEnsayos: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Si es true, los ensayos se aprueban automaticamente al ser creados sin pasar por revision manual',
    },
    // P-V-03 (auditoría 08, Bloque 21) — Política de unidad de carga en PDFs.
    // 'ORIGINAL' (default, opción C decisión del usuario): respetar la unidad
    //   con la que la prensa reporta (kN o tonf). Trazabilidad fiel.
    // 'SI_KN': convertir tonf → kN al persistir y mostrar (1 tonf ≈ 9,80665 kN).
    // 'AMBAS': mostrar ambas unidades en certificados/informes ("125 kN / 12,75 tonf").
    politicaUnidadCarga: {
      type: DataTypes.ENUM('ORIGINAL', 'SI_KN', 'AMBAS'),
      allowNull: false,
      defaultValue: 'ORIGINAL',
      comment: 'P-V-03 — Política para mostrar unidad de carga (kN/tonf) en informes.',
    },
    // Retenciones
    retencionesGananciasActivo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si la empresa practica retenciones de Ganancias',
    },
    retencionesIIBBActivo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si la empresa practica retenciones de IIBB',
    },
    retencionesIIBBProvincias: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
      comment: 'JSON array de provincias donde se practica retención IIBB',
    },
    retencionesIIBBAlicuotaConvenio: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 1.00,
      comment: 'Alícuota IIBB cuando el proveedor tiene convenio multilateral (%)',
    },
    retencionesIIBBAlicuotaSinConvenio: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 2.00,
      comment: 'Alícuota IIBB cuando el proveedor NO tiene convenio multilateral (%)',
    },
    empresaConvenioMultilateral: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si la empresa está inscripta en el Convenio Multilateral',
    },
    retencionesGananciasUltimoNumero: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: 'Último número correlativo usado en certificados de retención de ganancias (para continuar la numeración al migrar al sistema)',
    },
    retencionesIIBBUltimoNumero: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: 'Último número correlativo usado en certificados de retención de IIBB (piso de numeración al migrar al sistema)',
    },

    // ─── Liquidación de sueldos / Libro de Sueldos Digital ───
    topeSIPA: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      comment: 'Tope máximo base imponible SIPA (MOPRE) según resolución ANSES vigente. Se aplica a bases 1, 4 y 5 al generar Libro de Sueldos Digital.',
    },

    // ─── Módulo TBS (Tratamientos Bituminosos Superficiales) ───
    usaTBS: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si el tenant utiliza el módulo TBS. Controla visibilidad de menú, ensayos solo-TBS y opciones de contexto en formularios.',
    },
    // Auxilio mecánico (bot de WhatsApp)
    auxilioMecanicoActivo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si está activa la opción "Auxilio mecánico" en el bot de WhatsApp del personal',
    },
    auxilioMecanicoTelefono: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Número de WhatsApp del encargado de auxilios mecánicos (ej: 542984586115). Acepta varios separados por coma',
    },
    // Avisos de vencimientos (mantenimiento)
    rtoVencimientoDiasAviso: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 45,
      comment: 'Días de antelación para mostrar vencimientos de RTO próximos',
    },
    rtoTurnoDiasAviso: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 45,
      comment: 'Días de antelación para mostrar turnos de RTO próximos',
    },
    matafuegoDiasAviso: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
      comment: 'Días de antelación para mostrar vencimientos de matafuegos próximos',
    },
    // ─── Tareas RRHH (registro horario con declaración de tarea) ───
    tareasRRHHHabilitado: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si está habilitada la feature de declarar tarea al fichar (registro horario).',
    },
    tareasRRHHSolicitarPlanta: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Si al fichar se solicita seleccionar planta (recordando la del día anterior).',
    },
    tareasRRHHSolicitarDesgloseSalida: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Si al fichar la salida se pregunta por desglose horario de tareas realizadas.',
    },

    // ─── Planilla Horaria Ley 11.544 ───
    planillaActividad: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Actividad para encabezado de Planilla Horaria Ley 11.544.',
    },
    idPlanillaConvenio: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Convenio (FK ConvenioEmpleado) usado para Planilla Ley 11.544. Filtra los empleados que aparecen.',
    },
    planillaHsEntradaObra: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Hs entrada default para empleados de obra (ej: 8:00/14:00).',
    },
    planillaHsSalidaObra: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Hs salida default para empleados de obra (ej: 12:00/18:00).',
    },
    planillaPausaObra: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Pausa default para empleados de obra (ej: 12:00 A 14:00).',
    },
    planillaHsEntradaNoObra: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Hs entrada default para empleados que NO son de obra.',
    },
    planillaHsSalidaNoObra: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Hs salida default para empleados que NO son de obra.',
    },
    planillaPausaNoObra: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Pausa default para empleados que NO son de obra.',
    },
    planillaHorarioSabado: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Horario de sábados (ej: 08:00 a 12:00 hs).',
    },

    // ─── Validaciones de carga de combustible por WhatsApp ───
    combMaxAumentoKm: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1500,
      comment: 'Máximo aumento de km permitido vs último registro al cargar combustible por WhatsApp',
    },
    combMaxAumentoHoras: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 500,
      comment: 'Máximo aumento de horas permitido vs último registro al cargar combustible por WhatsApp',
    },
    combMaxLitrosVehiculo: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1000,
      comment: 'Máximo litros aceptados en una carga a un equipo / vehículo',
    },
    combMaxLitrosFuente: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 20000,
      comment: 'Máximo litros aceptados en una carga a un tanque / fuente',
    },
    combMinLitros: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Mínimo litros aceptados en una carga (0 = sin mínimo)',
    },
    combPermitirRetrocesoKm: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si está activo, permite que los km ingresados sean menores al último registro (cambio de odómetro)',
    },
    combPermitirRetrocesoHoras: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si está activo, permite que las horas ingresadas sean menores al último registro (cambio de horímetro)',
    },
  }, {
    tableName: 'Config',
    comment: 'Configuración general de la aplicación',
    timestamps: false,
  });

  // ─── Cifrado de credenciales sensibles (sesión 2026-05-11) ────────
  // Antes los campos como geolockerApiKey / whatsappApiKey / mailPassword /
  // s3SecretAccessKey / claudeApiKey quedaban en texto plano. Hooks transparentes
  // los cifran al guardar y descifran al leer. Ver `utils/configCrypto.js`
  // para detalles del formato y degradación grácil cuando no hay CONFIG_ENC_KEY.
  const { encryptSensitiveFieldsBeforeSave, decryptSensitiveFieldsAfterFind } =
    require('../utils/configCrypto');

  Config.addHook('beforeCreate', encryptSensitiveFieldsBeforeSave);
  Config.addHook('beforeUpdate', encryptSensitiveFieldsBeforeSave);
  Config.addHook('beforeSave', encryptSensitiveFieldsBeforeSave);
  Config.addHook('afterFind', decryptSensitiveFieldsAfterFind);

  return Config;
};