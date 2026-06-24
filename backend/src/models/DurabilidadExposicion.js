'use strict';

module.exports = (sequelize, DataTypes) => {
  const DurabilidadExposicion = sequelize.define('DurabilidadExposicion', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    codigo: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: true,
      comment: 'Código normativo CIRSOC 200:2024 (A1, A2, A3, CL1, CL2, M1, M2, M3, C1, C2, Q1, Q2, Q3, Q4)',
    },
    grupo: {
      type: DataTypes.STRING(60),
      allowNull: false,
      comment: 'Grupo de exposición: Carbonatación, Cloruros no marinos, Marino, Congelación y deshielo, Ataque químico',
    },
    descripcionCorta: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Descripción resumida de la clase de exposición',
    },
    descripcionMedio: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Descripción extendida del medio de exposición',
    },
    tipoProceso: {
      type: DataTypes.STRING(60),
      allowNull: true,
      comment: 'Proceso de deterioro predominante',
    },
    ejemplosTipicos: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Ejemplos típicos de estructuras o situaciones expuestas a esta clase',
    },
    acMaxSimple: {
      type: DataTypes.DECIMAL(4, 3),
      allowNull: true,
      comment: 'a/c máxima para hormigón SIMPLE (CIRSOC 200:2024 Tabla 2.5). Null = sin requisito normativo.',
    },
    acMaxArmado: {
      type: DataTypes.DECIMAL(4, 3),
      allowNull: true,
      comment: 'a/c máxima para hormigón ARMADO (CIRSOC 200:2024 Tabla 2.5). Null = sin requisito normativo.',
    },
    acMaxPretensado: {
      type: DataTypes.DECIMAL(4, 3),
      allowNull: true,
      comment: 'a/c máxima para hormigón PRETENSADO (CIRSOC 200:2024 Tabla 2.5). Null = sin requisito normativo.',
    },
    fcminSimple: {
      type: DataTypes.DECIMAL(5, 0),
      allowNull: true,
      comment: "f'c mínimo (MPa) para hormigón SIMPLE (CIRSOC 200:2024 Tabla 2.5). Null = sin requisito normativo.",
    },
    fcminArmado: {
      type: DataTypes.DECIMAL(5, 0),
      allowNull: true,
      comment: "f'c mínimo (MPa) para hormigón ARMADO (CIRSOC 200:2024 Tabla 2.5). Null = sin requisito normativo.",
    },
    fcminPretensado: {
      type: DataTypes.DECIMAL(5, 0),
      allowNull: true,
      comment: "f'c mínimo (MPa) para hormigón PRETENSADO (CIRSOC 200:2024 Tabla 2.5). Null = sin requisito normativo.",
    },
    requiereAireTabla43: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si la clase requiere aire incorporado según Tabla 4.3 de CIRSOC 200:2024.',
    },
    requiereProteccionSuperficial: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si la clase requiere protección superficial adicional.',
    },
    orden: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 99,
      comment: 'Orden de presentación en catálogos y dropdowns.',
    },
    vigente: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Clase vigente en el sistema.',
    },
  }, {
    tableName: 'DurabilidadExposicion',
    comment: 'Clases de exposición CIRSOC 200:2024. ' +
             'Define a/c máxima y f\'c mínimo por tipo estructural (SIMPLE/ARMADO/PRETENSADO). ' +
             'Motor ICPA las usa en Step 6 para verificar durabilidad.',
  });

  return DurabilidadExposicion;
};
