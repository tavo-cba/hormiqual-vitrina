'use strict';

/**
 * CIRSOC 200-2024 Tabla 9.3 — Hormigones con características particulares.
 *
 * Tres tipos de hormigón con requisitos adicionales más allá de la clase de
 * exposición (tabla 2.5): colocado bajo agua, elevada impermeabilidad, expuesto
 * a abrasión. Cada tipo tiene una o más "clases" (I/II/III/IV) con sus propios
 * requisitos de a/c, clase mínima, aire, consistencia, penetración de agua,
 * TMN máximo del agregado grueso y desgaste Los Ángeles.
 *
 * Hay filas con sub-condición por espesor (ej. Clase II: ≤500 mm → a/c 0,45 y
 * H-30; >500 mm → a/c 0,55 y H-20). Por eso `espesorMmMax` es opcional y puede
 * haber dos filas con el mismo (tipo, clase) diferenciadas por espesor.
 */

const TIPOS = ['BAJO_AGUA', 'IMPERMEABILIDAD', 'ABRASION'];
const CLASES = ['I', 'II', 'III', 'IV'];
const AIRE_MODO = ['OPCIONAL', 'NO', 'REQUERIDO'];

module.exports = (sequelize, DataTypes) => {
  const HormigonParticular = sequelize.define('HormigonParticular', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    tipoHormigon: { type: DataTypes.ENUM(...TIPOS), allowNull: false },
    clase: { type: DataTypes.ENUM(...CLASES), allowNull: false },
    casoTipico: { type: DataTypes.TEXT, allowNull: true,
      comment: 'Descripción textual de los casos típicos de uso (ej. pilotes, cisternas).' },

    // Sub-condición por espesor (nullable → aplica a cualquier espesor)
    espesorMmMin: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    espesorMmMax: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true,
      comment: 'Rango de espesores. NULL = sin límite (p.ej. ≤500 mm → max=500; >500 → min=501).' },

    // Requisitos
    acMax: { type: DataTypes.DECIMAL(4, 3), allowNull: false,
      comment: 'Relación agua/cemento máxima (en masa). Ej: 0.450, 0.420, 0.550.' },
    claseMinima: { type: DataTypes.STRING(10), allowNull: false,
      comment: 'Código de clase mínima CIRSOC (H-20, H-30, H-40, etc.).' },
    aireIncorporado: { type: DataTypes.ENUM(...AIRE_MODO), allowNull: false, defaultValue: 'OPCIONAL' },
    consistenciaPermitida: { type: DataTypes.JSON, allowNull: true,
      comment: 'Array de códigos de consistencia permitidos (Tabla 4.2). Ej: ["FLUIDA","MUY_FLUIDA"].' },
    penetracionAguaMaxMm: { type: DataTypes.DECIMAL(5, 1), allowNull: true,
      comment: 'Penetración máx. de agua en ensayo IRAM 1554:1983 (mm). NULL si no aplica.' },
    tmnMaxMm: { type: DataTypes.DECIMAL(5, 1), allowNull: true,
      comment: 'TMN máximo del agregado grueso (mm). NULL si no aplica.' },
    tmnMaxFraccionEspesor: { type: DataTypes.DECIMAL(4, 3), allowNull: true,
      comment: 'TMN adicional como fracción del espesor del elemento (ej. 0.333 = 1/3). NULL si no aplica.' },
    desgasteLAMaxPct: { type: DataTypes.DECIMAL(4, 1), allowNull: true,
      comment: 'Desgaste Los Ángeles máximo permitido (%). Solo abrasión.' },

    notas: { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'HormigonParticular',
    comment: 'CIRSOC 200-2024 Tabla 9.3 — hormigones con características particulares (bajo agua, impermeabilidad, abrasión).',
    indexes: [
      { fields: ['tipoHormigon', 'clase'], name: 'idx_hp_tipo_clase' },
    ],
  });

  return HormigonParticular;
};

module.exports.TIPOS = TIPOS;
module.exports.CLASES = CLASES;
module.exports.AIRE_MODO = AIRE_MODO;
