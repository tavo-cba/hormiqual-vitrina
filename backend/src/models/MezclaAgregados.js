'use strict';

module.exports = (sequelize, DataTypes) => {
  const MezclaAgregados = sequelize.define('MezclaAgregados', {
    idMezcla: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    nombre: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    descripcion: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    idPlanta: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    tipoMezcla: {
      type: DataTypes.ENUM('FINO', 'GRUESO', 'TOTAL'),
      allowNull: false,
    },
    objetivoModo: {
      type: DataTypes.ENUM('BANDA', 'CURVA', 'COMBINADO'),
      allowNull: true,
    },
    idBanda: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    idCurvaTeorica: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    bandaCompuestaJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    prioridad1: {
      type: DataTypes.ENUM('BANDA', 'CURVA'),
      allowNull: true,
    },
    prioridad2: {
      type: DataTypes.ENUM('BANDA', 'CURVA'),
      allowNull: true,
    },
    tmnCalculadoMm: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },
    moduloFinura: {
      type: DataTypes.DOUBLE,
      allowNull: true,
    },
    curvaMezclaJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    metadataResultadoJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    // ── Estado & Versionado ──
    estado: {
      type: DataTypes.ENUM(
        'BORRADOR', 'A_PRUEBA', 'PENDIENTE_REVISION',
        'APROBADO', 'SUSPENDIDO', 'ARCHIVADO'
      ),
      allowNull: false,
      defaultValue: 'BORRADOR',
    },
    version: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 1,
    },
    versionPadreId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    mezclaBaseId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      comment: 'Root ID of version chain (= self in v1)',
    },
    codigo: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    codigoBase: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    // ── Hash integrity ──
    hashIntegridad: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    hashDatosJson: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },
    // ── Approval/Review ──
    aprobadoPor: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    fechaAprobacion: {
      type: DataTypes.DATE,
      allowNull: true,
    },
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
    motivoSuspension: {
      type: DataTypes.TEXT,
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
    reemplazadaPorId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    // ── Post-optimization adjustment metadata ──
    tipoOptimizacion: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    proporcionesOptimasJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    rangosFactiblesJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    metricasOptimoJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    metricasAdoptadoJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    calidadAjuste: {
      type: DataTypes.STRING(15),
      allowNull: true,
    },
    motivoAjuste: {
      type: DataTypes.TEXT,
      allowNull: true,
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
    tableName: 'MezclaAgregados',
  });

  MezclaAgregados.associate = (models) => {
    MezclaAgregados.hasMany(models.MezclaAgregadosItem, {
      foreignKey: 'idMezcla',
      as: 'items',
    });
    MezclaAgregados.belongsTo(models.CurvaGranulometrica, {
      foreignKey: 'idBanda',
      as: 'banda',
    });
    MezclaAgregados.belongsTo(models.CurvaGranulometrica, {
      foreignKey: 'idCurvaTeorica',
      as: 'curvaTeorica',
    });
    if (models.Planta) {
      MezclaAgregados.belongsTo(models.Planta, {
        foreignKey: 'idPlanta',
        as: 'planta',
      });
    }
  };

  return MezclaAgregados;
};
