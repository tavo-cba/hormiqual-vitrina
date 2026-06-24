'use strict';

/**
 * technicalEvidenceService — CRUD de evidencias técnicas (Bloque K.1 MVP).
 *
 * Pure function service: recibe `db` (multi-tenant) y datos. No tiene
 * estado. La política de roles se aplica en el controller (vía requireRole).
 */

const { Op } = require('sequelize');

const TIPOS_VALIDOS = ['LAB_STUDY', 'PRIOR_PROJECT'];

function validatePayload(data, { strict = true } = {}) {
  const errors = [];
  if (strict || data.tipo != null) {
    if (!TIPOS_VALIDOS.includes(data.tipo)) {
      errors.push(`tipo debe ser uno de: ${TIPOS_VALIDOS.join(', ')}`);
    }
  }
  if (strict || data.referencia != null) {
    if (!data.referencia || String(data.referencia).trim().length < 3) {
      errors.push('referencia requerida (mínimo 3 caracteres)');
    }
  }
  if (strict || data.fecha != null) {
    if (!data.fecha || isNaN(new Date(data.fecha).getTime())) {
      errors.push('fecha requerida (formato ISO o YYYY-MM-DD)');
    }
  }
  if (strict || data.descripcion != null) {
    if (!data.descripcion || String(data.descripcion).trim().length < 10) {
      errors.push('descripción requerida (mínimo 10 caracteres)');
    }
  }
  if (data.materialesAsociados != null && !Array.isArray(data.materialesAsociados)) {
    errors.push('materialesAsociados debe ser un array');
  }
  if (data.dosificacionesAsociadas != null && !Array.isArray(data.dosificacionesAsociadas)) {
    errors.push('dosificacionesAsociadas debe ser un array');
  }
  if (data.urlAdjunto && data.urlAdjunto.length > 500) {
    errors.push('urlAdjunto excede 500 caracteres');
  }
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 422 });
  }
}

/**
 * Crea una evidencia técnica.
 */
async function crear(db, data, { usuario, rol } = {}) {
  validatePayload(data);
  const row = await db.TechnicalEvidence.create({
    tipo: data.tipo,
    referencia: String(data.referencia).trim(),
    fecha: data.fecha,
    descripcion: String(data.descripcion).trim(),
    laboratorio: data.laboratorio ? String(data.laboratorio).trim() : null,
    urlAdjunto: data.urlAdjunto || null,
    materialesAsociados: data.materialesAsociados || [],
    dosificacionesAsociadas: data.dosificacionesAsociadas || [],
    claseResistenciaAplicable: data.claseResistenciaAplicable || null,
    responsableCarga: usuario || data.responsableCarga || 'sistema',
    rolCarga: rol || data.rolCarga || null,
    activo: true,
  });
  return row.get({ plain: true });
}

/**
 * Lista evidencias activas, filtrables por material, dosificación o tipo.
 */
async function listar(db, { materialId, dosificacionId, tipo, includeInactive = false } = {}) {
  const where = {};
  if (!includeInactive) where.activo = true;
  if (tipo) where.tipo = tipo;
  // Filtros sobre JSON: hechos en JS post-fetch para mantener compat
  // entre dialectos. Para volúmenes grandes migrar a JSON_CONTAINS.
  const rows = await db.TechnicalEvidence.findAll({
    where,
    order: [['fecha', 'DESC'], ['id', 'DESC']],
  });
  let plain = rows.map((r) => r.get({ plain: true }));
  if (materialId != null) {
    const idNum = Number(materialId);
    plain = plain.filter((r) => Array.isArray(r.materialesAsociados) && r.materialesAsociados.includes(idNum));
  }
  if (dosificacionId != null) {
    const idNum = Number(dosificacionId);
    plain = plain.filter((r) => Array.isArray(r.dosificacionesAsociadas) && r.dosificacionesAsociadas.includes(idNum));
  }
  return plain;
}

async function obtener(db, id) {
  const row = await db.TechnicalEvidence.findByPk(id);
  if (!row) throw Object.assign(new Error('Evidencia técnica no encontrada'), { statusCode: 404 });
  return row.get({ plain: true });
}

async function actualizar(db, id, data) {
  const row = await db.TechnicalEvidence.findByPk(id);
  if (!row) throw Object.assign(new Error('Evidencia técnica no encontrada'), { statusCode: 404 });
  validatePayload(data, { strict: false });
  const updates = {};
  const fields = [
    'tipo', 'referencia', 'fecha', 'descripcion', 'laboratorio',
    'urlAdjunto', 'materialesAsociados', 'dosificacionesAsociadas',
    'claseResistenciaAplicable',
  ];
  for (const f of fields) {
    if (data[f] !== undefined) updates[f] = data[f];
  }
  await row.update(updates);
  return row.get({ plain: true });
}

/**
 * Soft-delete: marca como inactiva. No borra físicamente para preservar
 * trazabilidad de documentos pasados que la referencien.
 */
async function eliminar(db, id, { usuario } = {}) {
  const row = await db.TechnicalEvidence.findByPk(id);
  if (!row) throw Object.assign(new Error('Evidencia técnica no encontrada'), { statusCode: 404 });
  await row.update({ activo: false });
  return { ok: true, id, retiradaPor: usuario || null };
}

/**
 * Helper para el validador (Bloque K.2): dado un materialId y opcionalmente
 * una claseResistenciaMaxima, devuelve las evidencias activas que respaldan
 * el uso bajo CIRSOC §3.2.3.2 f).
 *
 * Una evidencia respalda si:
 *   - está activa
 *   - tiene al menos un materialesAsociados[i] === materialId
 *   - su claseResistenciaAplicable es null (sin restricción) o cubre la
 *     resistencia del diseño (ej: "H20" cubre H20, "H25" cubre H20 y H25)
 */
async function buscarEvidenciaParaMaterial(db, { materialId, fceMpa = null }) {
  const all = await listar(db, { materialId });
  if (fceMpa == null) return all;
  return all.filter((ev) => {
    if (!ev.claseResistenciaAplicable) return true; // sin restricción
    const claseStr = String(ev.claseResistenciaAplicable).replace(/[^0-9]/g, '');
    const claseN = Number(claseStr);
    if (!Number.isFinite(claseN)) return true; // si no parsea, no filtramos
    return Number(fceMpa) <= claseN;
  });
}

module.exports = {
  TIPOS_VALIDOS,
  crear,
  listar,
  obtener,
  actualizar,
  eliminar,
  buscarEvidenciaParaMaterial,
};
