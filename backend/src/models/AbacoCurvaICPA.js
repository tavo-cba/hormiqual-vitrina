'use strict';

module.exports = (sequelize, DataTypes) => {
  const AbacoCurvaICPA = sequelize.define('AbacoCurvaICPA', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    asentamientoCm: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      comment: 'Asentamiento en cm (dominio válido: 4–20 cm inclusive)',
    },
    moduloFinura: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: false,
      comment: 'Módulo de finura total de la arena (anclas: 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5)',
    },
    formaAgregado: {
      type: DataTypes.ENUM('CANTO_RODADO', 'TRITURADO', 'MIXTO'),
      allowNull: false,
      defaultValue: 'CANTO_RODADO',
      comment: 'Forma del agregado grueso. CANTO_RODADO = valores base. TRITURADO = base × 1.10. MIXTO = base × 1.05. Cada tabla es independiente y editable.',
    },
    aguaBaseLM3: {
      type: DataTypes.DECIMAL(5, 0),
      allowNull: false,
      comment: 'Agua base en L/m³ (entero). Solo depende de asentamiento + MF + forma. Sin correcciones de TMN.',
    },
    notas: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  }, {
    tableName: 'AbacoCurvaICPA',
    comment: 'Ábaco 1 ICPA: agua base (L/m³) = f(asentamiento, MF, forma). ' +
             'Tres tablas completas: CANTO_RODADO (base), TRITURADO (×1.10), MIXTO (×1.05). ' +
             'Dominio: asentamiento 4–20 cm, MF 3.0–6.5. Corrección por TMN via CorrectoresICPA.',
  });

  return AbacoCurvaICPA;
};
