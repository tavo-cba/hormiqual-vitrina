'use strict';

/**
 * PlacaElastomero — Juego de placas de neopreno para ensayo de rotura (IRAM 1709).
 *
 * PK compuesta: idPlanta + idPrensa + fechaAlta (identifica unívocamente un juego).
 * Un juego activo por prensa a la vez (activoEnPrensa = true).
 *
 * Tabla 2 IRAM 1709 — Reúsos máximos:
 *   10-40 MPa, Shore 50±5 → 100 reúsos
 *   20-50 MPa, Shore 60±5 → 100 reúsos
 *   30-50 MPa, Shore 70±5 → 100 reúsos
 *   >50-85 MPa, Shore 70±5 → 50 reúsos
 *
 * Extensión: hasta +50% del máximo normativo, de a 1 uso por vez.
 */
module.exports = (sequelize, DataTypes) => {
  const PlacaElastomero = sequelize.define('PlacaElastomero', {
    idPlacaElastomero: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Planta principal (cache derivado del laboratorio). SSoT de pertenencia es `idLaboratorio` desde 2026-06-11.',
    },
    idLaboratorio: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Laboratorio en el que reside la placa. SSoT de pertenencia.',
    },
    idPrensa: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Prensa asignada (null cuando EN_STOCK, se asigna al activar).',
    },
    fechaAlta: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Fecha y hora de puesta en servicio del juego. Parte de la clave lógica.',
    },

    // ── Características del juego ──
    durezaShoreA: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Dureza Shore A nominal (50, 60, 70).',
    },
    diametroMm: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Diámetro de la placa (150, 200, 300 mm).',
    },
    nivelResistenciaMin: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: true,
      comment: 'Nivel mínimo de resistencia de probetas (MPa) según Tabla 2.',
    },
    nivelResistenciaMax: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: true,
      comment: 'Nivel máximo de resistencia de probetas (MPa) según Tabla 2.',
    },

    // ── Conteo de usos ──
    reusosMaxNorma: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Reúsos máximos según Tabla 2 IRAM 1709 (50 o 100).',
    },
    reusosActuales: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Cantidad de usos (ensayos de rotura) realizados con este juego.',
    },
    reusosExtendidos: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Cantidad de extensiones otorgadas más allá del máximo normativo (máx 50% de reusosMaxNorma).',
    },

    // ── Estado ──
    estado: {
      type: DataTypes.ENUM('EN_STOCK', 'EN_USO', 'AGOTADO', 'DESCARTADO'),
      allowNull: false,
      defaultValue: 'EN_STOCK',
      comment: 'EN_STOCK = disponible en planta. EN_USO = activo en prensa. AGOTADO = consumido. DESCARTADO = retirado.',
    },
    fechaActivacion: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha de asignación a prensa (EN_STOCK → EN_USO).',
    },
    fechaBaja: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha de retiro (AGOTADO o DESCARTADO).',
    },
    motivoBaja: {
      type: DataTypes.ENUM('LIMITE_ALCANZADO', 'DETERIORO', 'REEMPLAZO_PREVENTIVO', 'OTRO'),
      allowNull: true,
    },
    observacionesBaja: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    // ── Metadata ──
    marca: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    identificacion: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Identificación autogenerada PG-NNNN (150 mm) o PC-NNNN (100 mm).',
    },
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    creadoPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  }, {
    tableName: 'PlacaElastomero',
    indexes: [
      { fields: ['idPlanta', 'estado'], name: 'idx_planta_estado' },
      { fields: ['idLaboratorio', 'estado'], name: 'idx_lab_estado' },
      { fields: ['idPrensa', 'diametroMm', 'estado'], name: 'idx_prensa_diametro_estado' },
    ],
    comment: 'Juegos de placas de elastómero (neopreno) para ensayos de rotura — IRAM 1709.',
  });

  PlacaElastomero.associate = (models) => {
    if (models.Planta) {
      PlacaElastomero.belongsTo(models.Planta, { foreignKey: 'idPlanta', as: 'planta' });
    }
    if (models.Laboratorio) {
      PlacaElastomero.belongsTo(models.Laboratorio, { foreignKey: 'idLaboratorio', as: 'laboratorio' });
    }
    if (models.PlacaElastomeroPrensa) {
      PlacaElastomero.hasMany(models.PlacaElastomeroPrensa, {
        foreignKey: 'idPlacaElastomero',
        as: 'prensasAsignadas',
      });
    }
    if (models.ControlRecepcionPlaca) {
      PlacaElastomero.hasOne(models.ControlRecepcionPlaca, {
        foreignKey: 'idPlacaElastomero',
        as: 'controlRecepcion',
      });
    }
  };

  return PlacaElastomero;
};
