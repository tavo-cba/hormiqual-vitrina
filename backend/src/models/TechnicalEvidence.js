'use strict';

/**
 * TechnicalEvidence — repositorio de evidencias técnicas (P3.8 / Bloque K MVP).
 *
 * Cubre la cláusula CIRSOC 200:2024 §3.2.3.2 f) que exige, para usar arena
 * con granulometría entre A y C en hormigones H ≤ 20:
 *   - Estudios de laboratorio que demuestren cumplimiento del proyecto, O
 *   - Antecedentes de obras similares con comportamiento satisfactorio.
 *
 * MVP: solo referencia textual (no se sube el archivo). El usuario carga
 * el ID del informe, fecha, descripción y opcionalmente vínculo URL/path.
 * En sprint posterior se agrega upload de adjuntos.
 *
 * El motor de dosificación lee TechnicalEvidence al validar conditions de
 * tipo `requires_technical_evidence`. Si no encuentra evidencia asociada,
 * deja el resultado en Inconclusive y abre la puerta al override del
 * responsable técnico (Bloque K.3).
 */

module.exports = (sequelize, DataTypes) => {
  const TechnicalEvidence = sequelize.define('TechnicalEvidence', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    tipo: {
      type: DataTypes.ENUM('LAB_STUDY', 'PRIOR_PROJECT'),
      allowNull: false,
      comment: 'LAB_STUDY = estudio de laboratorio; PRIOR_PROJECT = antecedente de obra similar.',
    },
    // Identificador del documento físico (ID de informe, número de proyecto)
    referencia: {
      type: DataTypes.STRING(160),
      allowNull: false,
      comment: 'Ej: "INF-LAB-2026-0042" o "Proyecto Edificio Quebradas 2024".',
    },
    fecha: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: 'Fecha del informe / del antecedente de obra.',
    },
    descripcion: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Descripción de la evidencia, alcance, condiciones bajo las que se obtuvo.',
    },
    laboratorio: {
      type: DataTypes.STRING(120),
      allowNull: true,
      comment: 'Nombre del laboratorio (para LAB_STUDY) o de la obra/cliente (para PRIOR_PROJECT).',
    },
    urlAdjunto: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'MVP textual: link al documento si está hosteado externamente. Upload de archivos queda para sprint futuro.',
    },
    // Asociaciones flexibles vía JSON (MVP — en sprint futuro pueden ser tablas pivot)
    materialesAsociados: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment: 'Array de idAgregado / idMaterial a los que respalda esta evidencia.',
    },
    dosificacionesAsociadas: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      comment: 'Array de idDosificacionDisenada a las que respalda específicamente.',
    },
    claseResistenciaAplicable: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Clase de resistencia hasta la cual aplica esta evidencia (ej: H20, H25). null = sin restricción declarada.',
    },
    // Trazabilidad
    responsableCarga: {
      type: DataTypes.STRING(120),
      allowNull: false,
      comment: 'Nombre del usuario que cargó la evidencia.',
    },
    rolCarga: {
      type: DataTypes.STRING(40),
      allowNull: true,
      comment: 'Rol del usuario al cargar (RESPONSABLE_CALIDAD, DIRECTOR_TECNICO, ...).',
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Soft-delete: false = retirada del repositorio (no eliminada físicamente).',
    },
  }, {
    tableName: 'TechnicalEvidence',
    comment: 'Repositorio de evidencias técnicas para excepciones normativas (P3.8 / CIRSOC §3.2.3.2 f).',
    indexes: [
      { fields: ['tipo'] },
      { fields: ['activo'] },
    ],
  });

  return TechnicalEvidence;
};
