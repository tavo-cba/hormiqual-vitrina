'use strict';

/**
 * Modelo RedosificacionObra
 *
 * Registra ACCIONES trazables de agregado de materiales aplicadas durante la
 * vida del pastón — en planta, transporte u obra. Cada registro responde a:
 * "¿qué se agregó, cuánto, por qué, y qué efecto tuvo?"
 *
 * Tipos de acción soportados:
 *   ADITIVO  — dosis extra de aditivo (plastificante, retardante, etc.)
 *   AGUA     — agua agregada (afecta a/c)
 *   FIBRA    — fibra incorporada en obra
 *   AIRE     — ajuste de aire incorporado (p.ej. via incorporador)
 *   OTRO     — cualquier otro material o acción trazable
 *
 * Cada acción se vincula opcionalmente a una medición ANTES y una DESPUÉS
 * para registrar el efecto medido (delta slump, delta aire, etc.).
 */

const TIPO_ACCION_ENUM = ['ADITIVO', 'AGUA', 'FIBRA', 'AIRE', 'OTRO'];

const MODO_EFECTO_ENUM = [
  'AHORRO_AGUA', 'AUMENTO_ASENTAMIENTO',
  'RETARDANTE', 'ACELERANTE_FRAGUE', 'ACELERANTE_ENDURECIMIENTO',
  'INCORPORADOR_AIRE', 'ESPUMIGENO', 'ANTICONGELANTE', 'REDUCTOR_RETRACCION',
  'EXPANSIVO', 'INHIBIDOR_CORROSION', 'VISCOSANTE',
  'IMPERMEABILIZANTE', 'FIBRAS', 'OTRO',
];

module.exports = (sequelize, DataTypes) => {
  const RedosificacionObra = sequelize.define('RedosificacionObra', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idDosificacionDisenada: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'Dosificación de diseño a la que se aplica la acción.',
    },

    // ── Tipo de acción ──
    tipoAccion: {
      type: DataTypes.ENUM(...TIPO_ACCION_ENUM),
      allowNull: false,
      defaultValue: 'ADITIVO',
      comment: 'Tipo de material agregado: ADITIVO, AGUA, FIBRA, AIRE, OTRO.',
    },

    // ── Material (aditivo / fibra) — nullable para AGUA ──
    idAditivo: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Aditivo utilizado (para tipoAccion=ADITIVO). Nullable para AGUA/FIBRA/OTRO.',
    },
    idFibra: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Fibra utilizada (para tipoAccion=FIBRA).',
    },
    nombreMaterial: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Nombre libre del material (para OTRO, o display del aditivo/fibra).',
    },

    // ── Cantidad ──
    cantidad: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: false,
      comment: 'Cantidad agregada en la unidad indicada.',
    },
    unidad: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'L',
      comment: 'Unidad de la cantidad: L, cc, kg, g, %, etc.',
    },

    // ── Campos legacy (backwards compat) ──
    dosis: {
      type: DataTypes.DECIMAL(6, 3),
      allowNull: true,
      comment: 'Legacy: dosis en unidad normalizada. Usar cantidad+unidad.',
    },
    unidadDosis: {
      type: DataTypes.ENUM('PCT_CEMENTO', 'CC_M3', 'G_M3', 'KG_M3'),
      allowNull: true,
      defaultValue: 'PCT_CEMENTO',
      comment: 'Legacy: unidad normalizada de la dosis.',
    },

    // ── Efecto y motivo ──
    modoEfecto: {
      type: DataTypes.ENUM(...MODO_EFECTO_ENUM),
      allowNull: true,
      defaultValue: 'AUMENTO_ASENTAMIENTO',
      comment: 'Efecto principal buscado.',
    },
    motivo: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Motivo de la acción (p.ej. "recuperar slump tras espera de 45 min").',
    },

    etapa: {
      type: DataTypes.ENUM('PLANTA', 'TRANSPORTE', 'OBRA'),
      allowNull: false,
      defaultValue: 'OBRA',
      comment: 'Dónde se aplicó: PLANTA (pre-salida), TRANSPORTE o OBRA.',
    },

    // ── Vínculo con mediciones (causa → efecto) ──
    medicionAntesId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'FK a MedicionPaston: medición tomada ANTES del agregado.',
    },
    medicionDespuesId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'FK a MedicionPaston: medición tomada DESPUÉS del agregado.',
    },

    // ── Valores medidos (puede venir de las mediciones vinculadas o manual) ──
    asentamientoAntes: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: true,
      comment: 'Asentamiento antes (mm). Auto-fill desde medicionAntes si vinculada.',
    },
    asentamientoDespues: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: true,
      comment: 'Asentamiento después (mm). Auto-fill desde medicionDespues si vinculada.',
    },
    aireMedidoAntes: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      comment: 'Contenido de aire antes (%), para acciones tipo AIRE.',
    },
    aireMedidoDespues: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      comment: 'Contenido de aire después (%), para acciones tipo AIRE.',
    },
    reduccionAguaPct: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      comment: 'Reducción de agua estimada (%), si aplica.',
    },

    // ── Contexto ──
    observaciones: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    fecha: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Momento de la acción.',
    },
    volumenHormigonM3: {
      type: DataTypes.DECIMAL(8, 3),
      allowNull: true,
      comment: 'Volumen del hormigón al momento de la acción (m³).',
    },

    // ── Referencias ──
    pastonRefId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Pastón de prueba asociado.',
    },
    despachoRefId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Despacho asociado (producción).',
    },
    usuario: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  }, {
    tableName: 'RedosificacionObra',
    comment: 'Acciones trazables de agregado de materiales durante la vida del pastón.',
  });

  RedosificacionObra.associate = (models) => {
    RedosificacionObra.belongsTo(models.DosificacionDisenada, {
      foreignKey: 'idDosificacionDisenada',
      as: 'dosificacionDisenada',
    });
    if (models.Aditivo) {
      RedosificacionObra.belongsTo(models.Aditivo, {
        foreignKey: 'idAditivo',
        as: 'aditivo',
      });
    }
    if (models.Fibra) {
      RedosificacionObra.belongsTo(models.Fibra, {
        foreignKey: 'idFibra',
        as: 'fibra',
      });
    }
    if (models.PastonPrueba) {
      RedosificacionObra.belongsTo(models.PastonPrueba, {
        foreignKey: 'pastonRefId',
        as: 'pastonRef',
      });
    }
    if (models.MedicionPaston) {
      RedosificacionObra.belongsTo(models.MedicionPaston, {
        foreignKey: 'medicionAntesId',
        as: 'medicionAntes',
      });
      RedosificacionObra.belongsTo(models.MedicionPaston, {
        foreignKey: 'medicionDespuesId',
        as: 'medicionDespues',
      });
    }
  };

  return RedosificacionObra;
};
