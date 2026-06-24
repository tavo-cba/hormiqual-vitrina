'use strict';

module.exports = (sequelize, DataTypes) => {
  const TipologiaHormigon = sequelize.define('TipologiaHormigon', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    codigo: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
      comment: 'Identificador único: convencional, bombeable, autocompactante, etc.',
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    descripcion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    activa: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },

    // ── Curva teórica ──
    curvaFamilia: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'FULLER_TALBOT',
      comment: 'FULLER_TALBOT, ANDREASEN, ANDREASEN_MOD, ROSIN_RAMMLER',
    },
    curvaExponente: {
      type: DataTypes.DECIMAL(4, 3),
      allowNull: false,
      defaultValue: 0.500,
      comment: 'n para Fuller, q para Andreasen/MAA',
    },

    // ── Restricciones granulométricas (JSON) ──
    restriccionesGranulometricas: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: JSON.stringify({
        pasa_0_075_min: null, pasa_0_15_min: null, pasa_0_30_min: null,
        tmn_max: null, tmn_min: null,
        mf_max: null, mf_min: null,
        relacion_finos_min: null, relacion_finos_max: null,
        vol_gruesos_max: null, polvo_min_kg: null,
      }),
    },

    // ── Restricciones de dosificación (JSON) ──
    restriccionesDosificacion: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: JSON.stringify({
        asentamiento_min: null, asentamiento_max: null,
        asentamiento_recomendado_min: null, asentamiento_recomendado_max: null,
        tipo_trabajabilidad: 'asentamiento',
        vol_pasta_min: null,
        aditivos_requeridos: [], aditivos_recomendados: [],
        cemento_max_kg: null,
      }),
    },

    // ── Metadata ──
    esPredefinida: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Las predefinidas no se pueden eliminar',
    },
    orden: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  }, {
    tableName: 'TipologiaHormigon',
    comment: 'Tipologías de hormigón con sus parámetros granulométricos y de dosificación.',
  });

  return TipologiaHormigon;
};
