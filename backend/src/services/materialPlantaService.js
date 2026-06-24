'use strict';

const { Op } = require('sequelize');

const VALID_SOURCES = ['aditivo', 'adicion', 'fibra', 'agregado', 'agua'];

const validateSource = (source) => {
  if (!VALID_SOURCES.includes(source)) {
    throw Object.assign(
      new Error(`materialSource inválido: ${source}. Esperado uno de: ${VALID_SOURCES.join(', ')}.`),
      { statusCode: 400 }
    );
  }
};

/**
 * Lista las plantas en las que está habilitado un material (incluye inactivas y activas).
 */
const listarPlantasDeMaterial = async (db, source, sourceId) => {
  validateSource(source);
  const rows = await db.MaterialPlanta.findAll({
    where: { materialSource: source, materialSourceId: Number(sourceId) },
    include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
    order: [['idPlanta', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

/**
 * Lista los materiales de un tipo habilitados activos en una planta. Devuelve [{materialSourceId,...}].
 */
const listarMaterialesDePlanta = async (db, source, idPlanta) => {
  validateSource(source);
  const rows = await db.MaterialPlanta.findAll({
    where: { materialSource: source, idPlanta: Number(idPlanta), activo: true },
    order: [['materialSourceId', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

/**
 * Sincroniza la asignación de un material a un conjunto de plantas.
 * plantasConfig: [{ idPlanta, observaciones?, activo? }]
 * Las plantas no incluidas se marcan activo=false (no se borran).
 */
const sincronizarPlantas = async (db, source, sourceId, plantasConfig) => {
  validateSource(source);
  const t = await db.sequelize.transaction();
  try {
    const existentes = await db.MaterialPlanta.findAll({
      where: { materialSource: source, materialSourceId: Number(sourceId) },
      transaction: t,
    });
    const existentesByPlanta = new Map(existentes.map(e => [e.idPlanta, e]));
    const incluidas = new Set();

    for (const cfg of (Array.isArray(plantasConfig) ? plantasConfig : [])) {
      if (!cfg.idPlanta) continue;
      const idPlanta = Number(cfg.idPlanta);
      incluidas.add(idPlanta);
      const existing = existentesByPlanta.get(idPlanta);
      if (existing) {
        await existing.update({
          observaciones: cfg.observaciones !== undefined ? cfg.observaciones : existing.observaciones,
          activo: cfg.activo !== false,
        }, { transaction: t });
      } else {
        await db.MaterialPlanta.create({
          materialSource: source,
          materialSourceId: Number(sourceId),
          idPlanta,
          observaciones: cfg.observaciones || null,
          activo: cfg.activo !== false,
        }, { transaction: t });
      }
    }

    for (const e of existentes) {
      if (!incluidas.has(e.idPlanta) && e.activo) {
        await e.update({ activo: false }, { transaction: t });
      }
    }

    await t.commit();
    return await listarPlantasDeMaterial(db, source, sourceId);
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/**
 * Asigna o reconfigura un material a una sola planta.
 */
const upsertPlanta = async (db, source, sourceId, idPlanta, data = {}) => {
  validateSource(source);
  const [row, created] = await db.MaterialPlanta.findOrCreate({
    where: { materialSource: source, materialSourceId: Number(sourceId), idPlanta: Number(idPlanta) },
    defaults: {
      observaciones: data.observaciones || null,
      activo: data.activo !== false,
    },
  });
  if (!created) {
    await row.update({
      observaciones: data.observaciones !== undefined ? data.observaciones : row.observaciones,
      activo: data.activo !== false,
    });
  }
  return row.get({ plain: true });
};

const desasignarPlanta = async (db, source, sourceId, idPlanta) => {
  validateSource(source);
  const row = await db.MaterialPlanta.findOne({
    where: { materialSource: source, materialSourceId: Number(sourceId), idPlanta: Number(idPlanta) },
  });
  if (!row) return { action: 'noop' };
  await row.update({ activo: false });
  return { action: 'deactivated', idMaterialPlanta: row.idMaterialPlanta };
};

/**
 * Verifica si un material está habilitado en una planta. Throw 422 si no.
 */
const requireHabilitado = async (db, source, sourceId, idPlanta) => {
  validateSource(source);
  if (!idPlanta) {
    throw Object.assign(new Error('Falta idPlanta para verificar la habilitación del material.'), { statusCode: 400 });
  }
  const row = await db.MaterialPlanta.findOne({
    where: { materialSource: source, materialSourceId: Number(sourceId), idPlanta: Number(idPlanta), activo: true },
  });
  if (!row) {
    throw Object.assign(
      new Error(`El ${source} (id=${sourceId}) no está habilitado en la planta indicada.`),
      { statusCode: 422, code: 'MATERIAL_NO_HABILITADO_EN_PLANTA' }
    );
  }
  return row.get({ plain: true });
};

module.exports = {
  VALID_SOURCES,
  listarPlantasDeMaterial,
  listarMaterialesDePlanta,
  sincronizarPlantas,
  upsertPlanta,
  desasignarPlanta,
  requireHabilitado,
};
