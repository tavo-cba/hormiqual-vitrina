'use strict';

/**
 * Service del pivote EquipoLaboratorio ↔ Planta.
 *
 * Mirror del API de `materialPlantaService` para que el patrón sea
 * familiar a quien venga del catálogo de materiales, pero la tabla
 * es dedicada (`EquipoPlanta`) por separación semántica — un equipo
 * no es un material.
 */

/**
 * Lista las plantas en las que está habilitado un equipo (incluye inactivas).
 */
const listarPlantasDeEquipo = async (db, idEquipo) => {
  if (!db.EquipoPlanta) return [];
  const rows = await db.EquipoPlanta.findAll({
    where: { idEquipo: Number(idEquipo) },
    include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
    order: [['idPlanta', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

/**
 * Lista los equipos habilitados (activo=true) en una planta.
 */
const listarEquiposDePlanta = async (db, idPlanta, { tipo = null } = {}) => {
  if (!db.EquipoPlanta) return [];
  const rows = await db.EquipoPlanta.findAll({
    where: { idPlanta: Number(idPlanta), activo: true },
    order: [['idEquipo', 'ASC']],
  });
  let ids = rows.map(r => r.idEquipo);
  if (tipo && ids.length > 0 && db.EquipoLaboratorio) {
    const equipos = await db.EquipoLaboratorio.findAll({
      where: { idEquipo: ids, tipo },
      attributes: ['idEquipo'],
      raw: true,
    });
    ids = equipos.map(e => e.idEquipo);
  }
  return rows.filter(r => ids.includes(r.idEquipo)).map(r => r.get({ plain: true }));
};

/**
 * Sincroniza la asignación de un equipo a un conjunto de plantas.
 * plantasConfig: [{ idPlanta, observaciones?, activo? }]
 * Las plantas no incluidas se marcan activo=false (no se borran).
 */
const sincronizarPlantas = async (db, idEquipo, plantasConfig) => {
  if (!db.EquipoPlanta) return [];
  const t = await db.sequelize.transaction();
  try {
    const existentes = await db.EquipoPlanta.findAll({
      where: { idEquipo: Number(idEquipo) },
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
        await db.EquipoPlanta.create({
          idEquipo: Number(idEquipo),
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
    return await listarPlantasDeEquipo(db, idEquipo);
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/**
 * Asigna o reactiva un equipo a una planta (upsert puntual). Útil para hooks.
 */
const upsertPlanta = async (db, idEquipo, idPlanta, data = {}) => {
  if (!db.EquipoPlanta) return null;
  const [row, created] = await db.EquipoPlanta.findOrCreate({
    where: { idEquipo: Number(idEquipo), idPlanta: Number(idPlanta) },
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

const desasignarPlanta = async (db, idEquipo, idPlanta) => {
  if (!db.EquipoPlanta) return { action: 'noop' };
  const row = await db.EquipoPlanta.findOne({
    where: { idEquipo: Number(idEquipo), idPlanta: Number(idPlanta) },
  });
  if (!row) return { action: 'noop' };
  await row.update({ activo: false });
  return { action: 'deactivated', idEquipoPlanta: row.idEquipoPlanta };
};

/**
 * Verifica si un equipo está habilitado en una planta. Throw 422 si no.
 */
const requireHabilitado = async (db, idEquipo, idPlanta) => {
  if (!idPlanta) {
    throw Object.assign(new Error('Falta idPlanta para verificar la habilitación del equipo.'), { statusCode: 400 });
  }
  if (!db.EquipoPlanta) return null;
  const row = await db.EquipoPlanta.findOne({
    where: { idEquipo: Number(idEquipo), idPlanta: Number(idPlanta), activo: true },
  });
  if (!row) {
    throw Object.assign(
      new Error(`El equipo (id=${idEquipo}) no está habilitado en la planta indicada.`),
      { statusCode: 422, code: 'EQUIPO_NO_HABILITADO_EN_PLANTA' }
    );
  }
  return row.get({ plain: true });
};

module.exports = {
  listarPlantasDeEquipo,
  listarEquiposDePlanta,
  sincronizarPlantas,
  upsertPlanta,
  desasignarPlanta,
  requireHabilitado,
};
