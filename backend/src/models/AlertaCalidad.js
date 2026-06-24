'use strict';

module.exports = (sequelize, DataTypes) => {
  const AlertaCalidad = sequelize.define('AlertaCalidad', {
    idAlertaCalidad: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    tipo: {
      type: DataTypes.ENUM(
        // ─── Tipos históricos (NO REMOVER, NO REORDENAR) ───
        // El orden de los valores es semánticamente irrelevante para Sequelize
        // pero los datos persistidos referencian estos strings literales. Si
        // alguien remueve un valor, todos los registros que lo tengan quedan
        // huérfanos. Las migraciones a este ENUM son SIEMPRE aditivas.
        'ENSAYO_POR_VENCER',      // Ensayo próximo a vencer (warningDays)
        'ENSAYO_VENCIDO',          // Ensayo ya venció — disparado por cron verificarVencimientosEnsayos
        'ENSAYO_NO_CUMPLE',        // Resultado fuera de especificación (severity: null o no_bloqueante)
        'RESISTENCIA_BAJA',        // f'ck por debajo del objetivo
        'RESISTENCIA_ANOMALA',     // Probeta individual >15% debajo del promedio
        'SPC_FUERA_CONTROL',       // Violación reglas Western Electric
        'PLACA_LIMITE',            // Placa de elastómero próxima al límite
        'PLACA_AGOTADA',           // Placa agotada
        'MATERIAL_SIN_ENSAYO',     // Material obligatorio sin ensayo vigente — usado para `pending` canónico
        // ─── Tipos nuevos (Prompt 1, Commit 5) ───
        // Disparadores asociados al modelo canónico ComplianceResult (10 estados).
        // Mapeo de dispatch en src/services/alertaCalidadService.js (Commit 6).
        'ENSAYO_NO_CUMPLE_BLOQUEANTE',  // fail con severity='bloqueante' (CIRSOC nivel CRITICO)
        'APTITUD_CONDICIONADA',          // conditionalPass con conditions[] que requieren validar contexto
        'ENSAYO_INCONCLUYENTE',          // inconclusive con relevancia normativa (no determinante por precisión)
        // ─── PR4: Trazabilidad activa de rescates por política del catálogo ───
        'RESCATE_POR_POLITICA',          // Ensayo no_cumple bajado a informative por obligatorio=false (advisory, nivel=BAJO)
        // ─── Recursos MVP Fase C: calibración de equipos de laboratorio ───
        'CALIBRACION_POR_VENCER',        // Calibración del equipo próxima a vencer (≤30 días). ISO 17025 §6.4.7.
        'CALIBRACION_VENCIDA',           // Calibración vencida — los ensayos hechos con este equipo después del vencimiento quedan con trazabilidad débil.
        // ─── Ciclo de vida de dosificaciones (Bug 2 / 2026-05-29) ───
        'DOSIFICACION_PENDIENTE_REVISION', // Una dosificación quedó asignada al usuario para revisión (asignadaA = username del revisor).
      ),
      allowNull: false,
    },
    nivel: {
      type: DataTypes.ENUM('CRITICO', 'ALTO', 'MEDIO', 'BAJO', 'INFO'),
      allowNull: false,
      defaultValue: 'MEDIO',
    },
    estado: {
      type: DataTypes.ENUM('PENDIENTE', 'LEIDA', 'RESUELTA', 'IGNORADA'),
      allowNull: false,
      defaultValue: 'PENDIENTE',
    },
    mensaje: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    detalle: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Datos adicionales: { idAgregado, idEnsayo, tipoHormigon, valor, limite, ... }',
    },
    // Referencias opcionales
    idPlanta: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    idMaterial: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, comment: 'legacyAgregadoId o idCemento' },
    nombreMaterial: { type: DataTypes.STRING(200), allowNull: true },
    idDosificacionDisenada: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Dosificación que originó la alerta (cuando aplica).',
    },
    // Asignación por usuario (Bug 2 / 2026-05-29). Por defecto NULL = alerta
    // global de planta. Cuando se completa con un username, la alerta queda
    // dirigida específicamente a ese usuario y se filtra en el panel
    // mediante el chip "Asignadas a mí".
    asignadaA: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Username del usuario asignado. NULL = alerta global de planta.',
    },
    // Resolución
    resueltaPor: { type: DataTypes.STRING(255), allowNull: true },
    fechaResolucion: { type: DataTypes.DATE, allowNull: true },
    notasResolucion: { type: DataTypes.TEXT, allowNull: true },
    leidaPor: { type: DataTypes.STRING(255), allowNull: true },
    fechaLectura: { type: DataTypes.DATE, allowNull: true },
    // Email
    emailEnviado: { type: DataTypes.BOOLEAN, defaultValue: false },
    emailDestinatario: { type: DataTypes.STRING(500), allowNull: true },
  }, {
    tableName: 'AlertaCalidad',
    indexes: [
      { fields: ['estado', 'nivel'], name: 'idx_alerta_estado_nivel' },
      { fields: ['tipo', 'estado'], name: 'idx_alerta_tipo_estado' },
      { fields: ['idPlanta', 'estado'], name: 'idx_alerta_planta' },
      { fields: ['asignadaA', 'estado'], name: 'idx_alerta_asignada_estado' },
    ],
  });

  return AlertaCalidad;
};
