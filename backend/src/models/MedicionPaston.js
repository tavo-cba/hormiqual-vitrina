'use strict';

/**
 * Modelo MedicionPaston (Fase 2B)
 *
 * Cada pastón de prueba en la práctica es una serie temporal: se miden varias
 * muestras en distintos momentos (al cargar, antes de salir de planta, al
 * llegar a obra, antes de descarga, etc.) con valores de asentamiento,
 * temperatura y observaciones. Esto refleja el slump loss en el tiempo y el
 * comportamiento del hormigón fresco antes y después de los ajustes.
 *
 * Esta tabla cuelga de PastonPrueba (un pastón → muchas mediciones).
 *
 * Las mediciones NO son ajustes: para los ajustes (dosis extra de aditivo
 * pre-salida o en obra) seguimos usando RedosificacionObra, que ahora acepta
 * también `etapa = 'PLANTA'` además de `'OBRA'`.
 */

const ETAPAS = ['PLANTA', 'TRANSPORTE', 'OBRA'];

module.exports = (sequelize, DataTypes) => {
  const MedicionPaston = sequelize.define('MedicionPaston', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idPastonPrueba: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: 'FK al pastón de prueba al que pertenece la medición.',
    },
    ordenSecuencia: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
      comment: 'Orden cronológico dentro del pastón (1, 2, 3, ...)',
    },
    etiqueta: {
      type: DataTypes.STRING(80),
      allowNull: true,
      comment: 'Etiqueta humana: "Muestra planta 1", "Muestra en obra tras remezcla", etc.',
    },
    etapa: {
      type: DataTypes.ENUM(...ETAPAS),
      allowNull: false,
      defaultValue: 'PLANTA',
      comment: 'Dónde se tomó la medición: PLANTA | TRANSPORTE | OBRA.',
    },
    fechaHora: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Momento exacto de la medición (clave para slump loss temporal).',
    },
    asentamientoMm: {
      type: DataTypes.DECIMAL(5, 1),
      allowNull: true,
      comment: 'Asentamiento medido (mm).',
    },
    temperaturaHormigonC: {
      type: DataTypes.DECIMAL(4, 1),
      allowNull: true,
      comment: 'Temperatura del hormigón (°C).',
    },
    temperaturaAmbienteC: {
      type: DataTypes.DECIMAL(4, 1),
      allowNull: true,
      comment: 'Temperatura ambiente (°C).',
    },
    aireMedidoPct: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      comment: 'Contenido de aire (%), si se midió.',
    },
    probetasMoldeadas: {
      type: DataTypes.SMALLINT.UNSIGNED,
      allowNull: true,
      comment: 'Cantidad de probetas moldeadas de esta muestra (si aplica).',
    },
    aspecto: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Aspecto visual del hormigón: Bueno | Regular | Malo | etc.',
    },
    // ── Agregados post-hoc realizados en este momento ──
    aguaAgregadaLts: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      comment: 'Agua agregada en este punto (L). Usar para ajustes de slump.',
    },
    aditivoAgregadoNombre: {
      type: DataTypes.STRING(120),
      allowNull: true,
      comment: 'Nombre/marca del aditivo agregado en este punto.',
    },
    aditivoAgregadoCantidad: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: true,
      comment: 'Cantidad total agregada del aditivo (en la unidad indicada).',
    },
    aditivoAgregadoUnidad: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Unidad del aditivo agregado: cc, L, g, kg.',
    },
    // Array de aditivos agregados (múltiples por medición).
    // Cada item: { nombre, cantidad, unidad, esOtro } — si esOtro=true, el nombre es libre;
    // si false, corresponde a alguno de los aditivos de la dosificación.
    aditivosAgregadosJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    volumenRemanenteM3: {
      type: DataTypes.DECIMAL(6, 3),
      allowNull: true,
      comment: 'Volumen de hormigón remanente en el camión al momento de la medición (m³). Si no se indica, se asume el de la medición anterior (o el volumen total del pastón).',
    },
    // ── Material retenido (dosificado pero no incorporado al mix — reserva) ──
    aguaRetenidaLts: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      comment: 'Agua dosificada pero retenida (no incorporada) para usar después.',
    },
    aditivoRetenidoNombre: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    aditivoRetenidoCantidad: {
      type: DataTypes.DECIMAL(10, 3),
      allowNull: true,
    },
    aditivoRetenidoUnidad: {
      type: DataTypes.STRING(10),
      allowNull: true,
    },
    // 2026-06-13: arrays JSON (espejan aditivosAgregadosJson) para soportar
    // múltiples retenciones por medición. Reemplazan a los campos individuales
    // legacy de aditivoRetenido*. El frontend popula estos JSON; los legacy se
    // mantienen por back-compat con datos previos.
    aditivosRetenidosJson: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Array de { nombre, cantidad, unidad } — aditivos retenidos en la medición base.',
    },
    fibrasRetenidasJson: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Array de { nombre, cantidad, unidad } — fibras retenidas en la medición base.',
    },
    observacion: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Texto libre: "tras remezclar 10 min", "antes de descarga", etc.',
    },
    usuario: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Operador que tomó la muestra.',
    },
  }, {
    tableName: 'MedicionPaston',
    comment: 'Mediciones seriadas dentro de un pastón de prueba (slump loss temporal).',
  });

  MedicionPaston.associate = (models) => {
    MedicionPaston.belongsTo(models.PastonPrueba, {
      foreignKey: 'idPastonPrueba',
      as: 'paston',
    });
  };

  return MedicionPaston;
};

module.exports.ETAPAS = ETAPAS;
