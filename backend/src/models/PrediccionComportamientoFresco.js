'use strict';

/**
 * Modelo PrediccionComportamientoFresco
 *
 * Registra la predicción heurística de comportamiento fresco del hormigón
 * calculada sobre una dosificación de diseño. Es un artefacto teórico:
 * anticipa tendencias para reducir prueba y error, pero NO sustituye la
 * validación experimental (pastón de prueba / ensayos de planta).
 *
 * Cada predicción queda asociada a una dosificación y guarda un snapshot
 * de entradas relevantes para trazabilidad aunque más adelante cambien
 * los materiales, la dosificación o las reglas del motor.
 *
 * En V1 la predicción se considera "última válida" por dosificación. Si
 * se recalcula, se sobrescribe. Para historial completo, agregar una
 * columna `activo` + lógica de versionado en fases futuras.
 */

module.exports = (sequelize, DataTypes) => {
  const PrediccionComportamientoFresco = sequelize.define('PrediccionComportamientoFresco', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idDosificacionDisenada: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'Dosificación sobre la que se calculó la predicción.',
    },
    versionModelo: {
      type: DataTypes.STRING(40),
      allowNull: false,
      comment: 'Versión del motor heurístico usada (p.ej. pred-fresco-v1.0.0).',
    },
    // ── Índices principales: score 0..1 y clase ordinal ──
    indiceFluidez: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
    claseFluidez:  { type: DataTypes.STRING(32),    allowNull: true },
    indiceCohesion: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
    claseCohesion:  { type: DataTypes.STRING(32),    allowNull: true },
    indiceEstabilidad: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
    claseEstabilidad:  { type: DataTypes.STRING(32),    allowNull: true },
    indiceExudacion: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
    claseExudacion:  { type: DataTypes.STRING(32),    allowNull: true },
    indiceBombeabilidad: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
    claseBombeabilidad:  { type: DataTypes.STRING(32),    allowNull: true },
    indiceTerminabilidad: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
    claseTerminabilidad:  { type: DataTypes.STRING(32),    allowNull: true },
    indiceRobustez: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
    claseRobustez:  { type: DataTypes.STRING(32),    allowNull: true },
    // Nivel de confianza del modelo
    nivelConfianzaScore: { type: DataTypes.DECIMAL(5, 3), allowNull: true },
    nivelConfianzaClase: { type: DataTypes.STRING(16),    allowNull: true },
    // Texto interpretativo, riesgos y recomendaciones
    perfilTexto:      { type: DataTypes.TEXT, allowNull: true },
    riesgosJson:      { type: DataTypes.JSON, allowNull: true, comment: '[{codigo, titulo, mensaje}]' },
    recomendacionesJson: { type: DataTypes.JSON, allowNull: true, comment: 'string[]' },
    // Snapshot de entradas para trazabilidad
    datosEntradaSnapshot: { type: DataTypes.JSON, allowNull: true },
    disponibilidadDatos:  { type: DataTypes.JSON, allowNull: true, comment: 'flags por variable usadas para el score de confianza' },
    fechaCalculo: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    tableName: 'PrediccionComportamientoFresco',
    comment: 'Predicción heurística del comportamiento fresco del hormigón.',
  });

  PrediccionComportamientoFresco.associate = (models) => {
    PrediccionComportamientoFresco.belongsTo(models.DosificacionDisenada, {
      foreignKey: 'idDosificacionDisenada',
      as: 'dosificacionDisenada',
    });
  };

  return PrediccionComportamientoFresco;
};
